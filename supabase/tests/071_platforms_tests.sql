-- ============================================================================
-- Platforms Module — tests (pgTAP)
-- (071_platforms_tests.sql)
--
-- Proves the DB-level guarantees behind the /platforms workspace (Prompt O
-- Part 2 — pure surfacing, no schema change):
--
--   1. Natural keys the importer relies on:
--      - idx_delivery_platforms_unique_code (tenant, code) partial unique
--      - idx_daily_order_entries_unique (tenant, entry_date, driver,
--        platform, COALESCE(shift_label,'full_day')) partial unique — the
--        idempotent re-import guard
--      - idx_platform_payments_unique_period (tenant, platform, year, month)
--   2. Platform payment CHECK guards (non-negative amounts)
--   3. Read-path indexes: platform payments period index + daily-entries
--      platform filter (FK-covering idx_daily_order_entries_platform_id)
--   4. RLS: anon sees zero; fixture user sees own-tenant rows only on
--      delivery_platforms, daily_order_entries, platform_payments
--   5. BEHAVIORAL: caller-bound order/payment RPCs preserve RLS and
--      reject direct writes; the daily-entry unique key rejects a
--      duplicate re-import (23505) and accepts a distinct shift
--
-- Conventions (match 067/069/070): single transaction, SET LOCAL ROLE +
-- RESET ROLE between role switches, purge-first fixed-id fixtures, plan(22)
-- equals the actual assertion count.
-- ============================================================================

SELECT plan(22);

-- ─── Fixtures (purge-first, fixed ids) ──────────────────────────────────────

CREATE TEMP TABLE plat_fixture (
  tenant_a  uuid,
  tenant_b  uuid,
  driver_a  uuid,
  platform_a uuid,
  platform_b uuid,
  auth_id   uuid,
  user_id   uuid
);

DO $$
DECLARE
  v_t_a uuid := '07100000-0000-0000-0000-000000000001';
  v_t_b uuid := '07100000-0000-0000-0000-000000000002';
  v_d_a uuid := '07100000-0000-0000-0000-000000000003';
  v_p_a uuid := '07100000-0000-0000-0000-000000000004';
  v_p_b uuid := '07100000-0000-0000-0000-000000000005';
  v_aid uuid := '07100000-0000-0000-0000-000000000006';
  v_uid uuid := '07100000-0000-0000-0000-000000000007';
BEGIN
  DELETE FROM public.platform_payments    WHERE platform_id IN (v_p_a, v_p_b);
  DELETE FROM public.daily_order_entries  WHERE platform_id IN (v_p_a, v_p_b);
  DELETE FROM public.monthly_driver_orders WHERE platform_id = v_p_a;
  DELETE FROM public.drivers              WHERE id = v_d_a;
  DELETE FROM public.delivery_platforms   WHERE id IN (v_p_a, v_p_b);
  DELETE FROM public.users                WHERE id = v_uid;
  DELETE FROM auth.users                  WHERE id = v_aid;
  DELETE FROM public.tenants              WHERE id IN (v_t_a, v_t_b);

  INSERT INTO public.tenants (id, name_ar, name_en)
  VALUES (v_t_a, 'مستأجر اختبار المنصات', 'Platforms Tenant A'),
         (v_t_b, 'مستأجر اختبار المنصات ب', 'Platforms Tenant B');

  INSERT INTO public.drivers (id, tenant_id, full_name_ar, driver_code, primary_mobile, category, status)
  VALUES (v_d_a, v_t_a, 'سائق المنصات', 'DRV-071', '0571000001', 'freelancer', 'active');

  INSERT INTO public.delivery_platforms (id, tenant_id, code, name_ar, name_en, is_active, rate_type)
  VALUES (v_p_a, v_t_a, 'plat071', 'منصة اختبار', 'Test Platform', true, 'flat'),
         (v_p_b, v_t_b, 'plat072', 'منصة اختبار ب', 'Test Platform B', true, 'flat');

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES ('00000000-0000-0000-0000-000000000000', v_aid, 'authenticated',
          'authenticated', 'plat-fixture@test.local', crypt('x', gen_salt('bf')),
          now(), now(), now(), '{"provider":"email","providers":["email"]}',
          '{"_invite_provisioned": true}');

  INSERT INTO public.users (id, auth_user_id, tenant_id, email, role, status, must_change_password)
  VALUES (v_uid, v_aid, v_t_a, 'plat-fixture@test.local', 'supervisor', 'active', false);

  INSERT INTO public.roles (tenant_id,name,name_ar,name_en) VALUES (v_t_a,'supervisor','Fixture','Fixture');
  INSERT INTO public.role_permissions (role_id,permission_id)
  SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
  WHERE r.tenant_id=v_t_a AND r.name='supervisor'
    AND p.module IN ('platforms','orders','drivers') AND p.action IN ('read','create','update');

  INSERT INTO plat_fixture (tenant_a, tenant_b, driver_a, platform_a, platform_b, auth_id, user_id)
  VALUES (v_t_a, v_t_b, v_d_a, v_p_a, v_p_b, v_aid, v_uid);
END;
$$;

-- ─── 1. Natural keys (3) ────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'delivery_platforms'
     AND indexname = 'idx_delivery_platforms_unique_code'
     AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%deleted_at IS NULL%'),
  1,
  'delivery_platforms (tenant, code) partial UNIQUE index exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'daily_order_entries'
     AND indexname = 'idx_daily_order_entries_unique'
     AND indexdef ILIKE '%UNIQUE%'
     AND indexdef ILIKE '%COALESCE(shift_label%full_day%'),
  1,
  'daily_order_entries natural-key UNIQUE index includes COALESCE(shift_label,''full_day'') (idempotent re-import guard)'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'platform_payments'
     AND indexname = 'idx_platform_payments_unique_period'
     AND indexdef ILIKE '%UNIQUE%'),
  1,
  'platform_payments (tenant, platform, year, month) UNIQUE index exists'
);

-- ─── 2. Payment CHECK guards (2) ────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.platform_payments'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%expected_amount%>= (%):%numeric)%'),
  1,
  'platform_payments expected_amount >= 0 CHECK exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.platform_payments'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%outstanding_amount%>= (%):%numeric)%'),
  1,
  'platform_payments outstanding_amount >= 0 CHECK exists'
);

-- ─── 3. Read-path indexes (2) ───────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'platform_payments'
     AND indexname = 'idx_platform_payments_period'),
  1,
  'platform_payments period read-path index exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'daily_order_entries'
     AND indexname = 'idx_daily_order_entries_platform_id'),
  1,
  'FK-covering index on daily_order_entries(platform_id) exists (Prompt J)'
);

-- ─── 4. RLS: anon-zero + own-tenant-only (6) ────────────────────────────────

-- Seed one payment row for tenant A (as postgres).
INSERT INTO public.platform_payments (tenant_id, platform_id, period_year, period_month,
                                      expected_amount, received_amount, outstanding_amount, payment_status)
VALUES ('07100000-0000-0000-0000-000000000001', '07100000-0000-0000-0000-000000000004', 2026, 10,
        1000, 400, 600, 'partial')
ON CONFLICT DO NOTHING;

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT count(*) FROM public.delivery_platforms$$,'42501',NULL,'anonymous platform access denied');
SELECT throws_ok($$SELECT count(*) FROM public.daily_order_entries$$,'42501',NULL,'anonymous order access denied');
SELECT throws_ok($$SELECT count(*) FROM public.platform_payments$$,'42501',NULL,'anonymous payment access denied');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "07100000-0000-0000-0000-000000000006", "role": "authenticated", "aal": "aal2"}', true);
SELECT is(
  (SELECT count(*) FROM public.platform_payments WHERE platform_id = '07100000-0000-0000-0000-000000000005'),
  0::bigint,
  'tenant-B platform payments are invisible to the tenant-A user'
);
SELECT is(
  (SELECT count(*) FROM public.delivery_platforms),
  1::bigint,
  'fixture user sees exactly the own-tenant platform'
);
SELECT is(
  (SELECT count(*) FROM public.delivery_platforms WHERE id = '07100000-0000-0000-0000-000000000005'),
  0::bigint,
  'tenant-B platform is invisible to the tenant-A user'
);
RESET ROLE;

-- ─── 5. Behavioral caller-bound workflow (9) ────────────────────────────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"07100000-0000-0000-0000-000000000006","role":"authenticated","aal":"aal2"}', true);

SELECT throws_ok(
  $$INSERT INTO public.daily_order_entries
      (tenant_id, driver_id, platform_id, entry_date, shift_label, orders_delivered, gross_revenue, entry_source)
    VALUES ('07100000-0000-0000-0000-000000000001', '07100000-0000-0000-0000-000000000003',
            '07100000-0000-0000-0000-000000000004', '2026-10-01', 'morning', 12, 455.50, 'import')$$,
  '42501', NULL, 'direct order writes cannot bypass the reviewed workflow'
);
SELECT lives_ok(
  $$SELECT public.save_order_entry('{"driver_id":"07100000-0000-0000-0000-000000000003","platform_id":"07100000-0000-0000-0000-000000000004","entry_date":"2026-10-01","shift_label":"morning","orders_delivered":12,"gross_revenue":"455.50","entry_source":"import"}'::jsonb)$$,
  'caller-bound order RPC records a valid import entry'
);
SELECT throws_ok(
  $$SELECT public.save_order_entry('{"driver_id":"07100000-0000-0000-0000-000000000003","platform_id":"07100000-0000-0000-0000-000000000004","entry_date":"2026-10-01","shift_label":"morning","orders_delivered":5,"gross_revenue":"100.00","entry_source":"import"}'::jsonb)$$,
  '23505', NULL, 'duplicate import through the workflow retains the natural-key guard'
);
SELECT lives_ok(
  $$SELECT public.save_order_entry('{"driver_id":"07100000-0000-0000-0000-000000000003","platform_id":"07100000-0000-0000-0000-000000000004","entry_date":"2026-10-01","shift_label":"evening","orders_delivered":8,"gross_revenue":"300.00","entry_source":"import"}'::jsonb)$$,
  'distinct shifts remain valid through the reviewed import workflow'
);
SELECT is(
  (SELECT count(*)::integer FROM public.daily_order_entries WHERE driver_id='07100000-0000-0000-0000-000000000003'),
  2, 'duplicate rejection leaves exactly the two distinct shift entries'
);
SELECT is(
  (SELECT sum(gross_revenue) FROM public.daily_order_entries WHERE driver_id='07100000-0000-0000-0000-000000000003'),
  755.50::numeric, 'order workflow persists exact financial values without duplicate mutation'
);
SELECT throws_ok(
  $$INSERT INTO public.platform_payments
      (tenant_id,platform_id,period_year,period_month,expected_amount,received_amount,outstanding_amount,payment_status)
    VALUES ('07100000-0000-0000-0000-000000000001','07100000-0000-0000-0000-000000000004',2026,9,800,800,0,'paid')$$,
  '42501', NULL, 'direct platform payment writes cannot bypass the reviewed workflow'
);
SELECT lives_ok(
  $$SELECT public.save_platform_payment('{"platform_id":"07100000-0000-0000-0000-000000000004","period_year":2026,"period_month":9,"expected_amount":"800.00","received_amount":"800.00","payment_date":"2026-09-30"}'::jsonb)$$,
  'caller-bound payment RPC records a valid platform receipt'
);
SELECT ok(
  EXISTS(SELECT 1 FROM public.platform_payments WHERE platform_id='07100000-0000-0000-0000-000000000004'
    AND period_year=2026 AND period_month=9 AND expected_amount=800 AND received_amount=800
    AND outstanding_amount=0 AND payment_status='paid' AND payment_date='2026-09-30'),
  'platform receipt persists exact amounts, computed status, and payment date'
);
RESET ROLE;
SELECT finish();
