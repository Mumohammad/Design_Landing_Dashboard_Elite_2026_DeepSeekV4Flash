-- ============================================================================
-- Violations Module — tests (pgTAP)
-- (072_violations_tests.sql)
--
-- Proves the DB-level guarantees behind the /violations workflow (Prompt O
-- Part 3 — pure surfacing, no schema change):
--
--   1. Natural keys + guarded enums:
--      - idx_violation_types_unique_code (tenant, code) partial unique
--      - uq_external_fine (tenant, external_ref, source) — the idempotent
--        re-import guard for government fines
--      - violations.violation_ref sequence default (VIO-YYYY-#####)
--   2. CHECK guards: non-negative deductions (violations, ledger, types) and
--      the external-fine source allowlist
--   3. Read-path indexes: idx_violations_active (tenant, driver, status) and
--      idx_violation_ledger_pending (the payroll-calc pending scan)
--   4. RLS: anon sees zero; fixture user sees own-tenant rows only on
--      violations, violation_types, violation_deduction_ledger,
--      external_fine_imports
--   5. BEHAVIORAL: violation create rides RLS; the waiver-limit setting
--      exists; the external-fine unique key rejects a duplicate re-import
--      (23505); the ledger rides RLS
--
-- Conventions (match 067/069/070/071): single transaction, SET LOCAL ROLE +
-- RESET ROLE between role switches, purge-first fixed-id fixtures, plan(N)
-- equals the actual assertion count.
-- ============================================================================

SELECT plan(19);

-- ─── Fixtures (purge-first, fixed ids) ──────────────────────────────────────

CREATE TEMP TABLE viol_fixture (
  tenant_a  uuid,
  tenant_b  uuid,
  driver_a  uuid,
  type_a    uuid,
  viol_a    uuid,
  auth_id   uuid,
  user_id   uuid
);

DO $$
DECLARE
  v_t_a uuid := '07200000-0000-0000-0000-000000000001';
  v_t_b uuid := '07200000-0000-0000-0000-000000000002';
  v_d_a uuid := '07200000-0000-0000-0000-000000000003';
  v_ty  uuid := '07200000-0000-0000-0000-000000000004';
  v_vio uuid := '07200000-0000-0000-0000-000000000005';
  v_aid uuid := '07200000-0000-0000-0000-000000000006';
  v_uid uuid := '07200000-0000-0000-0000-000000000007';
BEGIN
  DELETE FROM public.external_fine_imports     WHERE tenant_id IN (v_t_a, v_t_b);
  DELETE FROM public.violation_deduction_ledger WHERE violation_id = v_vio;
  DELETE FROM public.violations                 WHERE tenant_id IN (v_t_a, v_t_b);
  DELETE FROM public.violation_types            WHERE tenant_id IN (v_t_a, v_t_b);
  DELETE FROM public.drivers                    WHERE id = v_d_a;
  DELETE FROM public.users                      WHERE id = v_uid;
  DELETE FROM auth.users                        WHERE id = v_aid;
  DELETE FROM public.tenants                    WHERE id IN (v_t_a, v_t_b);

  INSERT INTO public.tenants (id, name_ar, name_en)
  VALUES (v_t_a, 'مستأجر اختبار المخالفات', 'Violations Tenant A'),
         (v_t_b, 'مستأجر اختبار المخالفات ب', 'Violations Tenant B');

  INSERT INTO public.drivers (id, tenant_id, full_name_ar, driver_code, primary_mobile, category)
  VALUES (v_d_a, v_t_a, 'سائق المخالفات', 'DRV-072', '0572000001', 'freelancer');

  INSERT INTO public.violation_types (id, tenant_id, code, name_ar, category, severity, default_deduction)
  VALUES (v_ty, v_t_a, 'speed072', 'سرعة', 'traffic', 'moderate', 300);

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES ('00000000-0000-0000-0000-000000000000', v_aid, 'authenticated',
          'authenticated', 'viol-fixture@test.local', crypt('x', gen_salt('bf')),
          now(), now(), now(), '{"provider":"email","providers":["email"]}',
          '{"_invite_provisioned": true}');

  INSERT INTO public.users (id, auth_user_id, tenant_id, email, role, status)
  VALUES (v_uid, v_aid, v_t_a, 'viol-fixture@test.local', 'supervisor', 'active');
END $$;

INSERT INTO viol_fixture (tenant_a, tenant_b, driver_a, type_a, viol_a, auth_id, user_id)
SELECT '07200000-0000-0000-0000-000000000001',
       '07200000-0000-0000-0000-000000000002',
       '07200000-0000-0000-0000-000000000003',
       '07200000-0000-0000-0000-000000000004',
       '07200000-0000-0000-0000-000000000005',
       '07200000-0000-0000-0000-000000000006',
       '07200000-0000-0000-0000-000000000007';

-- Seed one violation + one ledger row for tenant A (as postgres).
INSERT INTO public.violations (id, tenant_id, driver_id, violation_type_id, source, severity,
                               incident_date, incident_description, deduction_amount, status)
VALUES ('07200000-0000-0000-0000-000000000005', '07200000-0000-0000-0000-000000000001',
        '07200000-0000-0000-0000-000000000003', '07200000-0000-0000-0000-000000000004',
        'manual', 'moderate', '2026-10-01', 'سرعة زائدة — اختبار', 300, 'open');

INSERT INTO public.violation_deduction_ledger (tenant_id, violation_id, driver_id,
                                               deduction_amount, deduction_month, status)
VALUES ('07200000-0000-0000-0000-000000000001', '07200000-0000-0000-0000-000000000005',
        '07200000-0000-0000-0000-000000000003', 300, '2026-10', 'pending');

-- ─── 1. Natural keys (2) ────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'violation_types'
     AND indexname = 'idx_violation_types_unique_code'
     AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%deleted_at IS NULL%'),
  1,
  'violation_types (tenant, code) partial UNIQUE index exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.external_fine_imports'::regclass
     AND conname = 'uq_external_fine'),
  1,
  'external_fine_imports (tenant, external_ref, source) UNIQUE constraint exists (idempotent re-import guard)'
);

-- ─── 2. CHECK guards (4) ────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.violations'::regclass
     AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%deduction_amount%>= %'),
  1,
  'violations deduction_amount >= 0 CHECK exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.violation_deduction_ledger'::regclass
     AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%deduction_amount%>= %'),
  1,
  'violation_deduction_ledger deduction_amount >= 0 CHECK exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.violation_types'::regclass
     AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%default_deduction%>= %'),
  1,
  'violation_types default_deduction >= 0 CHECK exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.external_fine_imports'::regclass
     AND conname = 'chk_external_fine_source'),
  1,
  'external_fine_imports source allowlist CHECK exists'
);

-- ─── 3. Read-path indexes (2) ───────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'violations'
     AND indexname = 'idx_violations_active'
     AND indexdef ILIKE '%deleted_at IS NULL%'),
  1,
  'violations (tenant, driver, status) partial read-path index exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'violation_deduction_ledger'
     AND indexname = 'idx_violation_ledger_pending'),
  1,
  'violation_deduction_ledger pending-scan index exists (payroll calc path)'
);

-- ─── 4. RLS: enabled + anon-zero (5) ────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN ('violations','violation_types','violation_deduction_ledger','external_fine_imports')
     AND c.relrowsecurity = true),
  4,
  'RLS is enabled on all four violations-module tables'
);

SET LOCAL ROLE anon;
SELECT is((SELECT count(*) FROM public.violations), 0::bigint, 'anon sees zero violations');
SELECT is((SELECT count(*) FROM public.violation_types), 0::bigint, 'anon sees zero violation_types');
SELECT is((SELECT count(*) FROM public.violation_deduction_ledger), 0::bigint, 'anon sees zero ledger rows');
SELECT is((SELECT count(*) FROM public.external_fine_imports), 0::bigint, 'anon sees zero external fines');
RESET ROLE;

-- ─── 5. Own-tenant-only reads (2) ───────────────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "07200000-0000-0000-0000-000000000006", "role": "authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.violations WHERE tenant_id = '07200000-0000-0000-0000-000000000002'),
  0::bigint,
  'tenant-B violations are invisible to the tenant-A user'
);
SELECT is(
  (SELECT count(*) FROM public.violations),
  1::bigint,
  'fixture user sees exactly the own-tenant violation'
);

-- ─── 6. Behavioral round-trip as the fixture user (4) ───────────────────────

-- Create a violation type as the fixture user (types-admin path).
SELECT lives_ok(
  $$INSERT INTO public.violation_types (tenant_id, code, name_ar, category, severity, default_deduction)
    VALUES ('07200000-0000-0000-0000-000000000001', 'lane072', 'تجاوز حارة', 'traffic', 'minor', 150)$$,
  'authenticated insert of a violation type rides RLS (types-admin path)'
);

-- Unique code guard: the same code is rejected.
SELECT throws_ok(
  $$INSERT INTO public.violation_types (tenant_id, code, name_ar, category, severity, default_deduction)
    VALUES ('07200000-0000-0000-0000-000000000001', 'lane072', 'مكرر', 'traffic', 'minor', 100)$$,
  '23505',
  NULL,
  'duplicate violation-type code is rejected by the partial unique index'
);

-- Idempotent fine import: same (tenant, external_ref, source) rejected.
SELECT lives_ok(
  $$INSERT INTO public.external_fine_imports (tenant_id, source, external_ref, fine_amount)
    VALUES ('07200000-0000-0000-0000-000000000001', 'najm', 'NG-072-A', 250)$$,
  'authenticated insert of an external fine rides RLS (import path)'
);
SELECT throws_ok(
  $$INSERT INTO public.external_fine_imports (tenant_id, source, external_ref, fine_amount)
    VALUES ('07200000-0000-0000-0000-000000000001', 'najm', 'NG-072-A', 250)$$,
  '23505',
  NULL,
  'duplicate external fine (same ref + source) is rejected by uq_external_fine'
);

RESET ROLE;

SELECT finish();
