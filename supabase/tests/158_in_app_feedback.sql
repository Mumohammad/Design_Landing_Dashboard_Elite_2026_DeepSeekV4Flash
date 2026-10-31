BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT plan(5);
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES ('95800000-0000-4000-8000-000000000001','feedback-owner@example.test','{"_invite_provisioned":true}');
CREATE TEMP TABLE fb_tenant AS SELECT (public.provision_company_atomic('95800000-0000-4000-8000-000000000001','{"name":"Feedback fixture","domain":"feedback.test","slug":"feedback-fixture"}')->>'id')::uuid id;

SELECT has_table('public', 'app_feedback', 'app_feedback exists');
SELECT ok(NOT has_table_privilege('authenticated', 'public.app_feedback', 'INSERT'), 'clients cannot write feedback directly');
SELECT lives_ok($$INSERT INTO public.app_feedback(tenant_id,user_id,kind,message) SELECT id,'95800000-0000-4000-8000-000000000001','idea','Add bulk export please' FROM fb_tenant$$, 'valid feedback stored');
SELECT throws_ok($$INSERT INTO public.app_feedback(tenant_id,kind,message) SELECT id,'spam','hello world' FROM fb_tenant$$, '23514', NULL, 'unknown kind rejected');
SELECT throws_ok($$INSERT INTO public.app_feedback(tenant_id,kind,message) SELECT id,'bug','  hi ' FROM fb_tenant$$, '23514', NULL, 'too-short message rejected');

SELECT * FROM finish();
ROLLBACK;
