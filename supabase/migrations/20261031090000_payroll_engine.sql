BEGIN;
-- Platform payroll engine (vendored Payroll-Sys-2026 calculations).
-- Calculations run in the application (src/lib/payroll-engine, parity-tested);
-- these tables persist the tenant's rules, inputs, immutable run results and
-- the Income-vs-Expenses ledger. Authenticated users may only READ (RLS);
-- all writes go through permission-checked server actions (service role) and
-- the atomic run functions below.


CREATE TABLE public.payroll_engine_rule_sets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
 rule_values jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(rule_values)='object'),
 notes text,
 created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id), updated_at timestamptz NOT NULL DEFAULT now(),
 activated_by uuid REFERENCES auth.users(id), activated_at timestamptz
);
CREATE UNIQUE INDEX payroll_engine_rule_sets_one_active ON public.payroll_engine_rule_sets(tenant_id) WHERE status='active';
CREATE INDEX payroll_engine_rule_sets_tenant ON public.payroll_engine_rule_sets(tenant_id, created_at DESC);

CREATE TABLE public.payroll_engine_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 payroll_month text NOT NULL CHECK (length(btrim(payroll_month)) BETWEEN 1 AND 40),
 month_key text NOT NULL CHECK (month_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 platform_name text NOT NULL DEFAULT 'HungerStation' CHECK (length(btrim(platform_name)) BETWEEN 1 AND 80),
 platform_id uuid REFERENCES public.delivery_platforms(id) ON DELETE SET NULL,
 file_name text NOT NULL, file_path text, file_sha256 text, file_size integer,
 rule_set_id uuid REFERENCES public.payroll_engine_rule_sets(id) ON DELETE SET NULL,
 rule_set_name text NOT NULL,
 rule_snapshot jsonb NOT NULL CHECK (jsonb_typeof(rule_snapshot)='object'),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','cancelled')),
 total_drivers integer NOT NULL DEFAULT 0,
 total_gross numeric NOT NULL DEFAULT 0, total_penalties numeric NOT NULL DEFAULT 0,
 total_net numeric NOT NULL DEFAULT 0, total_variance numeric NOT NULL DEFAULT 0, total_traffic numeric NOT NULL DEFAULT 0,
 banking jsonb, parser_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
 installment_changes jsonb NOT NULL DEFAULT '[]'::jsonb,
 journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
 version integer NOT NULL DEFAULT 1,
 created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), recalculated_at timestamptz,
 approved_by uuid REFERENCES auth.users(id), approved_at timestamptz,
 cancelled_by uuid REFERENCES auth.users(id), cancelled_at timestamptz, cancel_reason text
);
CREATE INDEX payroll_engine_runs_tenant ON public.payroll_engine_runs(tenant_id, month_key DESC, created_at DESC);
CREATE INDEX payroll_engine_runs_rule_set ON public.payroll_engine_runs(rule_set_id);
CREATE INDEX payroll_engine_runs_platform ON public.payroll_engine_runs(platform_id);
CREATE INDEX payroll_engine_runs_journal ON public.payroll_engine_runs(journal_entry_id);
-- Only one approved run per tenant, month and platform.
CREATE UNIQUE INDEX payroll_engine_runs_one_approved ON public.payroll_engine_runs(tenant_id, month_key, platform_name) WHERE status='approved';

CREATE TABLE public.payroll_engine_results (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 run_id uuid NOT NULL REFERENCES public.payroll_engine_runs(id) ON DELETE CASCADE,
 driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
 rider_id text NOT NULL, driver_name text NOT NULL DEFAULT '', contract_name text, vehicle_type text,
 completed_orders numeric NOT NULL DEFAULT 0, uploaded_basic_payment numeric NOT NULL DEFAULT 0,
 gross_salary numeric NOT NULL DEFAULT 0, total_penalties numeric NOT NULL DEFAULT 0,
 traffic_deduction numeric NOT NULL DEFAULT 0, final_net_salary numeric NOT NULL DEFAULT 0,
 variance_amount numeric NOT NULL DEFAULT 0, variance_status text NOT NULL, review_status text NOT NULL,
 performance_band text NOT NULL, exception_flag boolean NOT NULL DEFAULT false,
 result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
 raw_input jsonb NOT NULL CHECK (jsonb_typeof(raw_input)='object'),
 bank jsonb,
 UNIQUE (run_id, rider_id)
);
CREATE INDEX payroll_engine_results_tenant ON public.payroll_engine_results(tenant_id, run_id);
CREATE INDEX payroll_engine_results_driver ON public.payroll_engine_results(driver_id);

CREATE TABLE public.payroll_engine_exceptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 run_id uuid NOT NULL REFERENCES public.payroll_engine_runs(id) ON DELETE CASCADE,
 code text NOT NULL, severity text NOT NULL CHECK (severity IN ('info','warning','error')),
 source text NOT NULL, row_ref text, message text NOT NULL, suggested_action text,
 review_status text NOT NULL DEFAULT 'open' CHECK (review_status IN ('open','resolved','ignored')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_engine_exceptions_run ON public.payroll_engine_exceptions(run_id);
CREATE INDEX payroll_engine_exceptions_tenant ON public.payroll_engine_exceptions(tenant_id);

-- Custom bonuses / deductions (Rules Control Center), installment-aware.
CREATE TABLE public.payroll_engine_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('bonus','deduction')),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120), name_ar text,
 amount numeric NOT NULL CHECK (amount >= 0 AND amount <= 99999999),
 item_type text NOT NULL DEFAULT 'fixed', description text,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
 apply_to_all boolean NOT NULL DEFAULT true, target_rider_ids text[] NOT NULL DEFAULT '{}',
 installment_enabled boolean NOT NULL DEFAULT false,
 installment_monthly_amount numeric NOT NULL DEFAULT 0 CHECK (installment_monthly_amount >= 0),
 installment_total_paid numeric NOT NULL DEFAULT 0 CHECK (installment_total_paid >= 0),
 installment_status text NOT NULL DEFAULT 'none' CHECK (installment_status IN ('none','active','completed')),
 created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (kind='deduction' OR NOT installment_enabled)
);
CREATE INDEX payroll_engine_items_tenant ON public.payroll_engine_items(tenant_id, kind, status);

-- Per-rider manual adjustments (licence issuing, one-off bonuses/deductions).
CREATE TABLE public.payroll_engine_adjustments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
 rider_id text NOT NULL CHECK (length(btrim(rider_id)) BETWEEN 1 AND 64),
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160), title_ar text,
 amount numeric NOT NULL CHECK (amount >= 0 AND amount <= 99999999),
 adjustment_type text NOT NULL CHECK (adjustment_type IN ('bonus','deduction')),
 category text NOT NULL DEFAULT 'custom' CHECK (category IN ('license','custom_bonus','custom_deduction','custom')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','paid')),
 notes text,
 created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_engine_adjustments_tenant ON public.payroll_engine_adjustments(tenant_id, rider_id, status);
CREATE INDEX payroll_engine_adjustments_driver ON public.payroll_engine_adjustments(driver_id);

-- Traffic violations / tickets deducted through payroll (with installments).
CREATE TABLE public.payroll_engine_traffic_fines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
 rider_id text NOT NULL CHECK (length(btrim(rider_id)) BETWEEN 1 AND 64),
 ticket_date date NOT NULL, ticket_number text,
 violation_type text NOT NULL CHECK (length(btrim(violation_type)) BETWEEN 1 AND 160),
 amount numeric NOT NULL CHECK (amount >= 0 AND amount <= 99999999),
 status text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected','paid')),
 notes text,
 installment_enabled boolean NOT NULL DEFAULT false,
 installment_monthly_amount numeric NOT NULL DEFAULT 0 CHECK (installment_monthly_amount >= 0),
 installment_total_paid numeric NOT NULL DEFAULT 0 CHECK (installment_total_paid >= 0),
 installment_status text NOT NULL DEFAULT 'none' CHECK (installment_status IN ('none','active','completed')),
 created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_engine_traffic_tenant ON public.payroll_engine_traffic_fines(tenant_id, rider_id, status);
CREATE INDEX payroll_engine_traffic_driver ON public.payroll_engine_traffic_fines(driver_id);

-- Income vs Expenses ledger.
CREATE TABLE public.payroll_income_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 month_key text NOT NULL CHECK (month_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
 rider_id text NOT NULL CHECK (length(btrim(rider_id)) BETWEEN 1 AND 64),
 driver_name text NOT NULL DEFAULT '',
 company_name text NOT NULL CHECK (length(btrim(company_name)) BETWEEN 1 AND 80),
 basic_payment numeric NOT NULL DEFAULT 0, distance_payment numeric NOT NULL DEFAULT 0, segment_payment numeric NOT NULL DEFAULT 0,
 acceptance_penalty numeric NOT NULL DEFAULT 0, contact_penalty numeric NOT NULL DEFAULT 0, stacking_deduction numeric NOT NULL DEFAULT 0,
 declined_penalty numeric NOT NULL DEFAULT 0, late_penalty numeric NOT NULL DEFAULT 0, no_show_penalty numeric NOT NULL DEFAULT 0,
 no_show_special_penalty numeric NOT NULL DEFAULT 0, daily_acceptance_penalty numeric NOT NULL DEFAULT 0, missed_days_penalty numeric NOT NULL DEFAULT 0,
 rider_balance numeric NOT NULL DEFAULT 0,
 custom_fields jsonb CHECK (custom_fields IS NULL OR jsonb_typeof(custom_fields)='array'),
 total_income numeric NOT NULL DEFAULT 0, total_penalties numeric NOT NULL DEFAULT 0,
 source_file text, run_id uuid REFERENCES public.payroll_engine_runs(id) ON DELETE SET NULL,
 created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, month_key, rider_id, company_name)
);
CREATE INDEX payroll_income_records_month ON public.payroll_income_records(tenant_id, month_key);
CREATE INDEX payroll_income_records_driver ON public.payroll_income_records(driver_id);
CREATE INDEX payroll_income_records_run ON public.payroll_income_records(run_id);

CREATE TABLE public.payroll_expense_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120), name_ar text,
 default_amount numeric NOT NULL DEFAULT 0 CHECK (default_amount >= 0),
 allocation_type text NOT NULL DEFAULT 'per_driver' CHECK (allocation_type IN ('per_driver','shared','assigned')),
 description text, is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, name)
);

CREATE TABLE public.payroll_monthly_expenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 month_key text NOT NULL CHECK (month_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 category_id uuid NOT NULL REFERENCES public.payroll_expense_categories(id) ON DELETE CASCADE,
 category_name text NOT NULL,
 amount numeric NOT NULL CHECK (amount >= 0 AND amount <= 999999999),
 allocation_type text NOT NULL CHECK (allocation_type IN ('per_driver','shared','assigned')),
 assigned_driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
 assigned_rider_id text,
 notes text, receipt_url text,
 created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (allocation_type <> 'assigned' OR assigned_rider_id IS NOT NULL)
);
CREATE INDEX payroll_monthly_expenses_month ON public.payroll_monthly_expenses(tenant_id, month_key);
CREATE INDEX payroll_monthly_expenses_category ON public.payroll_monthly_expenses(category_id);
CREATE INDEX payroll_monthly_expenses_driver ON public.payroll_monthly_expenses(assigned_driver_id);

CREATE TABLE public.payroll_driver_counts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 month_key text NOT NULL CHECK (month_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 active_driver_count integer NOT NULL DEFAULT 0 CHECK (active_driver_count >= 0),
 notes text, confirmed_by uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, month_key)
);

CREATE TABLE public.payroll_custom_income_fields (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120), name_ar text,
 field_type text NOT NULL DEFAULT 'add' CHECK (field_type IN ('add','deduct')),
 description text, is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, name)
);

-- Read-only RLS for the tenant's payroll readers; no direct writes.
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['payroll_engine_rule_sets','payroll_engine_runs','payroll_engine_results','payroll_engine_exceptions',
  'payroll_engine_items','payroll_engine_adjustments','payroll_engine_traffic_fines','payroll_income_records',
  'payroll_expense_categories','payroll_monthly_expenses','payroll_driver_counts','payroll_custom_income_fields'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id() AND public.user_has_permission(''payroll'',''read''))', t || '_read', t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
 END LOOP;
END $$;

-- Atomic persistence of a calculated run (insert or draft recalculation).
-- Called only by the server (service role) after the caller's payroll
-- permission and tenant were verified; tenant and actor are explicit.
CREATE FUNCTION public.payroll_engine_save_run(p_tenant uuid, p_actor uuid, p_run jsonb, p_results jsonb,
 p_exceptions jsonb, p_income jsonb, p_run_id uuid DEFAULT NULL, p_expected_version integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_run public.payroll_engine_runs%ROWTYPE;
BEGIN
 IF p_tenant IS NULL OR p_actor IS NULL OR jsonb_typeof(p_results) <> 'array' OR jsonb_array_length(p_results) = 0
  OR jsonb_typeof(p_exceptions) <> 'array' OR jsonb_typeof(p_income) <> 'array' THEN
  RAISE EXCEPTION 'PAYENG001: invalid payroll run payload'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll_engine:' || p_tenant::text || ':' || (p_run->>'month_key'), 0));
 IF p_run_id IS NULL THEN
  -- One live run per tenant/month/platform: a re-import replaces the previous DRAFT; an approved month must be cancelled first.
  IF EXISTS (SELECT 1 FROM public.payroll_engine_runs WHERE tenant_id = p_tenant AND month_key = p_run->>'month_key'
    AND platform_name = COALESCE(NULLIF(p_run->>'platform_name',''),'HungerStation') AND status = 'approved') THEN
   RAISE EXCEPTION 'PAYENG005: this month is already approved for this platform; cancel the approved run before importing again'; END IF;
  UPDATE public.payroll_engine_runs SET status = 'cancelled', cancelled_by = p_actor, cancelled_at = now(), cancel_reason = 'Replaced by a new import', updated_at = now()
   WHERE tenant_id = p_tenant AND month_key = p_run->>'month_key' AND platform_name = COALESCE(NULLIF(p_run->>'platform_name',''),'HungerStation') AND status = 'draft';
  INSERT INTO public.payroll_engine_runs(tenant_id, payroll_month, month_key, platform_name, platform_id, file_name, file_path, file_sha256, file_size,
   rule_set_id, rule_set_name, rule_snapshot, banking, parser_warnings, created_by)
  VALUES (p_tenant, p_run->>'payroll_month', p_run->>'month_key', COALESCE(NULLIF(p_run->>'platform_name',''),'HungerStation'), NULLIF(p_run->>'platform_id','')::uuid,
   p_run->>'file_name', NULLIF(p_run->>'file_path',''), NULLIF(p_run->>'file_sha256',''), NULLIF(p_run->>'file_size','')::integer,
   NULLIF(p_run->>'rule_set_id','')::uuid, p_run->>'rule_set_name', p_run->'rule_snapshot', p_run->'banking', COALESCE(p_run->'parser_warnings','[]'::jsonb), p_actor)
  RETURNING id INTO v_id;
 ELSE
  SELECT * INTO v_run FROM public.payroll_engine_runs WHERE id = p_run_id AND tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYENG002: payroll run not found'; END IF;
  IF v_run.status <> 'draft' THEN RAISE EXCEPTION 'PAYENG003: only draft payroll runs can be recalculated'; END IF;
  IF p_expected_version IS NULL OR v_run.version <> p_expected_version THEN RAISE EXCEPTION 'PAYENG004: payroll run changed; reload before recalculating'; END IF;
  v_id := v_run.id;
  DELETE FROM public.payroll_engine_results WHERE run_id = v_id;
  DELETE FROM public.payroll_engine_exceptions WHERE run_id = v_id;
  UPDATE public.payroll_engine_runs SET rule_set_id = NULLIF(p_run->>'rule_set_id','')::uuid, rule_set_name = p_run->>'rule_set_name',
   rule_snapshot = p_run->'rule_snapshot', version = version + 1, recalculated_at = now(), updated_at = now() WHERE id = v_id;
 END IF;
 INSERT INTO public.payroll_engine_results(tenant_id, run_id, driver_id, rider_id, driver_name, contract_name, vehicle_type, completed_orders,
  uploaded_basic_payment, gross_salary, total_penalties, traffic_deduction, final_net_salary, variance_amount, variance_status, review_status,
  performance_band, exception_flag, result, raw_input, bank)
 SELECT p_tenant, v_id, d.id, r->>'rider_id', COALESCE(r->>'driver_name',''), r->'result'->>'contractName', r->'result'->>'vehicleType',
  (r->'result'->>'completedOrders')::numeric, (r->'result'->>'uploadedBasicPayment')::numeric, (r->'result'->>'grossSalaryBeforePenalties')::numeric,
  (r->'result'->>'totalOtherPenalties')::numeric, (r->'result'->>'trafficViolationsDeduction')::numeric, (r->'result'->>'finalNetSalary')::numeric,
  (r->'result'->>'varianceAmount')::numeric, r->'result'->>'varianceStatus', r->'result'->>'reviewStatus', r->'result'->>'performanceBand',
  (r->'result'->>'exceptionFlag')::boolean, r->'result', r->'raw_input', r->'bank'
 FROM jsonb_array_elements(p_results) r
 LEFT JOIN public.drivers d ON d.id = NULLIF(r->>'driver_id','')::uuid AND d.tenant_id = p_tenant;
 INSERT INTO public.payroll_engine_exceptions(tenant_id, run_id, code, severity, source, row_ref, message, suggested_action)
 SELECT p_tenant, v_id, e->>'code', e->>'severity', e->>'source', e->>'rowRef', e->>'message', e->>'suggestedAction' FROM jsonb_array_elements(p_exceptions) e;
 UPDATE public.payroll_engine_runs SET total_drivers = jsonb_array_length(p_results),
  total_gross = (p_run->'totals'->>'totalGross')::numeric, total_penalties = (p_run->'totals'->>'totalPenalties')::numeric,
  total_net = (p_run->'totals'->>'totalNet')::numeric, total_variance = (p_run->'totals'->>'totalVariance')::numeric,
  total_traffic = (p_run->'totals'->>'totalTraffic')::numeric WHERE id = v_id;
 -- Income-vs-Expenses auto-sync: replace this platform's month (original behaviour).
 DELETE FROM public.payroll_income_records WHERE tenant_id = p_tenant AND month_key = p_run->>'month_key'
  AND company_name = COALESCE(NULLIF(p_run->>'platform_name',''),'HungerStation');
 INSERT INTO public.payroll_income_records(tenant_id, month_key, driver_id, rider_id, driver_name, company_name, basic_payment, distance_payment,
  segment_payment, acceptance_penalty, contact_penalty, stacking_deduction, declined_penalty, late_penalty, no_show_penalty, no_show_special_penalty,
  daily_acceptance_penalty, missed_days_penalty, rider_balance, total_income, total_penalties, source_file, run_id, created_by)
 SELECT p_tenant, p_run->>'month_key', d.id, i->>'riderId', COALESCE(i->>'driverName',''), COALESCE(NULLIF(p_run->>'platform_name',''),'HungerStation'),
  (i->>'basicPayment')::numeric, (i->>'distancePayment')::numeric, (i->>'segmentPayment')::numeric, (i->>'acceptancePenalty')::numeric,
  (i->>'contactPenalty')::numeric, (i->>'stackingDeduction')::numeric, (i->>'declinedPenalty')::numeric, (i->>'latePenalty')::numeric,
  (i->>'noShowPenalty')::numeric, (i->>'noShowSpecialPenalty')::numeric, (i->>'dailyAcceptancePenalty')::numeric, (i->>'missedDaysPenalty')::numeric,
  (i->>'riderBalance')::numeric, (i->>'totalIncome')::numeric, (i->>'totalPenalties')::numeric, p_run->>'file_name', v_id, p_actor
 FROM jsonb_array_elements(p_income) i
 LEFT JOIN public.drivers d ON d.id = NULLIF(i->>'driverId','')::uuid AND d.tenant_id = p_tenant;
 -- The active-driver count is NOT overwritten here: without a user-confirmed count the
 -- dashboard uses the distinct riders with income that month across all platforms.
 RETURN v_id;
END $$;

-- Approve a draft run: locks results and advances installment progress once
-- per month (first approved run), recording the previous values for rollback.
CREATE FUNCTION public.payroll_engine_approve_run(p_tenant uuid, p_actor uuid, p_run_id uuid, p_expected_version integer, p_changes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run public.payroll_engine_runs%ROWTYPE; c jsonb; v_one jsonb; v_prev jsonb := '[]'::jsonb; v_first boolean;
BEGIN
 SELECT * INTO v_run FROM public.payroll_engine_runs WHERE id = p_run_id AND tenant_id = p_tenant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYENG002: payroll run not found'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('payroll_engine:' || p_tenant::text || ':' || v_run.month_key, 0));
 IF v_run.status <> 'draft' THEN RAISE EXCEPTION 'PAYENG005: only draft payroll runs can be approved'; END IF;
 IF v_run.version <> p_expected_version THEN RAISE EXCEPTION 'PAYENG004: payroll run changed; reload before approving'; END IF;
 v_first := NOT EXISTS (SELECT 1 FROM public.payroll_engine_runs WHERE tenant_id = p_tenant AND month_key = v_run.month_key
  AND status = 'approved' AND (installment_changes @> '[{"table":"items"}]'::jsonb OR installment_changes @> '[{"table":"traffic"}]'::jsonb));
 IF jsonb_typeof(p_changes) = 'array' THEN
  FOR c IN SELECT * FROM jsonb_array_elements(p_changes) LOOP
   -- One-off records deducted/paid in this run are settled (status → paid) so they are not applied again next month.
   IF c->>'table' = 'traffic_status' THEN
    SELECT jsonb_build_object('table','traffic_status','id',id,'status',status)
     INTO v_one FROM public.payroll_engine_traffic_fines WHERE id = (c->>'id')::uuid AND tenant_id = p_tenant AND status = 'approved' AND NOT installment_enabled FOR UPDATE;
    IF FOUND THEN v_prev := v_prev || jsonb_build_array(v_one); END IF;
    UPDATE public.payroll_engine_traffic_fines SET status = 'paid', updated_at = now()
     WHERE id = (c->>'id')::uuid AND tenant_id = p_tenant AND status = 'approved' AND NOT installment_enabled;
   ELSIF c->>'table' = 'adjustment_status' THEN
    SELECT jsonb_build_object('table','adjustment_status','id',id,'status',status)
     INTO v_one FROM public.payroll_engine_adjustments WHERE id = (c->>'id')::uuid AND tenant_id = p_tenant AND status = 'active' FOR UPDATE;
    IF FOUND THEN v_prev := v_prev || jsonb_build_array(v_one); END IF;
    UPDATE public.payroll_engine_adjustments SET status = 'paid', updated_at = now()
     WHERE id = (c->>'id')::uuid AND tenant_id = p_tenant AND status = 'active';
   ELSIF NOT v_first THEN
    CONTINUE; -- installments advance once per month (first approved run), like upstream
   ELSIF c->>'table' = 'items' THEN
    SELECT jsonb_build_object('table','items','id',id,'installmentTotalPaid',installment_total_paid,'installmentStatus',installment_status)
     INTO v_one FROM public.payroll_engine_items WHERE id = (c->>'id')::uuid AND tenant_id = p_tenant FOR UPDATE;
    IF FOUND THEN v_prev := v_prev || jsonb_build_array(v_one); END IF;
    UPDATE public.payroll_engine_items SET installment_total_paid = (c->>'installmentTotalPaid')::numeric, installment_status = c->>'installmentStatus', updated_at = now()
     WHERE id = (c->>'id')::uuid AND tenant_id = p_tenant;
   ELSIF c->>'table' = 'traffic' THEN
    SELECT jsonb_build_object('table','traffic','id',id,'installmentTotalPaid',installment_total_paid,'installmentStatus',installment_status)
     INTO v_one FROM public.payroll_engine_traffic_fines WHERE id = (c->>'id')::uuid AND tenant_id = p_tenant FOR UPDATE;
    IF FOUND THEN v_prev := v_prev || jsonb_build_array(v_one); END IF;
    UPDATE public.payroll_engine_traffic_fines SET installment_total_paid = (c->>'installmentTotalPaid')::numeric, installment_status = c->>'installmentStatus', updated_at = now()
     WHERE id = (c->>'id')::uuid AND tenant_id = p_tenant;
   END IF;
  END LOOP;
 END IF;
 UPDATE public.payroll_engine_runs SET status = 'approved', approved_by = p_actor, approved_at = now(), installment_changes = COALESCE(v_prev, '[]'::jsonb),
  version = version + 1, updated_at = now() WHERE id = p_run_id;
 RETURN jsonb_build_object('advanced', (SELECT count(*) FROM jsonb_array_elements(COALESCE(v_prev,'[]'::jsonb)) x WHERE x->>'table' IN ('items','traffic')),
  'settled', (SELECT count(*) FROM jsonb_array_elements(COALESCE(v_prev,'[]'::jsonb)) x WHERE x->>'table' IN ('traffic_status','adjustment_status')));
END $$;

-- Cancel a run; an approved run restores the installment progress it applied.
CREATE FUNCTION public.payroll_engine_cancel_run(p_tenant uuid, p_actor uuid, p_run_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run public.payroll_engine_runs%ROWTYPE; c jsonb;
BEGIN
 SELECT * INTO v_run FROM public.payroll_engine_runs WHERE id = p_run_id AND tenant_id = p_tenant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAYENG002: payroll run not found'; END IF;
 IF v_run.status = 'cancelled' THEN RAISE EXCEPTION 'PAYENG006: payroll run already cancelled'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'PAYENG007: a cancellation reason is required'; END IF;
 IF v_run.journal_entry_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.journal_entries WHERE id = v_run.journal_entry_id AND status <> 'draft' AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'PAYENG008: reverse the posted payroll journal before cancelling'; END IF;
 FOR c IN SELECT * FROM jsonb_array_elements(v_run.installment_changes) LOOP
  IF c->>'table' = 'items' THEN
   UPDATE public.payroll_engine_items SET installment_total_paid = (c->>'installmentTotalPaid')::numeric, installment_status = c->>'installmentStatus', updated_at = now()
    WHERE id = (c->>'id')::uuid AND tenant_id = p_tenant;
  ELSIF c->>'table' = 'traffic' THEN
   UPDATE public.payroll_engine_traffic_fines SET installment_total_paid = (c->>'installmentTotalPaid')::numeric, installment_status = c->>'installmentStatus', updated_at = now()
    WHERE id = (c->>'id')::uuid AND tenant_id = p_tenant;
  ELSIF c->>'table' = 'traffic_status' THEN
   UPDATE public.payroll_engine_traffic_fines SET status = c->>'status', updated_at = now() WHERE id = (c->>'id')::uuid AND tenant_id = p_tenant AND status = 'paid';
  ELSIF c->>'table' = 'adjustment_status' THEN
   UPDATE public.payroll_engine_adjustments SET status = c->>'status', updated_at = now() WHERE id = (c->>'id')::uuid AND tenant_id = p_tenant AND status = 'paid';
  END IF;
 END LOOP;
 UPDATE public.payroll_engine_runs SET status = 'cancelled', cancelled_by = p_actor, cancelled_at = now(), cancel_reason = btrim(p_reason),
  installment_changes = '[]'::jsonb, version = version + 1, updated_at = now() WHERE id = p_run_id;
 DELETE FROM public.payroll_income_records WHERE tenant_id = p_tenant AND run_id = p_run_id;
END $$;

REVOKE ALL ON FUNCTION public.payroll_engine_save_run(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_engine_approve_run(uuid,uuid,uuid,integer,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_engine_cancel_run(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_engine_save_run(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.payroll_engine_approve_run(uuid,uuid,uuid,integer,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.payroll_engine_cancel_run(uuid,uuid,uuid,text) TO service_role;

-- Private bucket for the original uploaded workbooks (server access only).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('payroll-workbooks', 'payroll-workbooks', false, 10485760,
 ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel'])
ON CONFLICT (id) DO NOTHING;
-- Append-only: payroll creators upload into their own tenant folder; readers
-- may download. No UPDATE/DELETE policy — archived workbooks are immutable.
CREATE POLICY storage_payroll_workbooks_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (bucket_id = 'payroll-workbooks' AND public.storage_path_in_current_tenant(name) AND public.user_has_permission('payroll','create'));
CREATE POLICY storage_payroll_workbooks_select ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id = 'payroll-workbooks' AND public.storage_path_in_current_tenant(name) AND public.user_has_permission('payroll','read'));
COMMIT;
