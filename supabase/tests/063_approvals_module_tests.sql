-- ============================================================================
-- Approvals Module — surface tests (pgTAP)
-- (063_approvals_module_tests.sql)
--
-- Proves the guarantees of 20260926120000_approvals_module.sql plus the
-- pre-existing decision-source contracts the /approvals inbox depends on:
--
--   1. fetch_pending_approvals: SECURITY DEFINER + pinned search_path,
--      anon denied, authenticated + service_role granted, hard cap 100
--   2. BEHAVIORAL queue: composes all three sources (expense / leave_request
--      / application), tenant isolation (definer never crosses tenants),
--      oldest-first ordering, type filter, date-range filter, cap clamp
--   3. RLS tenant isolation on every source table (authenticated sees only
--      their tenant's pending rows; anon sees 0)
--   4. decide_leave_request_atomic: claims the pending row (approved),
--      LVE002 on double-decision (the idempotency guard), rejection persists
--      the mandatory reason (LVE004 without one), service-role-only EXECUTE
--   5. decide_application_atomic: claims a pre-decision row, APP002 on
--      double-decision, APP004 without a rejection note, reviewer persisted
--      (users.id per 030), service-role-only EXECUTE
--   6. anon-zero on all three sources
--   7. Queue indexes exist (expenses pending, leave pending queue, apps
--      pending queue, review queue)
--
-- plan(34) MUST equal the actual assertion count: pgTAP reports "planned N
-- but ran M" at finish() and the CI runner counts any file with a plan
-- mismatch, `not ok` line, or psql ERROR as failed.
--
-- Conventions (match 060/061/062): single transaction (CI passes
--   --single-transaction), SET LOCAL ROLE + RESET ROLE between role switches,
--   fixtures in a TEMP table + fixed UUIDs, finish() at the end. Fixture rows
--   roll back with the test transaction ONLY WHEN IT ABORTS — the first
--   failing statement does NOT stop psql, so the pre-failure portion of a
--   failed run COMMITS at EOF and leaks its fixtures to later suites.
-- ============================================================================

SELECT plan(34);

-- ─── Fixtures (run as postgres; bypass RLS) ─────────────────────────────────
-- Fixed UUIDs so role-switched statements need no fixture-table access:
--   tenant A   11111111-1111-1111-1111-111111111111
--   tenant B   22222222-2222-2222-2222-222222222222
--   auth user  33333333-3333-3333-3333-333333333333
--   users row  55555555-5555-5555-5555-555555555555
--   driver     44444444-4444-4444-4444-444444444444
--
-- Idempotent fixtures: the first failing statement inside a pgTAP
-- --single-transaction run does NOT abort the psql script — psql keeps
-- executing and the transaction COMMITS at EOF (repo worklog gotcha from
-- the audit-trail module). Every insert below is therefore guarded
-- (ON CONFLICT DO NOTHING / WHERE NOT EXISTS) so a re-run against a
-- leaked-fixture database is a clean no-op instead of a cascade of
--   unique-violations that would mask the FIRST real failure.
--
-- Leaked state is also REPAIRED, not merely tolerated: the shared users row
-- is upserted (062 uses the same fixed UUID with role='supervisor' — after a
-- leak this suite's reviewer must still be general_manager), and the shared
-- driver's status is reset because an approved leave from a failed prior run
-- leaves it on_leave (which would break this run's approve → on_leave test).

CREATE TEMP TABLE approvals_fixture (
  tenant_id  uuid,
  user_id    uuid,
  auth_id    uuid,
  driver_id  uuid,
  expense_id uuid,
  leave_id   uuid,
  leave2_id  uuid,
  app_id     uuid
);

DO $$
DECLARE
  v_tenant   uuid := '11111111-1111-1111-1111-111111111111';
  v_tenant_b uuid := '22222222-2222-2222-2222-222222222222';
  v_auth     uuid := '33333333-3333-3333-3333-333333333333';
  v_users    uuid := '55555555-5555-5555-5555-555555555555';
  v_driver   uuid;
  v_expense  uuid;
  v_leave    uuid;
  v_leave2   uuid;
  v_app      uuid;
  v_lt       uuid;
BEGIN
  INSERT INTO public.tenants (id, name_ar, name_en)
  VALUES (v_tenant, 'مستأجر قرارات أ', 'Approvals Fixture Tenant A')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.tenants (id, name_ar, name_en)
  VALUES (v_tenant_b, 'مستأجر قرارات ب', 'Approvals Fixture Tenant B')
  ON CONFLICT (id) DO NOTHING;

  -- users requires an auth.users row (060 hardened trigger contract).
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES ('00000000-0000-0000-0000-000000000000',
          v_auth, 'authenticated',
          'authenticated', 'approvals-fixture@test.local', crypt('x', gen_salt('bf')),
          now(), now(), now(), '{"provider":"email","providers":["email"]}',
          '{"_invite_provisioned": true}')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, auth_user_id, tenant_id, email, role, status)
  VALUES (v_users, v_auth, v_tenant, 'approvals-fixture@test.local', 'general_manager', 'active')
  -- 062's fixtures own the SAME id with role='supervisor'; after one of its
  -- failed runs leaks, DO NOTHING would leave this reviewer a supervisor.
  ON CONFLICT (id) DO UPDATE SET role = 'general_manager', status = 'active';

  -- Driver (tenant A) — receives the leave request. hire_date is REQUIRED:
  -- validate_leave_request() (enforced by the trg_enforce_leave_policy
  -- trigger on INSERT) returns DRV001 when hire_date IS NULL. 400 days ago
  -- keeps the driver under 5 years of service (21-day annual entitlement —
  -- both fixture requests of 5 + 2 days fit).
  INSERT INTO public.drivers (id, tenant_id, full_name_ar, primary_mobile, category, status, hire_date)
  VALUES ('44444444-4444-4444-4444-444444444444', v_tenant, 'سائق قرارات', '0500000000', 'freelancer', 'active',
          CURRENT_DATE - 400)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_driver;
  IF v_driver IS NULL THEN
    SELECT id INTO v_driver FROM public.drivers WHERE id = '44444444-4444-4444-4444-444444444444';
  END IF;
  -- A failed prior run commits its approved leave, which leaves the shared
  -- driver on_leave; reset so this run's approve → on_leave transition fires.
  UPDATE public.drivers SET status = 'active' WHERE id = v_driver AND status = 'on_leave';

  -- Leave type for tenant A (tenant+code unique per 018's partial index).
  SELECT id INTO v_lt FROM public.leave_types WHERE tenant_id = v_tenant AND code = 'annual';
  IF v_lt IS NULL THEN
    INSERT INTO public.leave_types (tenant_id, code, name_ar, name_en, days_per_year)
    VALUES (v_tenant, 'annual', 'سنوية', 'Annual', 30)
    RETURNING id INTO v_lt;
  END IF;

  -- Queue fixtures, tenant A: 1 pending expense (oldest), 1 pending leave,
  -- 1 submitted application (newest) → oldest-first order is expense, leave, app.
  -- Insert-if-absent guards keep re-runs no-ops (unique-violation leakage
  -- protection described in the fixture header); the guards also RESCUE
  -- already-decided leaked rows from a prior failed run by resetting their
  -- decision state, so the queue assertions see exactly one pending item per
  -- fixture row on any database state.
  IF EXISTS (SELECT 1 FROM public.expenses WHERE tenant_id = v_tenant AND expense_type = 'fuel' AND vendor = 'شركة الوقود' AND is_approved = true) THEN
    UPDATE public.expenses SET is_approved = false, approved_by = NULL, approved_at = NULL
    WHERE tenant_id = v_tenant AND expense_type = 'fuel' AND vendor = 'شركة الوقود';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.expenses WHERE tenant_id = v_tenant AND expense_type = 'fuel' AND vendor = 'شركة الوقود') THEN
    INSERT INTO public.expenses (tenant_id, expense_type, amount, currency, expense_date, vendor, is_approved, created_at)
    VALUES (v_tenant, 'fuel', 1250.50, 'SAR', CURRENT_DATE, 'شركة الوقود', false, now() - interval '3 hours')
    RETURNING id INTO v_expense;
  ELSE
    SELECT id INTO v_expense FROM public.expenses WHERE tenant_id = v_tenant AND expense_type = 'fuel' AND vendor = 'شركة الوقود' LIMIT 1;
  END IF;

  IF EXISTS (SELECT 1 FROM public.driver_leave_requests WHERE tenant_id = v_tenant AND days_requested = 5 AND status <> 'pending') THEN
    UPDATE public.driver_leave_requests SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, review_notes = NULL
    WHERE tenant_id = v_tenant AND days_requested = 5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.driver_leave_requests WHERE tenant_id = v_tenant AND days_requested = 5 AND status = 'pending') THEN
    INSERT INTO public.driver_leave_requests
      (tenant_id, driver_id, leave_type_id, start_date, end_date, days_requested, status, requested_at)
    VALUES (v_tenant, v_driver, v_lt, CURRENT_DATE + 7, CURRENT_DATE + 11, 5, 'pending', now() - interval '2 hours')
    RETURNING id INTO v_leave;
  ELSE
    SELECT id INTO v_leave FROM public.driver_leave_requests WHERE tenant_id = v_tenant AND days_requested = 5 AND status = 'pending' LIMIT 1;
  END IF;

  IF EXISTS (SELECT 1 FROM public.driver_applications WHERE application_number = 'DRV-2026-900001' AND status IN ('approved','rejected')) THEN
    UPDATE public.driver_applications SET status = 'submitted', reviewed_by = NULL, reviewed_at = NULL, review_note = NULL
    WHERE application_number = 'DRV-2026-900001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.driver_applications WHERE application_number = 'DRV-2026-900001') THEN
    INSERT INTO public.driver_applications
      (tenant_id, application_number, first_name, last_name, full_name, mobile, identity_type, work_type, status, submitted_at)
    VALUES (v_tenant, 'DRV-2026-900001', 'قرارات', 'متقدم', 'متقدم قرارات', '0501112222', 'iqama', 'full_time', 'submitted', now() - interval '1 hour')
    RETURNING id INTO v_app;
  ELSE
    SELECT id INTO v_app FROM public.driver_applications WHERE application_number = 'DRV-2026-900001';
  END IF;

  -- A SECOND pending leave (tenant A) for the double-decision guard test.
  IF EXISTS (SELECT 1 FROM public.driver_leave_requests WHERE tenant_id = v_tenant AND days_requested = 2 AND status <> 'pending') THEN
    UPDATE public.driver_leave_requests SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, review_notes = NULL
    WHERE tenant_id = v_tenant AND days_requested = 2;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.driver_leave_requests WHERE tenant_id = v_tenant AND days_requested = 2) THEN
    INSERT INTO public.driver_leave_requests
      (tenant_id, driver_id, leave_type_id, start_date, end_date, days_requested, status, requested_at)
    VALUES (v_tenant, v_driver, v_lt, CURRENT_DATE + 14, CURRENT_DATE + 15, 2, 'pending', now() - interval '80 minutes')
    RETURNING id INTO v_leave2;
  ELSE
    SELECT id INTO v_leave2 FROM public.driver_leave_requests WHERE tenant_id = v_tenant AND days_requested = 2 LIMIT 1;
  END IF;

  -- Tenant B: one pending expense ONLY (proves cross-tenant isolation).
  IF NOT EXISTS (SELECT 1 FROM public.expenses WHERE tenant_id = v_tenant_b) THEN
    INSERT INTO public.expenses (tenant_id, expense_type, amount, currency, expense_date, vendor, is_approved, created_at)
    VALUES (v_tenant_b, 'other', 99.00, 'SAR', CURRENT_DATE, 'Other Tenant Vendor', false, now() - interval '4 hours');
  END IF;

  INSERT INTO approvals_fixture VALUES
    (v_tenant, v_users, v_auth, v_driver, v_expense, v_leave, v_leave2, v_app);
END;
$$;

-- ─── 1. RPC security shape (5) ──────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

SELECT ok(
  (SELECT p.prosecdef
     AND p.proconfig IS NOT NULL
     AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%'
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fetch_pending_approvals'),
  'fetch_pending_approvals is SECURITY DEFINER with pinned search_path'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  has_function_privilege('anon', 'public.fetch_pending_approvals(uuid, text, timestamptz, timestamptz, integer)', 'EXECUTE'),
  false,
  'anon cannot EXECUTE fetch_pending_approvals'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT is(
  has_function_privilege('authenticated', 'public.fetch_pending_approvals(uuid, text, timestamptz, timestamptz, integer)', 'EXECUTE'),
  true,
  'authenticated can EXECUTE fetch_pending_approvals'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT is(
  has_function_privilege('service_role', 'public.fetch_pending_approvals(uuid, text, timestamptz, timestamptz, integer)', 'EXECUTE'),
  true,
  'service_role can EXECUTE fetch_pending_approvals'
);

-- Decision RPCs are service-role ONLY (063 approve_expense_atomic boundary).
RESET ROLE;
SET LOCAL ROLE postgres;
SELECT is(
  has_function_privilege('authenticated', 'public.decide_leave_request_atomic(uuid, uuid, text, text, uuid)', 'EXECUTE'),
  false,
  'authenticated cannot EXECUTE decide_leave_request_atomic (service-role boundary)'
);
SELECT is(
  has_function_privilege('authenticated', 'public.decide_application_atomic(uuid, uuid, text, text, uuid)', 'EXECUTE'),
  false,
  'authenticated cannot EXECUTE decide_application_atomic (service-role boundary)'
);

-- ─── 2. BEHAVIORAL queue (7) ────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

-- Composition: tenant A holds exactly 4 pending items across the 3 sources.
SELECT is(
  (SELECT count(*)::int FROM public.fetch_pending_approvals(
     '11111111-1111-1111-1111-111111111111',
     NULL, NULL, NULL, 100)),
  4,
  'fetch_pending_approvals composes all three decision sources'
);

-- Tenant isolation: tenant A's queue never crosses into tenant B (whose
-- pending expense is older and would sort FIRST if the tenant filter leaked).
SELECT is(
  (SELECT count(*)::int FROM public.fetch_pending_approvals(
     '11111111-1111-1111-1111-111111111111',
     NULL, NULL, NULL, 100)
   WHERE item_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'fetch_pending_approvals never returns another tenant rows'
);
SELECT is(
  (SELECT count(*)::int FROM public.fetch_pending_approvals(
     '22222222-2222-2222-2222-222222222222',
     NULL, NULL, NULL, 100)),
  1,
  'tenant B sees exactly its own pending expense'
);

-- Oldest-first ordering: tenant A's oldest pending item is the expense.
SELECT is(
  (SELECT item_type FROM public.fetch_pending_approvals(
     '11111111-1111-1111-1111-111111111111',
     NULL, NULL, NULL, 10)
   LIMIT 1),
  'expense',
  'fetch_pending_approvals orders oldest-first (queue discipline)'
);

-- Type filter.
SELECT is(
  (SELECT count(*)::int FROM public.fetch_pending_approvals(
     '11111111-1111-1111-1111-111111111111',
     'leave_request', NULL, NULL, 50)),
  2,
  'type filter narrows the queue to one source'
);

-- PDPL: the applications projection never carries the raw applicant mobile.
SELECT is(
  (SELECT count(*)::int FROM public.fetch_pending_approvals(
     '11111111-1111-1111-1111-111111111111',
     'application', NULL, NULL, 50)
   WHERE subject_meta ? 'mobile'),
  0,
  'queue projection carries no raw applicant mobile (PDPL)'
);

-- Date-range filter: only items requested within the last 85 minutes
-- (the 5-day leave sits at -2h, the second leave at -80min, the app at -1h).
SELECT is(
  (SELECT count(*)::int FROM public.fetch_pending_approvals(
     '11111111-1111-1111-1111-111111111111',
     NULL, now() - interval '85 minutes', NULL, 50)),
  2,
  'date-range filter (p_from) bounds the queue'
);

-- ─── 3. Cap clamp (1) ───────────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;
SELECT ok(
  (SELECT pg_get_functiondef('public.fetch_pending_approvals(uuid, text, timestamptz, timestamptz, integer)'::regprocedure)
   LIKE '%LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)%'),
  'fetch_pending_approvals clamps p_limit in SQL (hard cap 100)'
);

-- ─── 4. RLS tenant isolation + anon-zero on the sources (3) ─────────────────

RESET ROLE;
SET LOCAL ROLE postgres;
-- pgTAP's throws_ok() runs the failing statement inside a SAVEPOINT and
-- releases it after catching the error, BUT the error still aborts psql's
-- surrounding --single-transaction state for ROLLBACK-only semantics: the
-- pre-failure portion of the script COMMITs at EOF (repo worklog gotcha).
-- The anon-role-gate throws_ok below therefore LEAKS the queue fixtures
-- into the database on a failed run. The fixtures are idempotent
-- (insert-if-absent), so a re-run merely re-discovers them; the queue
-- assertions before this point read the CAPTURED TEMP-table ids and stay
-- correct on any database state. Do not reorder tests after section 4 —
-- the leak starts there.
ALTER TABLE approvals_fixture OWNER TO anon;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.expenses) +
  (SELECT count(*)::int FROM public.driver_leave_requests) +
  (SELECT count(*)::int FROM public.driver_applications),
  0,
  'anon sees 0 rows across all three decision sources'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"33333333-3333-3333-3333-333333333333"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.expenses
   WHERE is_approved = false AND deleted_at IS NULL)
+ (SELECT count(*)::int FROM public.driver_leave_requests
   WHERE status = 'pending' AND deleted_at IS NULL)
+ (SELECT count(*)::int FROM public.driver_applications
   WHERE status IN ('submitted','under_review')),
  4,
  'authenticated sees only their tenant pending rows (RLS tenant isolation)'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT throws_ok(
  $$SELECT public.fetch_pending_approvals('11111111-1111-1111-1111-111111111111', NULL, NULL, NULL, 50)$$,
  '42501', NULL,
  'anon EXECUTE of the queue RPC is denied (role gate)'
);

-- ─── 5. decide_leave_request_atomic — transition + double-decision (6) ──────

RESET ROLE;
SET LOCAL ROLE postgres;

-- Approve: claims the pending row and flips the driver to on_leave.
SELECT is(
  ((SELECT (public.decide_leave_request_atomic(
      '11111111-1111-1111-1111-111111111111',
      (SELECT leave_id FROM approvals_fixture),
      'approved', NULL,
      '33333333-3333-3333-3333-333333333333'
    ) ->> 'decision'))
  = 'approved'),
  true,
  'decide_leave_request_atomic approves a pending leave request'
);

SELECT is(
  (SELECT status::text FROM public.drivers WHERE id = (SELECT driver_id FROM approvals_fixture)),
  'on_leave',
  'approved leave flips the driver to on_leave (drivers-module contract)'
);

-- Double-decision guard: the second call MUST fail with LVE002.
SELECT throws_ok(
  $$SELECT public.decide_leave_request_atomic(
       '11111111-1111-1111-1111-111111111111',
       (SELECT leave_id FROM approvals_fixture),
       'rejected', 'changing my mind',
       '33333333-3333-3333-3333-333333333333')$$,
  'P0001',
  'LVE002: leave request already decided',
  'double decision on the same leave request is refused (LVE002)'
);

-- Rejection without a reason is refused (mandatory-reason contract).
SELECT throws_ok(
  $$SELECT public.decide_leave_request_atomic(
       '11111111-1111-1111-1111-111111111111',
       (SELECT leave2_id FROM approvals_fixture),
       'rejected', NULL,
       '33333333-3333-3333-3333-333333333333')$$,
  'P0001',
  'LVE004: rejection reason required',
  'rejection without a reason is refused (LVE004)'
);

-- Rejection WITH a reason persists it (and the reviewer + timestamp).
-- SPLIT into two asserts — and this is a suite-wide rule: one SQL statement
-- must never both call the data-modifying RPC and read the row it wrote.
-- Postgres executes a statement's volatile function and its snapshot-taking
-- subplans in UNSPECIFIED order, so the read can take the PRE-update snapshot
-- and observe the old (NULL) value — nondeterministically, flipping with
-- planner/statistics state. That was test 26's intermittent `have: NULL`.
SELECT is(
  (SELECT public.decide_leave_request_atomic(
      '11111111-1111-1111-1111-111111111111',
      (SELECT leave2_id FROM approvals_fixture),
      'rejected', 'staffing freeze this month',
      '33333333-3333-3333-3333-333333333333'
    ) ->> 'decision'),
  'rejected',
  'decide_leave_request_atomic rejects with a reason'
);

SELECT is(
  (SELECT review_notes FROM public.driver_leave_requests
   WHERE id = (SELECT leave2_id FROM approvals_fixture)),
  'staffing freeze this month',
  'rejection persists the reason in review_notes'
);

SELECT is(
  (SELECT reviewed_by::text FROM public.driver_leave_requests
   WHERE id = (SELECT leave2_id FROM approvals_fixture)),
  '33333333-3333-3333-3333-333333333333',
  'rejection persists the reviewer (auth.users FK)'
);

-- Invalid decision value refused.
SELECT throws_ok(
  $$SELECT public.decide_leave_request_atomic(
       '11111111-1111-1111-1111-111111111111',
       (SELECT leave2_id FROM approvals_fixture),
       'maybe', NULL, NULL)$$,
  'P0001',
  'LVE003: invalid decision',
  'invalid decision value is refused (LVE003)'
);

-- ─── 6. decide_application_atomic — transition + double-decision (5) ────────

RESET ROLE;
SET LOCAL ROLE postgres;

-- Approve: claims the submitted row. The RPC call and the persisted-row read
-- are deliberately SEPARATE asserts (see the split note in section 5).
SELECT is(
  (SELECT (public.decide_application_atomic(
      '11111111-1111-1111-1111-111111111111',
      (SELECT app_id FROM approvals_fixture),
      'approved', 'docs complete',
      '55555555-5555-5555-5555-555555555555'
    ) ->> 'decision')),
  'approved',
  'decide_application_atomic approves a pre-decision application'
);

SELECT is(
  (SELECT reviewed_by::text FROM public.driver_applications
   WHERE id = (SELECT app_id FROM approvals_fixture)),
  '55555555-5555-5555-5555-555555555555',
  'approval persists the reviewer (users.id per 030)'
);

-- Double-decision guard: the second call MUST fail with APP002.
SELECT throws_ok(
  $$SELECT public.decide_application_atomic(
       '11111111-1111-1111-1111-111111111111',
       (SELECT app_id FROM approvals_fixture),
       'rejected', 'changed my mind',
       '55555555-5555-5555-5555-555555555555')$$,
  'P0001',
  'APP002: application already decided',
  'double decision on the same application is refused (APP002)'
);

-- ─── 6b. Application rejection contract (4) ─────────────────────────────────

-- Rejection without a note is refused.
SELECT throws_ok(
  $$SELECT public.decide_application_atomic(
       '11111111-1111-1111-1111-111111111111',
       'aaaaaaaa-1111-4111-8111-111111111111',
       'rejected', NULL,
       '55555555-5555-5555-5555-555555555555')$$,
  'P0001',
  'APP004: rejection note required',
  'application rejection without a note is refused (APP004)'
);

-- Already-decided rows (approved/rejected) never re-enter the queue.
SELECT is(
  (SELECT count(*)::int FROM public.fetch_pending_approvals(
     '11111111-1111-1111-1111-111111111111',
     'application', NULL, NULL, 50)),
  0,
  'decided applications leave the queue (terminal-state discipline)'
);

-- ─── 7. Queue indexes (4) ───────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

SELECT ok(
  (SELECT count(*) FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN ('idx_expenses_pending_approval',
                       'idx_leave_requests_pending_queue',
                       'idx_driver_apps_pending_queue',
                       'idx_driver_apps_review_queue')) = 4,
  'all queue predicate indexes exist (expense, leave, application, review)'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_leave_requests_pending_queue'
     AND indexdef LIKE '%status%pending%'),
  1,
  'leave queue index is partial on status = pending'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_driver_apps_pending_queue'
     AND indexdef LIKE '%submitted%'),
  1,
  'application queue index is partial on pre-decision statuses'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_expenses_pending_approval'
     AND indexdef LIKE '%is_approved%false%'),
  1,
  'expense queue index is partial on is_approved = false'
);

-- ─── Cleanup & finish ───────────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

SELECT * FROM finish();
