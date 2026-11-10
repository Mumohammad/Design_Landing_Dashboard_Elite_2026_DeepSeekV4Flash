BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data,email_confirmed_at) VALUES
 ('14300000-0000-4000-8000-000000000001','audit-owner-143@example.test','{"_invite_provisioned":true}',now()),
 ('14300000-0000-4000-8000-000000000002','audit-foreign-143@example.test','{"_invite_provisioned":true}',now()),
 ('14300000-0000-4000-8000-000000000003','audit-reader-143@example.test','{"_invite_provisioned":true}',now()),
 ('14300000-0000-4000-8000-000000000004','audit-denied-143@example.test','{"_invite_provisioned":true}',now());
CREATE TEMP TABLE audit143_tenants(kind text,id uuid);
INSERT INTO audit143_tenants VALUES
 ('own',(public.provision_company_atomic('14300000-0000-4000-8000-000000000001','{"name":"Audit privacy fixture","slug":"audit-privacy143","domain":"audit143.example.test"}')->>'id')::uuid),
 ('foreign',(public.provision_company_atomic('14300000-0000-4000-8000-000000000002','{"name":"Foreign audit fixture","slug":"foreign-audit143","domain":"foreign-audit143.example.test"}')->>'id')::uuid);
UPDATE public.users SET must_change_password=false WHERE auth_user_id IN ('14300000-0000-4000-8000-000000000001','14300000-0000-4000-8000-000000000002');
INSERT INTO public.users(id,auth_user_id,tenant_id,email,role,status,must_change_password) SELECT
 '14300000-0000-4000-8000-000000000013','14300000-0000-4000-8000-000000000003',id,'audit-reader-143@example.test','readonly_auditor','active',false FROM audit143_tenants WHERE kind='own';
INSERT INTO public.users(id,auth_user_id,tenant_id,email,role,status,must_change_password) SELECT
 '14300000-0000-4000-8000-000000000014','14300000-0000-4000-8000-000000000004',id,'audit-denied-143@example.test','operations_officer','active',false FROM audit143_tenants WHERE kind='own';
-- An actual audit-only preset, not a GM bypass or a mocked permission helper.
DELETE FROM public.role_permissions WHERE role_id IN(SELECT r.id FROM public.roles r JOIN audit143_tenants t ON t.id=r.tenant_id AND t.kind='own' WHERE r.name IN ('readonly_auditor','operations_officer'));
INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r JOIN audit143_tenants t ON t.id=r.tenant_id AND t.kind='own' CROSS JOIN public.permissions p WHERE r.name='readonly_auditor' AND p.module='audit_log' AND p.action='read';
-- The actor has real accepted consent. It cannot unmask a driver's data.
INSERT INTO public.user_consents(tenant_id,user_id,consent_type,version,accepted,accepted_at)
 SELECT u.tenant_id,u.id,'terms','audit143-test',true,now() FROM public.users u WHERE u.auth_user_id='14300000-0000-4000-8000-000000000001';
INSERT INTO public.audit_log(id,tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values,ip_address,user_agent,request_id,created_at)
 SELECT '14300000-0000-4000-8000-000000000101',id,'14300000-0000-4000-8000-000000000001','drivers','driver','14300000-0000-4000-8000-000000000901','updated',
 '{"status":"draft","full_name_en":"PRIVATE-143-OLD","iban":"PRIVATE-143-OLD-IBAN"}',
 '{"status":"active","category":"freelancer","employment_type":"full_time","contract_type":"limited","operation":"update","profile_version":7,"bank_details_changed":true,"payroll_terms_changed":true,"full_name_ar":"PRIVATE-143-NAME","full_name_en":"PRIVATE-143-NAME","primary_mobile":"0501430001","work_email":"private143@example.test","iqama_number":"PRIVATE-143-ID","passport_number":"PRIVATE-143-PASSPORT","bank_name":"PRIVATE-143-BANK","bank_account_number":"PRIVATE-143-ACCOUNT","iban":"PRIVATE-143-IBAN","base_salary":9876.54,"housing_allowance":4321,"photo_url":"https://private143.example.test/photo?token=PRIVATE-143-TOKEN","reason":"PRIVATE-143-REASON","archived_reason":"PRIVATE-143-ARCHIVED","notes":"PRIVATE-143-NOTES","deleted_at":null,"termination_date":"2026-10-23","unexpected":{"private_salary":9999,"bank":{"secret":"PRIVATE-143-NESTED"}},"consent":true}',
 '192.0.2.143','PRIVATE-143-UA','PRIVATE-143-REQUEST','2026-10-23T10:00:00Z' FROM audit143_tenants WHERE kind='own';
INSERT INTO public.audit_log(id,tenant_id,actor_id,module,entity_type,entity_id,action,new_values,created_at)
 SELECT '14300000-0000-4000-8000-000000000102',id,'14300000-0000-4000-8000-000000000001','payroll','driver_payroll_period','14300000-0000-4000-8000-000000000902','payroll_calculated',
 '{"status":"calculated","period_year":2026,"period_month":10,"version":2,"total_days":22,"net_payroll":"12345.67","total_earnings":15000.10,"total_deductions":2654.43,"base_salary":11111.11,"base_amount":11111.11,"reason":"PRIVATE-143-PAYROLL-REASON","calculation_snapshot":{"full_name":"PRIVATE-143-PAYROLL-NAME","bank":{"iban":"PRIVATE-143-PAYROLL-IBAN"}},"unknown_amount":{"secret":"PRIVATE-143-PAYROLL-NESTED"}}','2026-10-23T11:00:00Z' FROM audit143_tenants WHERE kind='own';
INSERT INTO public.audit_log(id,tenant_id,actor_id,module,entity_type,entity_id,action,new_values,created_at)
 SELECT '14300000-0000-4000-8000-000000000103',id,'14300000-0000-4000-8000-000000000003','accounting','journal_entry','14300000-0000-4000-8000-000000000903','posted',
 '{"status":"posted","period_year":2026,"period_month":10,"version":3,"amount":"0.10","vat_amount":"0.02","total_amount":"0.12","balance":"90071992547409.93","full_name":"PRIVATE-143-ACCOUNTING-NAME","iban":"PRIVATE-143-ACCOUNTING-IBAN","narrative":"PRIVATE-143-ACCOUNTING-NOTE","reason":"PRIVATE-143-ACCOUNTING-REASON","unknown":{"amount":99999}}','2026-10-23T12:00:00Z' FROM audit143_tenants WHERE kind='own';
INSERT INTO public.audit_log(id,tenant_id,module,entity_type,action,new_values,created_at)
 SELECT '14300000-0000-4000-8000-000000000104',id,'attendance','driver_attendance','driver_operation_updated',
 '{"status":"present","attendance_date":"2026-10-23","total_days":1,"version":2,"notes":"PRIVATE-143-ATTENDANCE-NOTE","location":"PRIVATE-143-LOCATION","bank_details":{"iban":"PRIVATE-143-SUBRESOURCE-IBAN"},"details":[{"salary":9999}],"days":{"phone":"PRIVATE-143-ARRAY"},"photo_url":"https://private143.example.test"}','2026-10-23T13:00:00Z' FROM audit143_tenants WHERE kind='own';
INSERT INTO public.audit_log(id,tenant_id,module,entity_type,action,new_values,created_at)
 SELECT '14300000-0000-4000-8000-000000000105',id,'unknown_module','unknown','updated','{"status":"active","amount":777,"secret":"PRIVATE-143-UNKNOWN"}','2026-10-23T14:00:00Z' FROM audit143_tenants WHERE kind='own';
INSERT INTO public.audit_log(id,tenant_id,module,entity_type,action,new_values,created_at)
 SELECT '14300000-0000-4000-8000-000000000106',id,'drivers','driver','updated','{"status":"PRIVATE-143-FAKE-STATUS","category":"PRIVATE-143-CATEGORY","profile_version":"PRIVATE-143-VERSION","operation":"PRIVATE-143-OPERATION","contact_changed":{"email":"PRIVATE-143-OBJECT"},"attendance_date":"https://private143.example.test","bank_details_changed":"PRIVATE-143-BOOLEAN"}','2026-10-23T15:00:00Z' FROM audit143_tenants WHERE kind='own';
INSERT INTO public.audit_log(id,tenant_id,module,entity_type,action,new_values,created_at)
 SELECT '14300000-0000-4000-8000-000000000107',id,'drivers','driver','archived','{"status":"terminated","deleted_at":"2026-10-23T15:00:00Z","archived_reason":"PRIVATE-143-ARCHIVE"}','2026-10-23T16:00:00Z' FROM audit143_tenants WHERE kind='own';
INSERT INTO public.audit_log(id,tenant_id,module,action,new_values) SELECT '14300000-0000-4000-8000-000000000120',id,'drivers','updated','{"full_name":"PRIVATE-143-FOREIGN","status":"active"}' FROM audit143_tenants WHERE kind='foreign';
INSERT INTO public.audit_log(tenant_id,module,action,new_values,created_at) SELECT t.id,'audit_log','cap_probe','{"unknown":"PRIVATE-143-CAP"}','2026-10-22T00:00:00Z'::timestamptz+i*interval '1 second' FROM audit143_tenants t CROSS JOIN generate_series(1,130)i WHERE kind='own';
CREATE TEMP TABLE audit143_original AS SELECT id,to_jsonb(a) raw FROM public.audit_log a WHERE tenant_id IN(SELECT id FROM audit143_tenants);
GRANT SELECT ON audit143_tenants TO authenticated,anon,service_role;
SELECT ok((SELECT reloptions @> ARRAY['security_barrier=true'] FROM pg_class WHERE oid='public.audit_log_safe'::regclass),'safe view is a security barrier');
SELECT ok((SELECT prosecdef AND provolatile='s' AND 'search_path=""'=ANY(proconfig) FROM pg_proc WHERE oid='public.fetch_audit_trail_page(uuid,timestamptz,timestamptz,uuid,text,text,text,uuid,integer)'::regprocedure),'audit RPC remains stable definer with pinned search path');
SELECT ok((SELECT NOT prosecdef AND provolatile='i' FROM pg_proc WHERE oid='public.audit_metadata_minimal(text,text,jsonb,boolean)'::regprocedure),'JSON projector is pure immutable invoker without privileged data lookup');
SELECT ok(NOT has_table_privilege('authenticated','public.audit_log','SELECT'),'authenticated full raw audit SELECT revoked');
SELECT ok(has_column_privilege('authenticated','public.audit_log','id','SELECT') AND NOT has_column_privilege('authenticated','public.audit_log','new_values','SELECT') AND NOT has_column_privilege('authenticated','public.audit_log','old_values','SELECT') AND NOT has_column_privilege('authenticated','public.audit_log','ip_address','SELECT'),'only non-sensitive raw event columns remain readable');
SELECT ok(NOT has_table_privilege('authenticated','public.audit_log_safe','INSERT') AND NOT has_table_privilege('authenticated','public.audit_log_safe','UPDATE') AND NOT has_table_privilege('authenticated','public.audit_log_safe','DELETE'),'safe view grants no mutation privileges');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14300000-0000-4000-8000-000000000003","aal":"aal2"}',true);
SELECT ok(public.user_has_permission('audit_log','read') AND NOT public.user_has_permission('payroll','read') AND NOT public.user_has_permission('accounting','read'),'real caller has audit-only permissions');
SELECT is((SELECT new_values FROM public.audit_log_safe WHERE id='14300000-0000-4000-8000-000000000101'),'{"status":"active","category":"freelancer","employment_type":"full_time","contract_type":"limited","operation":"update","profile_version":7,"bank_details_changed":true,"payroll_terms_changed":true}'::jsonb,'legacy full driver payload exposes only approved status/employment/version/change flags');
SELECT is((SELECT old_values FROM public.audit_log_safe WHERE id='14300000-0000-4000-8000-000000000101'),'{"status":"draft"}'::jsonb,'historical old payload is independently projected');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.audit_log_safe WHERE coalesce(old_values::text,'')||coalesce(new_values::text,'') LIKE '%PRIVATE-143%'),'names/contact/identity/bank/salary/URLs/notes/secrets absent from every safe payload despite actor consent');
SELECT is((SELECT new_values FROM public.audit_log_safe WHERE id='14300000-0000-4000-8000-000000000102'),'{"status":"calculated","period_year":2026,"period_month":10,"version":2,"has_adjustment":true}'::jsonb,'audit-only caller sees payroll state/period/version without financial details');
SELECT is((SELECT new_values FROM public.audit_log_safe WHERE id='14300000-0000-4000-8000-000000000103'),'{"status":"posted","period_year":2026,"period_month":10,"version":3,"has_adjustment":true}'::jsonb,'audit-only caller sees accounting state without financial details');
SELECT is((SELECT new_values FROM public.audit_log_safe WHERE id='14300000-0000-4000-8000-000000000104'),'{"status":"present","attendance_date":"2026-10-23","total_days":1,"version":2}'::jsonb,'subresource metadata drops nested objects/arrays and free text while retaining operational dates/days');
SELECT is((SELECT new_values FROM public.audit_log_safe WHERE id='14300000-0000-4000-8000-000000000105'),'{}'::jsonb,'unknown module defaults to empty metadata');
SELECT is((SELECT new_values FROM public.audit_log_safe WHERE id='14300000-0000-4000-8000-000000000106'),'{}'::jsonb,'known keys cannot smuggle arbitrary strings/objects as enums/versions/flags/dates');
SELECT is((SELECT new_values FROM public.audit_log_safe WHERE id='14300000-0000-4000-8000-000000000107'),'{"status":"terminated","archived":true}'::jsonb,'legacy deleted timestamp becomes a boolean without exposing archival reason');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.audit_log_safe WHERE ip_address IS NOT NULL OR reason IS NOT NULL),'IP and freeform reason are always null at the view boundary');
SELECT is((SELECT count(*) FROM public.audit_log WHERE id='14300000-0000-4000-8000-000000000101'),1::bigint,'non-sensitive raw ID/count verification remains available');
SELECT throws_ok($$SELECT new_values FROM public.audit_log$$,'42501',NULL,'raw historical new JSON cannot bypass safe view');
SELECT throws_ok($$SELECT old_values FROM public.audit_log$$,'42501',NULL,'raw historical old JSON cannot bypass safe view');
SELECT throws_ok($$SELECT ip_address,user_agent,request_id FROM public.audit_log$$,'42501',NULL,'raw request identity columns cannot bypass safe view');
SELECT throws_ok($$SELECT * FROM public.audit_log$$,'42501',NULL,'raw SELECT star cannot bypass column ACL');
SELECT is((SELECT new_values FROM public.fetch_audit_trail_page((SELECT id FROM audit143_tenants WHERE kind='own'),NULL,NULL,NULL,NULL,NULL,NULL,'14300000-0000-4000-8000-000000000901',100)),(SELECT new_values FROM public.audit_log_safe WHERE id='14300000-0000-4000-8000-000000000101'),'real audit RPC uses the exact safe metadata view projection');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.fetch_audit_trail_page((SELECT id FROM audit143_tenants WHERE kind='own'),NULL,NULL,NULL,NULL,NULL,NULL,NULL,100) WHERE ip_address IS NOT NULL OR reason IS NOT NULL OR coalesce(new_values::text,'') LIKE '%PRIVATE-143%'),'RPC cannot reintroduce IP, reason or nested personal data');
SELECT is((SELECT count(*) FROM public.fetch_audit_trail_page((SELECT id FROM audit143_tenants WHERE kind='own'),'2026-10-23T11:30:00Z','2026-10-23T12:30:00Z','14300000-0000-4000-8000-000000000003','posted','accounting','journal_entry','14300000-0000-4000-8000-000000000903',100)),1::bigint,'all filters including auth-actor UUID preserved');
SELECT is((SELECT count(*) FROM public.fetch_audit_trail_page((SELECT id FROM audit143_tenants WHERE kind='own'),NULL,NULL,'14300000-0000-4000-8000-000000000013',NULL,'accounting',NULL,NULL,100)),1::bigint,'legacy custom actor-profile UUID remains a same-tenant compatibility filter');
SELECT is((SELECT count(*) FROM public.fetch_audit_trail_page((SELECT id FROM audit143_tenants WHERE kind='own'),NULL,NULL,NULL,'cap_probe',NULL,NULL,NULL,99999)),100::bigint,'oversized audit cap remains bounded to100');
SELECT is((SELECT count(*) FROM public.fetch_audit_trail_page((SELECT id FROM audit143_tenants WHERE kind='own'),NULL,NULL,NULL,'cap_probe')),50::bigint,'default audit cap remains50');
SELECT is((SELECT count(*) FROM public.fetch_audit_trail_page((SELECT id FROM audit143_tenants WHERE kind='own'),NULL,NULL,NULL,'cap_probe',NULL,NULL,NULL,0)),1::bigint,'zero audit cap clamps to1');
RESET ROLE;
-- Independent accounting read unlocks approved numeric totals, never PII or payroll.
INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r JOIN audit143_tenants t ON t.id=r.tenant_id AND t.kind='own' CROSS JOIN public.permissions p WHERE r.name='readonly_auditor' AND p.module='accounting' AND p.action='read';
SET LOCAL ROLE authenticated;
SELECT is((SELECT new_values->>'amount' FROM public.audit_log_safe WHERE id='14300000-0000-4000-8000-000000000103'),'0.10','accounting.read independently permits exact approved amount text');
SELECT is((SELECT new_values->>'balance' FROM public.audit_log_safe WHERE id='14300000-0000-4000-8000-000000000103'),'90071992547409.93','large approved totals preserve exact decimal precision');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.audit_log_safe WHERE new_values ?| ARRAY['full_name','iban','reason','narrative','unknown','calculation_snapshot','base_salary','base_amount']),'financial read never unlocks unrelated identity/freeform/nested/salary data');
SELECT ok((SELECT NOT(new_values ? 'net_payroll') FROM public.audit_log_safe WHERE id='14300000-0000-4000-8000-000000000102'),'accounting.read cannot unlock payroll totals');
RESET ROLE;
INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r JOIN audit143_tenants t ON t.id=r.tenant_id AND t.kind='own' CROSS JOIN public.permissions p WHERE r.name='readonly_auditor' AND p.module='payroll' AND p.action='read';
SET LOCAL ROLE authenticated;
SELECT is((SELECT new_values->>'net_payroll' FROM public.audit_log_safe WHERE id='14300000-0000-4000-8000-000000000102'),'12345.67','payroll.read permits approved payroll totals only');
SELECT ok((SELECT NOT(new_values ?| ARRAY['base_salary','base_amount','calculation_snapshot','reason']) FROM public.audit_log_safe WHERE id='14300000-0000-4000-8000-000000000102'),'payroll permission does not expose salary structure or embedded personal snapshots');
RESET ROLE;
UPDATE public.tenants SET status='suspended' WHERE id=(SELECT id FROM audit143_tenants WHERE kind='own');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.audit_log_safe),0::bigint,'suspended tenant cannot read safe audit view despite active authorized user');
SELECT is((SELECT count(*) FROM public.fetch_audit_trail_page((SELECT id FROM audit143_tenants WHERE kind='own'))),0::bigint,'suspended tenant cannot read audit definer RPC');
RESET ROLE;
UPDATE public.tenants SET status='active',deleted_at=now() WHERE id=(SELECT id FROM audit143_tenants WHERE kind='own');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.audit_log_safe),0::bigint,'deleted tenant cannot read safe audit view despite active authorized user');
SELECT is((SELECT count(*) FROM public.fetch_audit_trail_page((SELECT id FROM audit143_tenants WHERE kind='own'))),0::bigint,'deleted tenant cannot read audit definer RPC');
RESET ROLE;
UPDATE public.tenants SET deleted_at=NULL WHERE id=(SELECT id FROM audit143_tenants WHERE kind='own');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14300000-0000-4000-8000-000000000002","aal":"aal2"}',true);
SELECT is((SELECT count(*) FROM public.audit_log_safe WHERE tenant_id=(SELECT id FROM audit143_tenants WHERE kind='own')),0::bigint,'foreign caller cannot query own-tenant safe history');
SELECT is((SELECT count(*) FROM public.fetch_audit_trail_page((SELECT id FROM audit143_tenants WHERE kind='own'))),0::bigint,'arbitrary tenant RPC override cannot bypass caller tenant');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14300000-0000-4000-8000-000000000004","aal":"aal2"}',true);
SELECT is((SELECT count(*) FROM public.audit_log_safe),0::bigint,'authenticated role without audit.read gets no safe rows');
SELECT is((SELECT count(*) FROM public.fetch_audit_trail_page((SELECT id FROM audit143_tenants WHERE kind='own'))),0::bigint,'definer RPC independently denies role without audit.read');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"14300000-0000-4000-8000-000000000001","aal":"aal1"}',true);
SELECT is((SELECT count(*) FROM public.audit_log_safe),0::bigint,'GM without required MFA gets no safe view rows');
SELECT is((SELECT count(*) FROM public.fetch_audit_trail_page((SELECT id FROM audit143_tenants WHERE kind='own'))),0::bigint,'GM without required MFA gets no definer RPC rows');
SELECT set_config('request.jwt.claims','{"role":"authenticated"}',true);
SELECT is((SELECT count(*) FROM public.audit_log_safe),0::bigint,'missing caller identity gets no safe rows');
SELECT set_config('request.jwt.claims','{"role":"service_role","sub":"14300000-0000-4000-8000-000000000001","aal":"aal2"}',true);
SELECT is((SELECT count(*) FROM public.audit_log_safe),0::bigint,'service-role JWT cannot masquerade as an authenticated audit reader');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.audit_log_safe$$,'42501',NULL,'anonymous safe view access denied by actual role ACL');
SELECT throws_ok($$SELECT * FROM public.fetch_audit_trail_page((SELECT id FROM audit143_tenants WHERE kind='own'))$$,'42501',NULL,'anonymous audit RPC execution denied');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT * FROM public.audit_log_safe$$,'42501',NULL,'trusted service has no safe public view grant');
SELECT throws_ok($$SELECT * FROM public.fetch_audit_trail_page((SELECT id FROM audit143_tenants WHERE kind='own'))$$,'42501',NULL,'trusted service has no public audit RPC grant');
RESET ROLE;
SELECT ok(NOT EXISTS(SELECT 1 FROM audit143_original snapshot JOIN public.audit_log a USING(id) WHERE snapshot.raw IS DISTINCT FROM to_jsonb(a)),'privacy enforcement never rewrites physical historical audit rows');
SELECT is((SELECT new_values->>'full_name_en' FROM public.audit_log WHERE id='14300000-0000-4000-8000-000000000101'),'PRIVATE-143-NAME','legacy personal payload remains stored intact for privileged forensic retention');
SELECT is(public.audit_metadata_minimal('drivers','driver','{"status":"active","profile_version":8,"identity_changed":true,"contact_changed":false,"bank_details_changed":true,"compensation_changed":true,"assignment_changed":true,"reason_recorded":true,"termination_date":"2026-10-23","created_at":"2026-10-23T00:00:00Z"}',false),'{"status":"active","profile_version":8,"identity_changed":true,"contact_changed":false,"bank_details_changed":true,"compensation_changed":true,"assignment_changed":true,"reason_recorded":true}'::jsonb,'future minimized core audit flags stay readable without reintroducing driver dates or PII');
SELECT is(public.audit_metadata_minimal('hr','training_records','{"surface":"training","status":"completed","updated_at":"2026-10-23T00:00:00Z","notes":"PRIVATE-143-NOTES"}',false),'{"surface":"training","status":"completed","updated_at":"2026-10-23T00:00:00Z"}'::jsonb,'future minimized subresource surface/status/version timestamp stays readable');
SELECT * FROM finish();
ROLLBACK;
