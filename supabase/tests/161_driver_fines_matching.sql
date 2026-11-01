-- Traffic fine import + auto-matching, platform card print log. Synthetic tenants; rolls back.
BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT plan(14);
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
('16100000-0000-4000-8000-000000000001','fin-owner@example.test','{"_invite_provisioned":true}'),
('16100000-0000-4000-8000-000000000002','fin-foreign@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE fin_tenants(kind text PRIMARY KEY,tenant_id uuid);
INSERT INTO fin_tenants VALUES
('own',(public.provision_company_atomic('16100000-0000-4000-8000-000000000001','{"name":"FIN owner","domain":"fin-own.example.test","slug":"fin-own-fixture"}')->>'id')::uuid),
('foreign',(public.provision_company_atomic('16100000-0000-4000-8000-000000000002','{"name":"FIN foreign","domain":"fin-foreign.example.test","slug":"fin-foreign-fixture"}')->>'id')::uuid);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN('16100000-0000-4000-8000-000000000001','16100000-0000-4000-8000-000000000002');
INSERT INTO public.drivers(id,tenant_id,full_name_ar,primary_mobile,category,status) VALUES
('16100000-0000-4000-8000-000000000011',(SELECT tenant_id FROM fin_tenants WHERE kind='own'),'Fine driver A','0501610001','freelancer','active'),
('16100000-0000-4000-8000-000000000012',(SELECT tenant_id FROM fin_tenants WHERE kind='own'),'Fine driver B','0501610002','freelancer','active'),
('16100000-0000-4000-8000-000000000013',(SELECT tenant_id FROM fin_tenants WHERE kind='foreign'),'Foreign driver','0501610003','freelancer','active');
INSERT INTO public.vehicles(id,tenant_id,plate_number,make,model,status) VALUES
('16100000-0000-4000-8000-000000000021',(SELECT tenant_id FROM fin_tenants WHERE kind='own'),'أ ب ح 1234','Toyota','Hilux','available'),
('16100000-0000-4000-8000-000000000022',(SELECT tenant_id FROM fin_tenants WHERE kind='foreign'),'XYZ 9999','Toyota','Hilux','available');
INSERT INTO public.vehicle_assignments(tenant_id,vehicle_id,driver_id,assigned_at,unassigned_at,is_current) VALUES
((SELECT tenant_id FROM fin_tenants WHERE kind='own'),'16100000-0000-4000-8000-000000000021','16100000-0000-4000-8000-000000000011','2026-01-01 08:00+03','2026-02-10 18:00+03',false),
((SELECT tenant_id FROM fin_tenants WHERE kind='own'),'16100000-0000-4000-8000-000000000021','16100000-0000-4000-8000-000000000012','2026-02-11 08:00+03',NULL,true);

SELECT is(driver_operations_private.normalize_plate('أ ب ح ١٢٣٤'),'1234-ABJ','Arabic plate normalised to Latin letters and digits');
SELECT ok(NOT has_function_privilege('anon','public.import_external_fines(jsonb,text,text)','EXECUTE'),'anon cannot import fines');
SELECT ok(NOT has_table_privilege('authenticated','public.driver_platform_card_prints','INSERT'),'clients cannot write the print log directly');

GRANT ALL ON fin_tenants TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"16100000-0000-4000-8000-000000000001","aal":"aal2"}',true);

SELECT is((public.import_external_fines('[
  {"external_ref":"F-1","vehicle_plate":"1234 JBA","violation_date":"2026-01-20","fine_amount":300},
  {"external_ref":"F-2","vehicle_plate":"ABJ-1234","violation_date":"2026-03-01","fine_amount":150},
  {"external_ref":"F-3","vehicle_plate":"ABJ 1234","violation_date":"2025-06-01","fine_amount":100},
  {"external_ref":"F-4","vehicle_plate":"XYZ 9999","violation_date":"2026-03-01","fine_amount":500}
]'::jsonb))->>'matched','2','two fines matched to drivers by assignment date');
SELECT is((SELECT matched_driver_id::text FROM public.external_fine_imports WHERE external_ref='F-1'),'16100000-0000-4000-8000-000000000011','fine before handover goes to the previous driver');
SELECT is((SELECT matched_driver_id::text FROM public.external_fine_imports WHERE external_ref='F-2'),'16100000-0000-4000-8000-000000000012','fine after handover goes to the current driver');
SELECT is((SELECT status::text||':'||(matched_vehicle_id IS NOT NULL)::text FROM public.external_fine_imports WHERE external_ref='F-3'),'unmatched:true','vehicle found but no driver on that date');
SELECT is((SELECT matched_vehicle_id FROM public.external_fine_imports WHERE external_ref='F-4'),NULL,'foreign tenant vehicles are never matched');
SELECT is((public.import_external_fines('[{"external_ref":"F-1","vehicle_plate":"1234 JBA","violation_date":"2026-01-20"}]'::jsonb))->>'duplicates','1','re-importing the same reference is skipped');
SELECT is((public.resolve_external_fine((SELECT id FROM public.external_fine_imports WHERE external_ref='F-3'),'assign','16100000-0000-4000-8000-000000000012'))->>'status','matched','manual driver assignment');
SELECT throws_ok($$SELECT public.resolve_external_fine((SELECT id FROM public.external_fine_imports WHERE external_ref='F-4'),'assign','16100000-0000-4000-8000-000000000013')$$,'P0001','FIN012: active tenant driver required','foreign driver cannot be assigned');
SELECT is((public.resolve_external_fine((SELECT id FROM public.external_fine_imports WHERE external_ref='F-4'),'ignore'))->>'status','ignored','fine can be ignored');
SELECT is(public.record_driver_platform_card_prints('16100000-0000-4000-8000-000000000011','[{"platform_code":"hungerstation","rider_id":"4747290"},{"platform_code":"keeta","rider_id":"K1"}]'::jsonb,'pvc'),2,'card prints recorded');
SELECT throws_ok($$SELECT public.record_driver_platform_card_prints('16100000-0000-4000-8000-000000000013','[]'::jsonb,'pvc')$$,'P0001','DPA001: active tenant driver required','cannot log prints for a foreign driver');

SELECT * FROM finish();
ROLLBACK;
