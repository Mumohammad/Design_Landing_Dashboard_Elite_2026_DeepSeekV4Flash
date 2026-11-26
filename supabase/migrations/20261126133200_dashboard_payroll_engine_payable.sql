BEGIN;
SET LOCAL lock_timeout = '5s';

-- Keep historical detail inside PostgreSQL and use the same per-rider numeric
-- rounding as create_my_platform_payroll_journal. The caller's RLS applies to
-- both relations, and an incomplete result set is visible in its row count.
CREATE FUNCTION public.dashboard_payroll_engine_payable(p_from_month text)
RETURNS TABLE(id uuid, month_key text, total_drivers integer, result_count bigint, payable_total numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT r.id, r.month_key, r.total_drivers, count(d.id), coalesce(sum(round(d.final_net_salary, 2)), 0)
  FROM public.payroll_engine_runs AS r
  LEFT JOIN public.payroll_engine_results AS d ON d.run_id = r.id AND d.tenant_id = r.tenant_id
  WHERE p_from_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
    AND r.month_key >= p_from_month AND r.status = 'approved'
  GROUP BY r.id;
$$;

REVOKE ALL ON FUNCTION public.dashboard_payroll_engine_payable(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_payroll_engine_payable(text) TO authenticated;

COMMIT;
