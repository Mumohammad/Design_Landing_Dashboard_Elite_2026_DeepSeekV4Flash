-- ============================================================================
-- Accounting Module surfaces — tests (pgTAP)
-- (066_accounting_module_tests.sql)
--
-- Proves the guarantees of 20260928000000_accounting_surfaces.sql plus the
-- pre-existing accounting contracts the new surfaces compose over:
--
--   1. finance_payments indexes from the migration exist with the right
--      partial predicates (the table had NO tenant-leading index before)
--   2. Re-asserted pre-existing read-path indexes the dashboard accounting
--      KPIs depend on (drift-proofing no-ops): invoices (038), expenses (021)
--   3. Journal immutability trigger: JRN001 posted-mutation block, JRN002
--      reversed-mutation block, JRN003 posted-delete block (027), with the
--      draft→posted→reversed lifecycle exercised as the sanctioned path
--   4. Invoice status enum shape (lifecycle the surfaces render)
--   5. finance_payments CHECK guards: amount > 0, direction in/out domain
--   6. RLS tenant isolation + anon-zero on finance_payments, invoices,
--      expenses, journal_entries, journal_entry_lines
--
-- plan(22) MUST equal the actual assertion count: pgTAP reports "planned N
-- but ran M" at finish() and the CI runner counts any file with a plan
-- mismatch, `not ok` line, or psql ERROR as failed.
--
-- Conventions (match 060–064): single transaction (CI passes
--   --single-transaction), SET LOCAL ROLE + RESET ROLE between role switches,
--   fixtures in a TEMP table + fixed UUIDs, idempotent insert-if-absent
--   fixture guards with state resets, finish() at the end.
-- ============================================================================

SELECT plan(22);

-- ─── Fixtures (run as postgres; bypass RLS) ─────────────────────────────────
-- Fixed UUIDs (distinct namespace from 064's fixtures):
--   tenant A   13111111-1111-1111-1111-111111111111
--   tenant B   13222222-2222-2222-2222-222222222222
--   auth user  13333333-3333-3333-3333-333333333333
--   users row  13555555-5555-5555-5555-555555555555
--   auth B     13888888-8888-8888-8888-888888888888
--   users B    13999999-9999-9999-9999-999999999999
--   bank acct  13444444-4444-4444-4444-444444444444
--   customer   13666666-6666-6666-6666-666666666666
--   CoA rows   13700000-.... / 13700001-....

CREATE TEMP TABLE acct_fixture (
  tenant_id   uuid,
  user_id     uuid,
  auth_id     uuid,
  bank_id     uuid,
  customer_id uuid,
  coa_cash_id uuid,
  coa_rev_id  uuid
);

DO $$
DECLARE
  v_tenant    uuid := '13111111-1111-1111-1111-111111111111';
  v_tenant_b  uuid := '13222222-2222-2222-2222-222222222222';
  v_auth      uuid := '13333333-3333-3333-3333-333333333333';
  v_users     uuid := '13555555-5555-5555-5555-555555555555';
  v_auth_b    uuid := '13888888-8888-8888-8888-888888888888';
  v_users_b   uuid := '13999999-9999-9999-9999-999999999999';
  v_bank      uuid := '13444444-4444-4444-4444-444444444444';
  v_customer  uuid := '13666666-6666-6666-6666-666666666666';
  v_coa_cash  uuid := '13700000-0000-0000-0000-000000000000';
  v_coa_rev   uuid := '13700001-0000-0000-0000-000000000000';
BEGIN
  INSERT INTO public.tenants (id, name_ar, name_en)
  VALUES (v_tenant, 'مستأجر محاسبة أ', 'Accounting Fixture Tenant A')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.tenants (id, name_ar, name_en)
  VALUES (v_tenant_b, 'مستأجر محاسبة ب', 'Accounting Fixture Tenant B')
  ON CONFLICT (id) DO NOTHING;

  -- users requires an auth.users row (060 hardened trigger contract).
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES ('00000000-0000-0000-0000-000000000000',
          v_auth, 'authenticated',
          'authenticated', 'acct-fixture@test.local', crypt('x', gen_salt('bf')),
          now(), now(), now(), '{"provider":"email","providers":["email"]}',
          '{"_invite_provisioned": true}')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, auth_user_id, tenant_id, email, role, status)
  VALUES (v_users, v_auth, v_tenant, 'acct-fixture@test.local', 'general_manager', 'active')
  ON CONFLICT (id) DO UPDATE SET role = 'general_manager', status = 'active';

  -- Bank account (tenant A) for the in/out payment fixtures.
  INSERT INTO public.bank_accounts (id, tenant_id, bank_name, account_name, iban)
  VALUES (v_bank, v_tenant, 'بنك الاختبار', 'Accounting Fixture Account', 'SA0000000000000000000000')
  ON CONFLICT (id) DO NOTHING;

  -- Customer (tenant A) for the direction='in' payment fixture.
  INSERT INTO public.customers (id, tenant_id, name_ar)
  VALUES (v_customer, v_tenant, 'عميل المحاسبة')
  ON CONFLICT (id) DO NOTHING;

  -- Minimal CoA pair (tenant A) backing the journal entry + lines.
  INSERT INTO public.chart_of_accounts (id, tenant_id, account_code, name_ar, name_en, account_type, normal_balance)
  VALUES (v_coa_cash, v_tenant, '1100', 'النقدية', 'Cash', 'asset', 'debit')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.chart_of_accounts (id, tenant_id, account_code, name_ar, name_en, account_type, normal_balance)
  VALUES (v_coa_rev, v_tenant, '4000', 'إيرادات الخدمات', 'Service Revenue', 'income', 'credit')
  ON CONFLICT (id) DO NOTHING;

  -- Journal entry + balanced lines (tenant A): the immutability fixtures.
  -- A successful prior run COMMITS this entry in its final ('reversed')
  -- state — single-transaction runs commit at EOF — and a reversed entry is
  -- frozen (JRN002) and cannot be reset via UPDATE. Self-repair is therefore
  -- delete-and-reinsert: lines cascade from the entry delete, and JRN003
  -- only blocks deleting POSTED entries (posted can never persist past an
  -- aborted transaction, so any state found here is deletable).
  DELETE FROM public.journal_entry_lines
  WHERE journal_entry_id = '13710000-0000-0000-0000-000000000000';
  DELETE FROM public.journal_entries
  WHERE id = '13710000-0000-0000-0000-000000000000';

  -- Draft first; status flips to 'posted' inside the assertion section so
  -- the draft→posted transition itself is exercised (and allowed).
  INSERT INTO public.journal_entries (id, tenant_id, entry_date, entry_type, status, description_en)
  VALUES ('13710000-0000-0000-0000-000000000000', v_tenant, CURRENT_DATE, 'manual', 'draft',
          'Accounting fixture entry');

  INSERT INTO public.journal_entry_lines
    (tenant_id, journal_entry_id, account_id, description, debit_amount, credit_amount)
  VALUES
    (v_tenant, '13710000-0000-0000-0000-000000000000', v_coa_cash, 'debit leg', 500.00, 0),
    (v_tenant, '13710000-0000-0000-0000-000000000000', v_coa_rev, 'credit leg', 0, 500.00);

  -- Finance payments (tenant A): one receipt in, one payment out, one void.
  -- Insert-if-absent + explicit status reset so re-runs are deterministic.
  INSERT INTO public.finance_payments
    (id, tenant_id, direction, customer_id, payment_date, amount, method, status, reference)
  VALUES
    ('13720000-0000-0000-0000-000000000000', v_tenant, 'in',  v_customer, DATE '2026-09-01', 1200.00, 'transfer', 'allocated', 'INV-ACCT-FIXTURE'),
    ('13720001-0000-0000-0000-000000000000', v_tenant, 'out', NULL,       DATE '2026-09-05',  300.50, 'cash',     'pending',   NULL),
    ('13720002-0000-0000-0000-000000000000', v_tenant, 'in',  v_customer, DATE '2026-09-10',   75.25, 'card',     'void',      NULL)
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.finance_payments SET status = 'allocated'
  WHERE id = '13720000-0000-0000-0000-000000000000';
  UPDATE public.finance_payments SET status = 'pending'
  WHERE id = '13720001-0000-0000-0000-000000000000';
  UPDATE public.finance_payments SET status = 'void'
  WHERE id = '13720002-0000-0000-0000-000000000000';

  -- A sales invoice (tenant A) for the RLS isolation + enum proofs.
  INSERT INTO public.invoices (id, tenant_id, invoice_number, invoice_type, customer_id,
                               issue_date, due_date, status, subtotal, vat_amount, total)
  VALUES ('13730000-0000-0000-0000-000000000000', v_tenant, 'ACCT-FIX-001', 'sales', v_customer,
          DATE '2026-09-02', DATE '2026-10-02', 'issued', 1000.00, 150.00, 1150.00)
  ON CONFLICT (id) DO NOTHING;

  -- An expense (tenant A) for the RLS isolation proof.
  INSERT INTO public.expenses (id, tenant_id, expense_type, amount, expense_date, description)
  VALUES ('13740000-0000-0000-0000-000000000000', v_tenant, 'fuel', 80.00, DATE '2026-09-03', 'Accounting fixture fuel')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO acct_fixture VALUES
    (v_tenant, v_users, v_auth, v_bank, v_customer, v_coa_cash, v_coa_rev);
END;
$$;

-- ─── 1. Migration indexes exist (3) ──────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_finance_payments_tenant_date'),
  1,
  'finance_payments tenant/date list index exists'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_finance_payments_tenant_date'
     AND indexdef LIKE '%payment_date DESC%' AND indexdef LIKE '%deleted_at%'),
  1,
  'finance_payments list index is partial on live rows and date-desc'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_finance_payments_tenant_status'
     AND indexdef LIKE '%deleted_at%'),
  1,
  'finance_payments status index is partial on live rows'
);

-- ─── 2. Pre-existing read-path indexes re-asserted (3) ──────────────────────

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_invoices_tenant_date'),
  1,
  'invoices tenant/date index re-asserted (dashboard KPI read path, 038)'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_invoices_tenant_status'),
  1,
  'invoices tenant/status index re-asserted (pending-invoices KPI read path, 038)'
);

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'idx_expenses_active'),
  1,
  'expenses active index re-asserted (expenses KPI read path, 021)'
);

-- ─── 3. Journal immutability (5) ─────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

-- Draft → posted is the ONE allowed forward transition.
UPDATE public.journal_entries SET status = 'posted'
WHERE id = '13710000-0000-0000-0000-000000000000';

SELECT is(
  (SELECT status::text FROM public.journal_entries
   WHERE id = '13710000-0000-0000-0000-000000000000'),
  'posted',
  'draft → posted transition lands (forward lifecycle)'
);

-- JRN001: any edit while posted is refused.
SELECT throws_ok(
  $$UPDATE public.journal_entries
      SET description_en = 'tampered'
    WHERE id = '13710000-0000-0000-0000-000000000000'$$,
  'P0001',
  'JRN001: posted journal entries are immutable; use a reversal entry',
  'posted entry description edit is refused (JRN001)'
);

SELECT throws_ok(
  $$UPDATE public.journal_entries
      SET status = 'draft'
    WHERE id = '13710000-0000-0000-0000-000000000000'$$,
  'P0001',
  'JRN001: posted journal entries are immutable; use a reversal entry',
  'posted → draft un-post attempt is refused (JRN001)'
);

-- JRN003: posted entries cannot be hard-deleted.
SELECT throws_ok(
  $$DELETE FROM public.journal_entries
    WHERE id = '13710000-0000-0000-0000-000000000000'$$,
  'P0001',
  'JRN003: posted journal entries cannot be deleted',
  'posted entry delete is refused (JRN003)'
);

-- posted → reversed is the sanctioned exit (JRN001 lets it pass); JRN002
-- then freezes the reversed row against any further mutation.
UPDATE public.journal_entries SET status = 'reversed'
WHERE id = '13710000-0000-0000-0000-000000000000';

SELECT is(
  (SELECT status::text FROM public.journal_entries
   WHERE id = '13710000-0000-0000-0000-000000000000'),
  'reversed',
  'posted → reversed lands (the sanctioned exit path)'
);

SELECT throws_ok(
  $$UPDATE public.journal_entries
      SET status = 'draft'
    WHERE id = '13710000-0000-0000-0000-000000000000'$$,
  'P0001',
  'JRN002: reversed journal entries cannot be modified',
  'reversed entry mutation is refused (JRN002)'
);

-- ─── 4. Invoice status enum shape (1) ────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM pg_enum e
   JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'invoice_status'
     AND e.enumlabel IN ('draft','issued','finalized','paid','partially_paid','overdue','cancelled','credited')),
  8,
  'invoice_status enum carries all eight lifecycle states'
);

-- ─── 5. finance_payments CHECK guards (3) ────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

SELECT throws_ok(
  $$INSERT INTO public.finance_payments
      (tenant_id, direction, payment_date, amount, method, status)
    VALUES ('13111111-1111-1111-1111-111111111111', 'in', CURRENT_DATE, 0, 'cash', 'pending')$$,
  '23514',
  'new row for relation "finance_payments" violates check constraint "chk_finance_payment_amount"',
  'zero-amount payment is refused (chk_finance_payment_amount)'
);

SELECT throws_ok(
  $$INSERT INTO public.finance_payments
      (tenant_id, direction, payment_date, amount, method, status)
    VALUES ('13111111-1111-1111-1111-111111111111', 'sideways', CURRENT_DATE, 10, 'cash', 'pending')$$,
  '23514',
  'new row for relation "finance_payments" violates check constraint "finance_payments_direction_check"',
  'invalid direction is refused (direction CHECK domain)'
);

-- Valid rows (the fixtures) pass their own guards.
SELECT is(
  (SELECT count(*)::int FROM public.finance_payments
   WHERE tenant_id = '13111111-1111-1111-1111-111111111111'),
  3,
  'valid payment fixtures land (in / out / void)'
);

-- ─── 6. RLS tenant isolation + anon-zero (6) ────────────────────────────────

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.finance_payments)
+ (SELECT count(*)::int FROM public.invoices)
+ (SELECT count(*)::int FROM public.expenses)
+ (SELECT count(*)::int FROM public.journal_entries)
+ (SELECT count(*)::int FROM public.journal_entry_lines),
  0,
  'anon sees 0 rows across all accounting tables'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"13333333-3333-3333-3333-333333333333"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.finance_payments
   WHERE tenant_id = '13111111-1111-1111-1111-111111111111'),
  3,
  'authenticated sees their tenant finance_payments (RLS)'
);
SELECT is(
  (SELECT count(*)::int FROM public.invoices
   WHERE tenant_id = '13111111-1111-1111-1111-111111111111'),
  1,
  'authenticated sees their tenant invoices (RLS)'
);
SELECT is(
  (SELECT count(*)::int FROM public.expenses
   WHERE tenant_id = '13111111-1111-1111-1111-111111111111'),
  1,
  'authenticated sees their tenant expenses (RLS)'
);
SELECT is(
  (SELECT count(*)::int FROM public.journal_entry_lines
   WHERE journal_entry_id = '13710000-0000-0000-0000-000000000000'),
  2,
  'authenticated sees their tenant journal_entry_lines (drill-down read path)'
);

-- Cross-tenant: a REAL tenant-B user sees nothing from tenant A.
-- get_my_tenant_id() resolves the caller's tenant from public.users by
-- auth_user_id (NOT from the JWT tenant_id claim), so isolation is proven
-- by authenticating a second fixture user whose users row lives in
-- tenant B — spoofing a tenant_id claim on the tenant-A user proves
-- nothing. (Idempotent fixture inserts, same 060 marker contract.)
RESET ROLE;
SET LOCAL ROLE postgres;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
VALUES ('00000000-0000-0000-0000-000000000000',
        '13888888-8888-8888-8888-888888888888', 'authenticated',
        'authenticated', 'acct-fixture-b@test.local', crypt('x', gen_salt('bf')),
        now(), now(), now(), '{"provider":"email","providers":["email"]}',
        '{"_invite_provisioned": true}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, auth_user_id, tenant_id, email, role, status)
VALUES ('13999999-9999-9999-9999-999999999999',
        '13888888-8888-8888-8888-888888888888',
        '13222222-2222-2222-2222-222222222222',
        'acct-fixture-b@test.local', 'general_manager', 'active')
ON CONFLICT (id) DO UPDATE SET tenant_id = '13222222-2222-2222-2222-222222222222',
                               role = 'general_manager', status = 'active';

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"13888888-8888-8888-8888-888888888888"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.finance_payments
   WHERE tenant_id = '13111111-1111-1111-1111-111111111111'),
  0,
  'cross-tenant finance_payments reads are filtered (tenant-B GM sees none of tenant A)'
);

-- ─── Cleanup & finish ───────────────────────────────────────────────────────

RESET ROLE;
SET LOCAL ROLE postgres;

SELECT * FROM finish();
