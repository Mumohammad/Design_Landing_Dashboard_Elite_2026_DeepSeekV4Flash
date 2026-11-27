BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT plan(7);
SELECT ok(NOT EXISTS(
 SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid='public.set_my_party_national_address(text,uuid,jsonb)'::regprocedure
 AND a.grantee=0 AND a.privilege_type='EXECUTE'
),'unguarded legacy address RPC has no PUBLIC execute grant');
SELECT ok(NOT has_function_privilege(role_name,'public.set_my_party_national_address(text,uuid,jsonb)','EXECUTE'),role_name||' cannot call the unversioned party-address RPC')
FROM unnest(ARRAY['anon','authenticated','service_role']) role_name;
SELECT ok(has_function_privilege('authenticated','public.mutate_my_accounting_master(text,text,jsonb,uuid,timestamptz,uuid)','EXECUTE'),'reviewed versioned party mutation remains available');
SELECT ok(NOT has_function_privilege('authenticated','public.record_zatca_issuance(uuid,uuid,text,uuid,uuid,timestamptz,bigint,text,text,text,text,uuid)','EXECUTE'),'issuance stays inaccessible to direct authenticated callers');
SELECT ok(has_function_privilege('service_role','public.record_zatca_issuance(uuid,uuid,text,uuid,uuid,timestamptz,bigint,text,text,text,text,uuid)','EXECUTE'),'service issuance workflow retains its existing grant');
SELECT * FROM finish();
ROLLBACK;
