BEGIN;
-- Enforce state and financial immutability even for service-role upserts.
CREATE OR REPLACE FUNCTION public.guard_payroll_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.role() = 'authenticated' AND (NEW.status NOT IN ('draft','calculated') OR NEW.period_locked) THEN
      RAISE EXCEPTION 'PAY_INITIAL_STATUS_INVALID' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.driver_id IS DISTINCT FROM OLD.driver_id
     OR NEW.period_year IS DISTINCT FROM OLD.period_year OR NEW.period_month IS DISTINCT FROM OLD.period_month THEN
    RAISE EXCEPTION 'PAY_IDENTITY_IMMUTABLE';
  END IF;
  IF OLD.period_locked OR OLD.status IN ('paid','locked','cancelled') THEN
    IF (to_jsonb(NEW) - ARRAY['orders_above_target','orders_below_target']) - 'updated_at' IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['orders_above_target','orders_below_target']) - 'updated_at' THEN
      RAISE EXCEPTION 'PAY_PERIOD_IMMUTABLE';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' AND (
    (to_jsonb(NEW) - ARRAY['orders_above_target','orders_below_target']) - ARRAY['status','updated_at','updated_by','paid_at','paid_by','cancel_reason','cancelled_at','cancelled_by']
    IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['orders_above_target','orders_below_target']) - ARRAY['status','updated_at','updated_by','paid_at','paid_by','cancel_reason','cancelled_at','cancelled_by']
  ) THEN RAISE EXCEPTION 'PAY_APPROVED_AMOUNTS_IMMUTABLE'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status IN ('calculated','cancelled')) OR
    (OLD.status = 'calculated' AND NEW.status IN ('in_review','cancelled')) OR
    (OLD.status = 'in_review' AND NEW.status IN ('approved','calculated','cancelled')) OR
    (OLD.status = 'approved' AND NEW.status IN ('paid','cancelled'))
  ) THEN RAISE EXCEPTION 'PAY_TRANSITION_INVALID'; END IF;
  IF NEW.status = 'approved' AND OLD.status <> 'approved'
     AND auth.role() = 'authenticated' AND NOT public.user_has_permission('payroll','approve') THEN
    RAISE EXCEPTION 'PAY_APPROVAL_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_payroll_integrity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_payroll_integrity BEFORE INSERT OR UPDATE ON public.driver_payroll_periods
FOR EACH ROW EXECUTE FUNCTION public.guard_payroll_integrity();

-- An AFTER trigger keeps every cancellation path and every deduction rollback
-- in the same transaction. Any failure rolls the entire transition back.
CREATE OR REPLACE FUNCTION public.rollback_cancelled_payroll()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer; v_advance_count integer;
BEGIN
  IF NEW.status <> 'cancelled' OR OLD.status = 'cancelled' THEN RETURN NEW; END IF;
  UPDATE public.violations v SET deduction_applied = false, deduction_applied_at = NULL,
    deduction_applied_by = NULL, payroll_period_id = NULL, status = 'resolved'
  WHERE v.tenant_id = NEW.tenant_id AND v.driver_id = NEW.driver_id
    AND EXISTS (SELECT 1 FROM public.violation_deduction_ledger l
      WHERE l.violation_id = v.id AND l.tenant_id = NEW.tenant_id
        AND l.payroll_period_id = NEW.id AND l.status = 'applied');
  UPDATE public.violation_deduction_ledger SET status = 'pending', applied_at = NULL,
    applied_by = NULL, payroll_period_id = NULL, rollback_reason = NEW.cancel_reason,
    rolled_back_by = NEW.cancelled_by, rolled_back_at = now()
  WHERE tenant_id = NEW.tenant_id AND driver_id = NEW.driver_id
    AND payroll_period_id = NEW.id AND status = 'applied';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.payroll_advances SET status = 'approved', payroll_period_id = NULL, repaid_at = NULL
  WHERE tenant_id = NEW.tenant_id AND driver_id = NEW.driver_id
    AND payroll_period_id = NEW.id AND status = 'repaid';
  GET DIAGNOSTICS v_advance_count = ROW_COUNT;
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, entity_id, action, old_values, new_values)
  VALUES (NEW.tenant_id, NEW.cancelled_by, 'payroll', 'driver_payroll_period', NEW.id, 'payroll_cancelled',
    jsonb_build_object('status', OLD.status),
    jsonb_build_object('reason', NEW.cancel_reason, 'rolledback_violations', v_count, 'rolledback_advances', v_advance_count));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.rollback_cancelled_payroll() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_rollback_cancelled_payroll AFTER UPDATE ON public.driver_payroll_periods
FOR EACH ROW EXECUTE FUNCTION public.rollback_cancelled_payroll();
COMMIT;
