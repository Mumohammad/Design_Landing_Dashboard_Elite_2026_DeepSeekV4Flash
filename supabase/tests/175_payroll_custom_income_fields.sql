BEGIN;
SET LOCAL search_path = extensions, public, pg_temp;
SELECT no_plan();

INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
  ('17500000-0000-4000-8000-000000000001','payroll-custom-field-owner@example.test','{"_invite_provisioned":true}'),
  ('17500000-0000-4000-8000-000000000002','payroll-custom-field-foreign@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE field_tenants AS
SELECT 'own' AS label, (public.provision_company_atomic(
  '17500000-0000-4000-8000-000000000001',
  '{"name":"Payroll field fixture","domain":"payroll-field-175.test","slug":"payroll-field-175"}')->>'id')::uuid AS id
UNION ALL SELECT 'foreign', (public.provision_company_atomic(
  '17500000-0000-4000-8000-000000000002',
  '{"name":"Payroll foreign field fixture","domain":"payroll-field-175-foreign.test","slug":"payroll-field-175-foreign"}')->>'id')::uuid;
UPDATE public.users SET must_change_password = false
  WHERE auth_user_id = '17500000-0000-4000-8000-000000000001';
INSERT INTO public.payroll_custom_income_fields(id,tenant_id,name,field_type)
SELECT CASE label WHEN 'own' THEN '17500000-0000-4000-8000-000000000010'::uuid
       ELSE '17500000-0000-4000-8000-000000000011'::uuid END,id,'Tips','add' FROM field_tenants;
CREATE TEMP TABLE field_input AS SELECT
  '{"rider_id":"TIPS1","driver_name":"Synthetic rider","basic_payment":100,"distance_payment":0,"segment_payment":0,
    "acceptance_penalty":0,"contact_penalty":0,"stacking_deduction":0,"declined_penalty":0,"late_penalty":0,
    "no_show_penalty":0,"no_show_special_penalty":0,"daily_acceptance_penalty":0,"missed_days_penalty":0,
    "rider_balance":0,"custom_fields":[{"field_id":"17500000-0000-4000-8000-000000000010","name":"Tips","type":"add","amount":17}]}'::jsonb AS row;
GRANT SELECT ON field_input TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"17500000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT lives_ok($$SELECT public.import_my_platform_income('17500000-0000-4000-8000-000000000020','2195-01','Synthetic',jsonb_build_array((SELECT row FROM field_input)),false)$$,'active tenant field imports');
SELECT throws_like($$SELECT public.import_my_platform_income('17500000-0000-4000-8000-000000000021','2195-02','Synthetic',
  jsonb_build_array((SELECT jsonb_set(row,'{custom_fields,0,field_id}','"17500000-0000-4000-8000-000000000011"') FROM field_input)),false)$$,
  'PAYENG024:%','a mapped field from another tenant is rejected');
RESET ROLE;
UPDATE public.payroll_custom_income_fields SET is_active = false WHERE id = '17500000-0000-4000-8000-000000000010';
SET LOCAL ROLE authenticated;
SELECT is(public.import_my_platform_income('17500000-0000-4000-8000-000000000020','2195-01','Synthetic',jsonb_build_array((SELECT row FROM field_input)),false)->>'replayed','true','a committed import still replays after archive');
SELECT throws_like($$SELECT public.import_my_platform_income('17500000-0000-4000-8000-000000000022','2195-03','Synthetic',jsonb_build_array((SELECT row FROM field_input)),false)$$,
  'PAYENG024:%','a stale import cannot write an archived field');
RESET ROLE;
UPDATE public.payroll_custom_income_fields SET is_active = true, field_type = 'deduct' WHERE id = '17500000-0000-4000-8000-000000000010';
SET LOCAL ROLE authenticated;
SELECT throws_like($$SELECT public.import_my_platform_income('17500000-0000-4000-8000-000000000023','2195-01','Synthetic',jsonb_build_array((SELECT row FROM field_input)),true)$$,
  'PAYENG024:%','a stale overwrite cannot apply the previous effect');
SELECT lives_ok($$SELECT public.import_my_platform_income('17500000-0000-4000-8000-000000000024','2195-04','Synthetic',
  jsonb_build_array((SELECT jsonb_set(row,'{custom_fields,0,type}','"deduct"') FROM field_input)),false)$$,'reloaded mapping uses the current effect');
RESET ROLE;
SELECT is((SELECT total_income FROM public.payroll_income_records WHERE tenant_id=(SELECT id FROM field_tenants WHERE label='own') AND month_key='2195-01'),117::numeric,'previous import retains its historical amount');
SELECT is((SELECT total_income FROM public.payroll_income_records WHERE tenant_id=(SELECT id FROM field_tenants WHERE label='own') AND month_key='2195-04'),83::numeric,'a new import calculates with the updated effect');
SELECT is((SELECT count(*)::integer FROM public.payroll_income_records WHERE tenant_id=(SELECT id FROM field_tenants WHERE label='own') AND month_key IN ('2195-02','2195-03')),0,'rejected imports write no rows');
SELECT * FROM finish();
ROLLBACK;
