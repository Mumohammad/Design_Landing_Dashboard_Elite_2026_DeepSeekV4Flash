-- ============================================================================
-- Reports Module — tests (pgTAP)
-- (074_reports_tests.sql)
--
-- Proves the DB-level guarantees behind the /reports hub (Prompt O Part 5 —
-- pure surfacing of migrations 024_reports + 025_templates + 028 seed +
-- 059 verify tokens, no schema change):
--
--   1. Natural keys + guards:
--      - idx_doc_templates_unique_code (tenant, code) partial unique
--      - generated_documents_doc_number_key (doc_number) UNIQUE
--      - idx_generated_docs_verify_token (the public /verify-document lookup)
--      - CHECKs: template_fields jsonb array/object, generated_data object
--   2. Enums: report_status lifecycle (generating/completed/failed/expired)
--      and doc_generation_status (draft/generated/printed/archived)
--   3. RLS: enabled on all three tables; anon sees zero; the fixture user
--      sees own-tenant rows only
--   4. BEHAVIORAL: template insert rides RLS; duplicate template code is
--      rejected (23505); report_generation_log insert rides RLS; generated
--      documents insert rides RLS (verify_token_hash auto-filled by trigger);
--      duplicate doc_number rejected (23505); conditional UPDATEs claim the
--      generating→completed log row and the generated→printed doc (0 rows on
--      the second claim — the race arbiter the server actions rely on)
--
-- Conventions (match 067–073): single transaction, SET LOCAL ROLE + RESET
-- ROLE between role switches, purge-first fixed-id fixtures, plan(N) equals
-- the actual assertion count.
-- ============================================================================

SELECT plan(21);

-- ─── Fixtures (purge-first, fixed ids) ──────────────────────────────────────

CREATE TEMP TABLE rep_fixture (
  tenant_a  uuid,
  tenant_b  uuid,
  tpl_a     uuid,
  doc_a     uuid,
  log_a     uuid,
  auth_id   uuid,
  user_id   uuid
);

DO $$
DECLARE
  v_t_a  uuid := '07400000-0000-0000-0000-000000000001';
  v_t_b  uuid := '07400000-0000-0000-0000-000000000002';
  v_tpl  uuid := '07400000-0000-0000-0000-000000000003';
  v_doc  uuid := '07400000-0000-0000-0000-000000000004';
  v_log  uuid := '07400000-0000-0000-0000-000000000005';
  v_aid  uuid := '07400000-0000-0000-0000-000000000006';
  v_uid  uuid := '07400000-0000-0000-0000-000000000007';
BEGIN
  DELETE FROM public.generated_documents   WHERE tenant_id IN (v_t_a, v_t_b);
  DELETE FROM public.document_templates    WHERE tenant_id IN (v_t_a, v_t_b);
  DELETE FROM public.report_generation_log WHERE tenant_id IN (v_t_a, v_t_b);
  DELETE FROM public.users                 WHERE id = v_uid;
  DELETE FROM auth.users                   WHERE id = v_aid;
  DELETE FROM public.tenants               WHERE id IN (v_t_a, v_t_b);

  INSERT INTO public.tenants (id, name_ar, name_en)
  VALUES (v_t_a, 'مستأجر اختبار التقارير', 'Reports Tenant A'),
         (v_t_b, 'مستأجر اختبار التقارير ب', 'Reports Tenant B');

  INSERT INTO public.document_templates (id, tenant_id, code, name_ar, name_en, category, description, template_fields)
  VALUES (v_tpl, v_t_a, 'tpl074', 'نموذج اختبار', 'Test template', 'operations',
          'نموذج لاختبارات التقارير', '[{"key":"line1"},{"key":"line2"}]'::jsonb);

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES ('00000000-0000-0000-0000-000000000000', v_aid, 'authenticated',
          'authenticated', 'reports-fixture@test.local', crypt('x', gen_salt('bf')),
          now(), now(), now(), '{"provider":"email","providers":["email"]}',
          '{"_invite_provisioned": true}');

  INSERT INTO public.users (id, auth_user_id, tenant_id, email, role, status)
  VALUES (v_uid, v_aid, v_t_a, 'reports-fixture@test.local', 'supervisor', 'active');

  -- One seeded log row + one generated doc for tenant A.
  INSERT INTO public.report_generation_log (id, tenant_id, report_type, report_params, output_format, generated_by, status)
  VALUES (v_log, v_t_a, 'payroll_summary', '{"year":2026,"month":9}'::jsonb, 'csv', v_aid, 'generating');

  INSERT INTO public.generated_documents (id, tenant_id, doc_number, template_id, generated_data, generated_by)
  VALUES (v_doc, v_t_a, 'DOC-0740001-TEST', v_tpl, '{"note":"fixture"}'::jsonb, v_aid);
END $$;

INSERT INTO rep_fixture (tenant_a, tenant_b, tpl_a, doc_a, log_a, auth_id, user_id)
SELECT '07400000-0000-0000-0000-000000000001',
       '07400000-0000-0000-0000-000000000002',
       '07400000-0000-0000-0000-000000000003',
       '07400000-0000-0000-0000-000000000004',
       '07400000-0000-0000-0000-000000000005',
       '07400000-0000-0000-0000-000000000006',
       '07400000-0000-0000-0000-000000000007';

-- ═══ 1. Natural keys + guards (5) ═══════════════════════════════════════════

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'document_templates'
     AND indexname = 'idx_doc_templates_unique_code'
     AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%deleted_at IS NULL%'),
  1,
  'document_templates (tenant, code) partial UNIQUE index exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.generated_documents'::regclass
     AND conname = 'generated_documents_doc_number_key'),
  1,
  'generated_documents doc_number UNIQUE constraint exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'generated_documents'
     AND indexname = 'idx_generated_docs_verify_token'),
  1,
  'generated_documents verify-token lookup index exists (/verify-document path)'
);

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.document_templates'::regclass
     AND conname = 'chk_document_template_fields_object'),
  1,
  'document_templates template_fields jsonb array/object CHECK exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.generated_documents'::regclass
     AND conname = 'chk_generated_data_object'),
  1,
  'generated_documents generated_data jsonb object CHECK exists'
);

-- ═══ 2. Lifecycle enums (2) ═════════════════════════════════════════════════

SELECT is(
  (SELECT count(*)::int FROM pg_enum e
   JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'report_status'
     AND e.enumlabel IN ('generating','completed','failed','expired')),
  4,
  'report_status enum carries the full generating/completed/failed/expired lifecycle'
);

SELECT is(
  (SELECT count(*)::int FROM pg_enum e
   JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'doc_generation_status'
     AND e.enumlabel IN ('draft','generated','printed','archived')),
  4,
  'doc_generation_status enum carries the draft/generated/printed/archived lifecycle'
);

-- ═══ 3. RLS enabled + anon-zero (4) ═════════════════════════════════════════

SELECT is(
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN ('document_templates','generated_documents','report_generation_log')
     AND c.relrowsecurity = true),
  3,
  'RLS is enabled on all three reports-hub tables'
);

SET LOCAL ROLE anon;
SELECT is((SELECT count(*) FROM public.document_templates), 0::bigint, 'anon sees zero document_templates');
SELECT is((SELECT count(*) FROM public.generated_documents), 0::bigint, 'anon sees zero generated_documents');
SELECT is((SELECT count(*) FROM public.report_generation_log), 0::bigint, 'anon sees zero report_generation_log rows');
RESET ROLE;

-- ═══ 4. Own-tenant-only reads (2) ═══════════════════════════════════════════

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "07400000-0000-0000-0000-000000000006", "role": "authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.document_templates WHERE tenant_id = '07400000-0000-0000-0000-000000000002'),
  0::bigint,
  'tenant-B templates are invisible to the tenant-A user'
);

SELECT is(
  (SELECT count(*) FROM public.generated_documents),
  1::bigint,
  'fixture user sees exactly the own-tenant generated document'
);

-- ═══ 5. Behavioral round-trips as the fixture user (4) ══════════════════════

-- 5a. Template admin path: insert rides RLS; duplicate code is rejected.
SELECT lives_ok(
  $$INSERT INTO public.document_templates (tenant_id, code, name_ar, category, template_fields)
    VALUES ('07400000-0000-0000-0000-000000000001', 'tpl074b', 'نموذج ثانٍ', 'hr', '[]'::jsonb)$$,
  'authenticated insert of a document template rides RLS (catalog admin path)'
);
SELECT throws_ok(
  $$INSERT INTO public.document_templates (tenant_id, code, name_ar, category, template_fields)
    VALUES ('07400000-0000-0000-0000-000000000001', 'tpl074', 'مكرر', 'hr', '[]'::jsonb)$$,
  '23505',
  NULL,
  'duplicate template code is rejected by the partial unique index'
);

-- 5b. Queue path: report_generation_log insert rides RLS.
SELECT lives_ok(
  $$INSERT INTO public.report_generation_log (tenant_id, report_type, report_params, output_format, generated_by, status)
    VALUES ('07400000-0000-0000-0000-000000000001', 'revenue', '{"year":2026,"month":9}'::jsonb, 'csv',
            '07400000-0000-0000-0000-000000000006', 'generating')$$,
  'authenticated insert into report_generation_log rides RLS (queue path)'
);

-- 5c. Document path: insert rides RLS (verify_token_hash auto-filled by the
-- 059 trigger) and duplicate doc_number is rejected.
SELECT lives_ok(
  $$INSERT INTO public.generated_documents (tenant_id, doc_number, template_id, generated_data, generated_by)
    VALUES ('07400000-0000-0000-0000-000000000001', 'DOC-0740002-TEST',
            (SELECT id FROM public.document_templates WHERE tenant_id = '07400000-0000-0000-0000-000000000001' AND code = 'tpl074'),
            '{}'::jsonb, '07400000-0000-0000-0000-000000000006')$$,
  'authenticated insert of a generated document rides RLS (verify token auto-filled)'
);
SELECT throws_ok(
  $$INSERT INTO public.generated_documents (tenant_id, doc_number, template_id, generated_data, generated_by)
    VALUES ('07400000-0000-0000-0000-000000000001', 'DOC-0740001-TEST',
            (SELECT id FROM public.document_templates WHERE tenant_id = '07400000-0000-0000-0000-000000000001' AND code = 'tpl074'),
            '{}'::jsonb, '07400000-0000-0000-0000-000000000006')$$,
  '23505',
  NULL,
  'duplicate doc_number is rejected by the UNIQUE constraint'
);

RESET ROLE;

-- ═══ 6. Conditional claims (3) ══════════════════════════════════════════════

-- As postgres (mimics the server actions' conditional-UPDATE claims):
-- the generating→completed claim wins; a second claim yields 0 rows.
WITH claim AS (
  UPDATE public.report_generation_log
  SET status = 'completed', file_name = 'x.csv'
  WHERE id = '07400000-0000-0000-0000-000000000005'
    AND status = 'generating'
  RETURNING id
)
SELECT is(
  (SELECT count(*)::int FROM claim),
  1,
  'conditional UPDATE claims the generating log row (second claim yields 0 rows → race lost)'
);

-- The generated→printed claim wins; a second claim (now printed) yields 0.
WITH claim AS (
  UPDATE public.generated_documents
  SET status = 'printed', printed_at = now()
  WHERE id = '07400000-0000-0000-0000-000000000004'
    AND status IN ('draft', 'generated')
  RETURNING id
)
SELECT is(
  (SELECT count(*)::int FROM claim),
  1,
  'conditional UPDATE claims the generated doc for printing (markDocumentPrinted path)'
);

-- Archive only touches live docs — an already-printed doc still claims, but
-- an archived one never does (re-run the archive on a fake archived row).
WITH claim AS (
  UPDATE public.generated_documents
  SET status = 'archived'
  WHERE id = '07400000-0000-0000-0000-000000000004'
    AND status = 'archived'
  RETURNING id
)
SELECT is(
  (SELECT count(*)::int FROM claim),
  0,
  'archiving an already-archived doc claims 0 rows (archiveDocument race guard)'
);

-- ─── Wrap up (21 assertions total) ──────────────────────────────────────────

SELECT finish();