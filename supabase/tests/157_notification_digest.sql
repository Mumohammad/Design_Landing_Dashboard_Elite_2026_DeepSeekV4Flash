BEGIN;
SET LOCAL search_path=extensions,public,pg_temp;
SELECT plan(9);
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES ('95700000-0000-4000-8000-000000000001','digest-owner@example.test','{"_invite_provisioned":true}');

SELECT has_table('public', 'notification_settings', 'notification_settings exists');
SELECT has_table('public', 'notification_digest_log', 'notification_digest_log exists');
SELECT ok(NOT has_table_privilege('authenticated', 'public.notification_settings', 'SELECT'), 'authenticated cannot read settings');
SELECT ok(NOT has_table_privilege('anon', 'public.notification_digest_log', 'SELECT'), 'anon cannot read digest log');

CREATE TEMP TABLE nd_tenant AS SELECT (public.provision_company_atomic('95700000-0000-4000-8000-000000000001','{"name":"Digest fixture","domain":"digest.test","slug":"digest-fixture"}')->>'id')::uuid id;

INSERT INTO public.notification_settings (tenant_id) SELECT id FROM nd_tenant;
SELECT is((SELECT frequency FROM public.notification_settings WHERE tenant_id = (SELECT id FROM nd_tenant)), 'daily', 'defaults to daily');

SELECT throws_ok($$UPDATE public.notification_settings SET recipient_roles = ARRAY['root'] WHERE tenant_id = (SELECT id FROM nd_tenant)$$, '23514', NULL, 'unknown role rejected');
SELECT throws_ok($$UPDATE public.notification_settings SET categories = '{}' WHERE tenant_id = (SELECT id FROM nd_tenant)$$, '23514', NULL, 'empty categories rejected');

INSERT INTO public.notification_digest_log (tenant_id, run_date) SELECT id, '2026-11-02' FROM nd_tenant;
SELECT throws_ok($$INSERT INTO public.notification_digest_log (tenant_id, run_date) SELECT id, '2026-11-02' FROM nd_tenant$$, '23505', NULL, 'one scheduled digest per tenant per day');
SELECT lives_ok($$INSERT INTO public.notification_digest_log (tenant_id, run_date, kind) SELECT id, '2026-11-02', 'test' FROM nd_tenant$$, 'test digests are not limited');

SELECT * FROM finish();
ROLLBACK;
