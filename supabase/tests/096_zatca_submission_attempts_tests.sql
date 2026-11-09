BEGIN;
SELECT plan(9);
SELECT has_table('public','zatca_submission_attempts','Submission evidence table exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.zatca_submission_attempts'::regclass),'RLS enabled');
SELECT ok(NOT has_table_privilege('anon','public.zatca_submission_attempts','SELECT,INSERT,UPDATE,DELETE'),'Anon has no access');
SELECT ok(NOT has_table_privilege('authenticated','public.zatca_submission_attempts','SELECT,INSERT,UPDATE,DELETE'),'Authenticated has no access');
SELECT ok(has_table_privilege('service_role','public.zatca_submission_attempts','SELECT'),'Service role can read evidence');
SELECT ok(has_table_privilege('service_role','public.zatca_submission_attempts','INSERT'),'Service role can append evidence');
SELECT has_trigger('public','zatca_submission_attempts','trg_zatca_submission_attempts_immutable','Evidence is append-only');
SELECT has_trigger('public','zatca_submission_attempts','trg_zatca_submission_attempts_scope','Evidence is bound to its issuance');
SELECT throws_ok($$INSERT INTO public.zatca_submission_attempts(tenant_id,issuance_id,environment,pipeline,status,invoice_hash,signed_xml,created_by)
  VALUES (gen_random_uuid(),gen_random_uuid(),'sandbox','reporting','reported','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=','<Invoice/>',gen_random_uuid())$$,
  NULL,'Attempts for unknown issuances are rejected');
SELECT * FROM finish();
ROLLBACK;
