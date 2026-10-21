-- Read-only financial dashboard: all posted GL lines and active posted AR,
-- aggregated before Data API row caps. No historical document/ledger writes.
-- These four existing SELECT policies retain their exact authorization rules.
-- Cache only caller-wide STABLE decisions once per statement, rather than
-- looking up the same tenant/permission for every line/account/AR match.
-- Fail closed if the catalog differs from the repository's reviewed policy;
-- never replace an unknown policy or a FOR ALL/mutation policy.
DO $$
DECLARE
  v_table text; v_policy text; v_qual text; v_expected text;
  v_authenticated oid := (SELECT oid FROM pg_roles WHERE rolname='authenticated');
  v_before_path text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path','',true);
  FOR v_table,v_policy IN SELECT * FROM (VALUES
    ('journal_entries','sel_journal_entries_tenant'),
    ('journal_entry_lines','sel_jel_tenant'),
    ('chart_of_accounts','sel_chart_of_accounts_tenant'),
    ('receivables','sel_receivables_tenant')) policies(table_name,policy_name)
  LOOP
    SELECT regexp_replace(replace(pg_get_expr(p.polqual,p.polrelid),'public.',''),'[[:space:]()]','','g')
      INTO v_qual
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=v_table AND p.polname=v_policy
        AND p.polcmd='r' AND p.polpermissive AND p.polroles=ARRAY[v_authenticated] AND c.relrowsecurity;
    v_expected := 'tenant_id=get_my_tenant_id'
      || CASE WHEN v_table='journal_entry_lines' THEN '' ELSE 'ANDdeleted_atISNULL' END
      || 'ANDuser_has_permission''accounting''::text,''read''::text';
    IF v_qual IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'Financial KPI SELECT policy drift: %',v_table;
    END IF;
    EXECUTE format('ALTER POLICY %I ON public.%I USING (tenant_id=(SELECT public.get_my_tenant_id()) %s AND (SELECT public.user_has_permission(''accounting'',''read'')))',
      v_policy,v_table,CASE WHEN v_table='journal_entry_lines' THEN '' ELSE 'AND deleted_at IS NULL' END);
  END LOOP;
  PERFORM set_config('search_path',v_before_path,true);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_my_financial_kpis(p_start date, p_end date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := public.get_my_tenant_id();
  v_previous_start date;
  v_result jsonb;
BEGIN
  IF v_tenant IS NULL OR NOT COALESCE(public.user_has_permission('accounting','read'),false) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Financial KPI access denied';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end)
    OR p_start < DATE '0001-01-01' OR p_end > DATE '9999-12-31' OR p_start > p_end THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid financial KPI date range';
  END IF;
  v_previous_start := p_start - (p_end-p_start+1);

  WITH entries AS MATERIALIZED (
    SELECT j.id,j.entry_date,j.entry_type,j.source_entity_type,j.source_entity_id
    FROM public.journal_entries j
    WHERE j.tenant_id=v_tenant AND j.deleted_at IS NULL
      -- A reversed original remains in its original period. Its separate
      -- posted reversal nets the effect in the reversal's own entry_date.
      AND j.status IN ('posted','reversed')
      AND j.entry_date BETWEEN v_previous_start AND p_end
  ), balances AS (
    SELECT
      COALESCE(SUM(l.credit_amount-l.debit_amount) FILTER (WHERE a.account_type='income' AND j.entry_date>=p_start),0) AS revenue,
      COALESCE(SUM(l.credit_amount-l.debit_amount) FILTER (WHERE a.account_type='income' AND j.entry_date<p_start),0) AS revenue_previous,
      COALESCE(SUM(l.debit_amount-l.credit_amount) FILTER (WHERE a.account_type='expense' AND j.entry_date>=p_start),0) AS expenses,
      COALESCE(SUM(l.debit_amount-l.credit_amount) FILTER (WHERE a.account_type='expense' AND j.entry_date<p_start),0) AS expenses_previous
    FROM entries j
    JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id AND l.tenant_id=v_tenant
    JOIN public.chart_of_accounts a ON a.id=l.account_id AND a.tenant_id=v_tenant AND a.deleted_at IS NULL
  ), documents AS (
    SELECT
      COUNT(DISTINCT j.source_entity_id) FILTER (WHERE j.entry_type='invoice' AND j.source_entity_type='invoice' AND j.entry_date>=p_start) AS invoices_count,
      COUNT(DISTINCT j.source_entity_id) FILTER (WHERE j.entry_type='invoice' AND j.source_entity_type='invoice' AND j.entry_date<p_start) AS invoices_count_previous,
      COUNT(DISTINCT j.source_entity_id) FILTER (WHERE j.entry_type='expense' AND j.source_entity_type='expense' AND j.entry_date>=p_start) AS expenses_count
    FROM entries j
  ), posted_ar_sources AS MATERIALIZED (
    SELECT DISTINCT j.source_entity_type,j.source_entity_id
    FROM public.journal_entries j
    WHERE j.tenant_id=v_tenant AND j.deleted_at IS NULL AND j.status IN ('posted','reversed')
      AND j.entry_type='invoice' AND j.source_entity_type IN ('invoice','debit_note')
      AND j.source_entity_id IS NOT NULL
  ), pending AS (
    SELECT COALESCE(SUM(r.total_amount-r.paid_amount),0) AS amount,COUNT(*) AS count
    FROM public.receivables r
    WHERE r.tenant_id=v_tenant AND r.deleted_at IS NULL
      AND r.status IN ('open','partially_paid','overdue')
      AND r.source_entity_type IN ('invoice','debit_note')
      AND r.total_amount>r.paid_amount
      AND EXISTS (
        SELECT 1 FROM posted_ar_sources j
        WHERE j.source_entity_type=r.source_entity_type AND j.source_entity_id=r.source_entity_id
      )
  )
  SELECT jsonb_build_object(
    'revenue',round(b.revenue,2)::text,'revenuePrevious',round(b.revenue_previous,2)::text,
    'invoicesCount',d.invoices_count,'invoicesCountPrevious',d.invoices_count_previous,
    'pendingInvoicesAmount',round(p.amount,2)::text,'pendingInvoicesCount',p.count,
    'expenses',round(b.expenses,2)::text,'expensesPrevious',round(b.expenses_previous,2)::text,
    'expensesCount',d.expenses_count,'netResult',round(b.revenue-b.expenses,2)::text
  ) INTO v_result FROM balances b CROSS JOIN documents d CROSS JOIN pending p;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.read_my_financial_kpis(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_my_financial_kpis(date,date) TO authenticated,service_role;
COMMENT ON FUNCTION public.read_my_financial_kpis(date,date) IS
  'Caller-bound posted-ledger income/expense, posted source counts and active invoice/debit-note AR. Inclusive dates; immediately preceding equal-length comparison; money in exact decimal strings.';
NOTIFY pgrst,'reload schema';
