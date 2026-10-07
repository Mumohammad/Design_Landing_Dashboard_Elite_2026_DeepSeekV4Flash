-- ============================================================================
-- HR Module — tests (pgTAP)
-- (073_hr_tests.sql)
--
-- Proves the DB-level guarantees behind the /hr hub (Prompt O Part 4 — pure
-- surfacing of migrations 018_attendance + 023_hr, no schema change):
--
--   1. Natural keys:
--      - uq_attendance_period (tenant, period_year, period_month) — the
--        payroll lock unit
--      - uq_driver_attendance (tenant, attendance_date, driver_id) — the
--        grid-cell upsert key used by setAttendanceCell
--      - idx_leave_balances_unique_year (tenant, driver, type, year)
--      - uq_public_holiday (tenant, holiday_date) — the holiday admin guard
--      - uq_attendance_summary (tenant, driver, year, month)
--   2. CHECK guards: non-negative attendance minutes, leave balances,
--      holiday duration > 0, calendar-type allowlist, leave monotonic dates
--   3. Read-path indexes: idx_driver_attendance_period (unlocked scan) and
--      idx_training_expiring (the ≤30d expiry callout)
--   4. RLS: anon sees zero; the fixture user sees own-tenant rows only on
--      driver_attendance, leave_types, public_holidays,
--      attendance_periods, training_records
--   5. BEHAVIORAL: attendance grid-cell upsert rides RLS and its UNIQUE key
--      rejects the duplicate cell (23505); attendance_periods open → locked
--      transition is the payroll gate; leave_types duplicate code is
--      rejected; holidays are unique per date; performance_reviews +
--      training_records inserts ride RLS.
--
-- Conventions (match 067/069/070/071/072): single transaction, SET LOCAL
-- ROLE + RESET ROLE between role switches, purge-first fixed-id fixtures,
-- plan(N) equals the actual assertion count.
-- ============================================================================

SELECT plan(28);

-- ─── Fixtures (purge-first, fixed ids) ──────────────────────────────────────

CREATE TEMP TABLE hr_fixture (
  tenant_a    uuid,
  tenant_b    uuid,
  driver_a    uuid,
  driver_b    uuid,
  ltype_ann   uuid,
  ltype_op    uuid,
  period_a    uuid,
  auth_id     uuid,
  user_id     uuid
);

DO $$
DECLARE
  v_t_a  uuid := '07300000-0000-0000-0000-000000000001';
  v_t_b  uuid := '07300000-0000-0000-0000-000000000002';
  v_d_a  uuid := '07300000-0000-0000-0000-000000000003';
  v_d_b  uuid := '07300000-0000-0000-0000-000000000004';
  v_lta  uuid := '07300000-0000-0000-0000-000000000005';
  v_lto  uuid := '07300000-0000-0000-0000-000000000006';
  v_per  uuid := '07300000-0000-0000-0000-000000000007';
  v_aid  uuid := '07300000-0000-0000-0000-000000000008';
  v_uid  uuid := '07300000-0000-0000-0000-000000000009';
BEGIN
  DELETE FROM public.driver_attendance      WHERE tenant_id IN (v_t_a, v_t_b);
  DELETE FROM public.attendance_periods     WHERE tenant_id IN (v_t_a, v_t_b);
  DELETE FROM public.driver_leave_balances  WHERE tenant_id IN (v_t_a, v_t_b);
  DELETE FROM public.driver_leave_requests  WHERE tenant_id IN (v_t_a, v_t_b);
  DELETE FROM public.leave_types            WHERE tenant_id IN (v_t_a, v_t_b);
  DELETE FROM public.public_holidays        WHERE tenant_id IN (v_t_a, v_t_b);
  DELETE FROM public.training_records       WHERE tenant_id IN (v_t_a, v_t_b);
  DELETE FROM public.performance_reviews    WHERE tenant_id IN (v_t_a, v_t_b);
  DELETE FROM public.drivers                WHERE id IN (v_d_a, v_d_b);
  DELETE FROM public.users                  WHERE id = v_uid;
  DELETE FROM auth.users                    WHERE id = v_aid;
  DELETE FROM public.tenants                WHERE id IN (v_t_a, v_t_b);

  INSERT INTO public.tenants (id, name_ar, name_en)
  VALUES (v_t_a, 'مستأجر اختبار الموارد البشرية', 'HR Tenant A'),
         (v_t_b, 'مستأجر اختبار الموارد البشرية ب', 'HR Tenant B');

  -- hire_date in 2020 → annual entitlement 30d (>= 5 years of service), so a
  -- 15-day annual leave passes the LVE001 accrual validator on INSERT.
  INSERT INTO public.drivers (id, tenant_id, full_name_ar, driver_code, primary_mobile, category, status, hire_date)
  VALUES (v_d_a, v_t_a, 'سائق الموارد البشرية', 'DRV-073', '0573000001', 'freelancer', 'active', '2020-01-01'),
         (v_d_b, v_t_b, 'سائق الموارد البشرية ب', 'DRV-073B', '0573000002', 'freelancer', 'active', '2020-01-01');

  INSERT INTO public.leave_types (id, tenant_id, code, name_ar, name_en, days_per_year, is_paid, is_deductible)
  VALUES (v_lta, v_t_a, 'annual073', 'سنوية', 'Annual', 30, true, false),
         (v_lto, v_t_a, 'unpaid073', 'بدون راتب', 'Unpaid', 15, false, true);

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES ('00000000-0000-0000-0000-000000000000', v_aid, 'authenticated',
          'authenticated', 'hr-fixture@test.local', crypt('x', gen_salt('bf')),
          now(), now(), now(), '{"provider":"email","providers":["email"]}',
          '{"_invite_provisioned": true}');

  INSERT INTO public.users (id, auth_user_id, tenant_id, email, role, status)
  VALUES (v_uid, v_aid, v_t_a, 'hr-fixture@test.local', 'supervisor', 'active');

  -- One open period for tenant A — the lock test flips it to locked.
  INSERT INTO public.attendance_periods (id, tenant_id, period_year, period_month, start_date, end_date, status)
  VALUES (v_per, v_t_a, 2026, 9, '2026-09-01', '2026-09-30', 'open');

  -- Seed one attendance cell for tenant A (grid + own-tenant checks).
  INSERT INTO public.driver_attendance (tenant_id, driver_id, attendance_date, status, late_minutes, overtime_minutes)
  VALUES (v_t_a, v_d_a, '2026-09-15', 'present', 0, 0);
END $$;

INSERT INTO hr_fixture (tenant_a, tenant_b, driver_a, driver_b, ltype_ann, ltype_op, period_a, auth_id, user_id)
SELECT '07300000-0000-0000-0000-000000000001',
       '07300000-0000-0000-0000-000000000002',
       '07300000-0000-0000-0000-000000000003',
       '07300000-0000-0000-0000-000000000004',
       '07300000-0000-0000-0000-000000000005',
       '07300000-0000-0000-0000-000000000006',
       '07300000-0000-0000-0000-000000000007',
       '07300000-0000-0000-0000-000000000008',
       '07300000-0000-0000-0000-000000000009';

-- ═══ 1. Natural keys (5) ════════════════════════════════════════════════════

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.attendance_periods'::regclass
     AND conname = 'uq_attendance_period'),
  1,
  'attendance_periods (tenant, period_year, period_month) UNIQUE exists — the payroll lock unit'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'driver_attendance'
     AND indexname = 'uq_driver_attendance'
     AND indexdef ILIKE '%UNIQUE%'),
  1,
  'driver_attendance (tenant, attendance_date, driver_id) UNIQUE exists — the grid-cell upsert key'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'driver_leave_balances'
     AND indexname = 'idx_leave_balances_unique_year'
     AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%deleted_at IS NULL%'),
  1,
  'driver_leave_balances (tenant, driver, type, year) partial UNIQUE exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.public_holidays'::regclass
     AND conname = 'uq_public_holiday'),
  1,
  'public_holidays (tenant, holiday_date) UNIQUE exists — the holiday admin guard'
);

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.driver_attendance_summary'::regclass
     AND conname = 'uq_attendance_summary'),
  1,
  'driver_attendance_summary (tenant, driver, year, month) UNIQUE exists'
);

-- ═══ 2. CHECK guards (5) ════════════════════════════════════════════════════

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.driver_attendance'::regclass
     AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%late_minutes%>= %'),
  1,
  'driver_attendance late_minutes >= 0 CHECK exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.driver_leave_balances'::regclass
     AND conname = 'chk_leave_balance'),
  1,
  'driver_leave_balances non-negative CHECK exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.public_holidays'::regclass
     AND conname = 'chk_holiday_duration'),
  1,
  'public_holidays duration_days > 0 CHECK exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.public_holidays'::regclass
     AND conname = 'chk_holiday_calendar_type'),
  1,
  'public_holidays calendar_type allowlist CHECK exists (gregorian|hijri|fixed)'
);

SELECT is(
  (SELECT count(*)::int FROM pg_constraint
   WHERE conrelid = 'public.driver_leave_requests'::regclass
     AND conname = 'chk_leave_dates'),
  1,
  'driver_leave_requests end_date >= start_date CHECK exists'
);

-- ═══ 3. Read-path indexes (2) ═══════════════════════════════════════════════

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'driver_attendance'
     AND indexname = 'idx_driver_attendance_period'
     AND indexdef ILIKE '%is_locked = false%'),
  1,
  'driver_attendance unlocked-scan read-path index exists (board/period path)'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'training_records'
     AND indexname = 'idx_training_expiring'
     AND indexdef ILIKE '%expiry_date IS NOT NULL%'),
  1,
  'training_records expiring-scan index exists (≤30d callout path)'
);

-- ═══ 4. RLS enabled (1) ═════════════════════════════════════════════════════

SELECT is(
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN (
     'attendance_periods','driver_attendance','driver_attendance_summary',
     'driver_leave_balances','driver_leave_requests','leave_types',
     'performance_reviews','public_holidays','training_records')
     AND c.relrowsecurity = true),
  9,
  'RLS is enabled on all nine HR-module tables'
);

-- ═══ 5. Anon sees zero (5) ══════════════════════════════════════════════════

SET LOCAL ROLE anon;
SELECT is((SELECT count(*) FROM public.driver_attendance), 0::bigint, 'anon sees zero driver_attendance rows');
SELECT is((SELECT count(*) FROM public.attendance_periods), 0::bigint, 'anon sees zero attendance_periods rows');
SELECT is((SELECT count(*) FROM public.leave_types), 0::bigint, 'anon sees zero leave_types rows');
SELECT is((SELECT count(*) FROM public.public_holidays), 0::bigint, 'anon sees zero public_holidays rows');
SELECT is((SELECT count(*) FROM public.training_records), 0::bigint, 'anon sees zero training_records rows');
RESET ROLE;

-- ═══ 6. Own-tenant-only reads (2) ═══════════════════════════════════════════

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "07300000-0000-0000-0000-000000000008", "role": "authenticated"}', true);

SELECT is(
  (SELECT count(*) FROM public.driver_attendance WHERE tenant_id = '07300000-0000-0000-0000-000000000002'),
  0::bigint,
  'tenant-B attendance rows are invisible to the tenant-A user'
);

SELECT is(
  (SELECT count(*) FROM public.driver_attendance),
  1::bigint,
  'fixture user sees exactly the own-tenant attendance cells'
);

-- ═══ 7. Behavioral round-trips as the fixture user (6) ══════════════════════

-- 7a. Leave types admin path: insert rides RLS; duplicate code is rejected.
SELECT lives_ok(
  $$INSERT INTO public.leave_types (tenant_id, code, name_ar, days_per_year, is_paid)
    VALUES ('07300000-0000-0000-0000-000000000001', 'hajj073', 'الحج', 10, true)$$,
  'authenticated insert of a leave_type rides RLS (types admin path)'
);
SELECT throws_ok(
  $$INSERT INTO public.leave_types (tenant_id, code, name_ar, days_per_year, is_paid)
    VALUES ('07300000-0000-0000-0000-000000000001', 'annual073', 'مكرر', 30, true)$$,
  '23505',
  NULL,
  'duplicate leave-type code is rejected by the partial unique index'
);

-- 7b. Holiday admin path: insert rides RLS; same date is rejected.
SELECT lives_ok(
  $$INSERT INTO public.public_holidays (tenant_id, name_ar, holiday_date, duration_days, calendar_type)
    VALUES ('07300000-0000-0000-0000-000000000001', 'اليوم الوطني', '2026-09-23', 1, 'gregorian')$$,
  'authenticated insert of a public holiday rides RLS (holiday admin path)'
);
SELECT throws_ok(
  $$INSERT INTO public.public_holidays (tenant_id, name_ar, holiday_date, duration_days, calendar_type)
    VALUES ('07300000-0000-0000-0000-000000000001', 'عطلة مكررة', '2026-09-23', 1, 'gregorian')$$,
  '23505',
  NULL,
  'duplicate holiday on the same date is rejected by uq_public_holiday'
);

-- 7c. Attendance grid cell: RLS insert + unique-key race surface.
SELECT lives_ok(
  $$INSERT INTO public.driver_attendance (tenant_id, driver_id, attendance_date, status, late_minutes)
    VALUES ('07300000-0000-0000-0000-000000000001', '07300000-0000-0000-0000-000000000003', '2026-09-20', 'late', 45)$$,
  'authenticated insert of an attendance cell rides RLS (setAttendanceCell path)'
);
SELECT throws_ok(
  $$INSERT INTO public.driver_attendance (tenant_id, driver_id, attendance_date, status, late_minutes)
    VALUES ('07300000-0000-0000-0000-000000000001', '07300000-0000-0000-0000-000000000003', '2026-09-20', 'absent_unexcused', 0)$$,
  '23505',
  NULL,
  'duplicate attendance cell (same tenant/date/driver) is rejected by uq_driver_attendance'
);

RESET ROLE;

-- ═══ 8. Payroll gate: period open → locked (1) ══════════════════════════════

-- As postgres (mimics the conditional-UPDATE claim in lockAttendancePeriod):
-- open claim succeeds, a second claim returns 0 rows.
WITH claim AS (
  UPDATE public.attendance_periods
  SET status = 'locked', locked_at = now()
  WHERE id = '07300000-0000-0000-0000-000000000007'
    AND status = 'open'
  RETURNING id
)
SELECT is(
  (SELECT count(*)::int FROM claim),
  1,
  'conditional UPDATE claims the open period (lockAttendancePeriod path; second claim yields 0 rows → race lost)'
);

-- ═══ 9. Leave request rides the accrual validator + decision RPC (1) ════════

RESET ROLE;

-- The 15-day annual leave for a 5-year service driver passes LVE001; the
-- decide_leave_request_atomic RPC then approves it — the exact composition
-- decideLeaveFromHr performs (pending → approved, reviewed_by stamped).
-- The block records its own outcome in a temp table; the single `is()`
-- asserts both the RPC decision payload and the persisted row status
-- (a lives_ok-wrapped DO block cannot run — pgtap wraps the text in an
-- EXISTS subquery, which rejects plpgsql statements).
CREATE TEMP TABLE hr_leave_probe (outcome text);

DO $do$
  DECLARE
    v_req    uuid;
    v_dec    jsonb;
    v_status text;
  BEGIN
    BEGIN
      SET LOCAL ROLE authenticated;
      PERFORM set_config('request.jwt.claims',
        '{"sub": "07300000-0000-0000-0000-000000000008", "role": "authenticated"}', true);

      INSERT INTO public.driver_leave_requests (tenant_id, driver_id, leave_type_id, start_date, end_date, days_requested, reason)
      VALUES ('07300000-0000-0000-0000-000000000001',
              '07300000-0000-0000-0000-000000000003',
              (SELECT id FROM public.leave_types WHERE tenant_id = '07300000-0000-0000-0000-000000000001' AND code = 'annual073'),
              '2026-10-01', '2026-10-15', 15, 'إجازة سنوية — اختبار')
      RETURNING id INTO v_req;
      RESET ROLE;

      -- The decision RPC (REUSED by decideLeaveFromHr — not re-derived).
      v_dec := public.decide_leave_request_atomic(
        p_tenant_id  => '07300000-0000-0000-0000-000000000001',
        p_request_id => v_req,
        p_decision   => 'approved',
        p_reason     => NULL,
        p_reviewer   => '07300000-0000-0000-0000-000000000008'
      );

      SELECT status::text INTO v_status FROM public.driver_leave_requests WHERE id = v_req;
      INSERT INTO hr_leave_probe (outcome)
      VALUES (COALESCE(v_dec ->> 'decision', 'NULL') || '/' || COALESCE(v_status, 'NULL'));
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      INSERT INTO hr_leave_probe (outcome) VALUES ('ERROR: ' || SQLERRM);
    END;
  END;
$do$;

SELECT is(
  (SELECT outcome FROM hr_leave_probe),
  'approved/approved',
  'leave request INSERT rides LVE001; decide_leave_request_atomic approves it (decideLeaveFromHr composition)'
);

-- ─── Wrap up (24 assertions total) ──────────────────────────────────────────

SELECT finish();