BEGIN;
SELECT plan(11);
INSERT INTO public.drivers (id, tenant_id, full_name_ar, primary_mobile, category, status, hire_date)
VALUES ('79000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','اختبار','0507900001','freelancer','active',CURRENT_DATE);
INSERT INTO public.driver_payroll_periods(id,tenant_id,driver_id,period_year,period_month,status,net_payroll)
SELECT ('79000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 '00000000-0000-0000-0000-000000000001','79000000-0000-4000-8000-000000000001',2026,n,
 CASE n WHEN 2 THEN 'approved' WHEN 3 THEN 'paid' WHEN 4 THEN 'locked' ELSE 'calculated' END::public.payroll_status,1000
FROM generate_series(1,4) n;
SELECT throws_ok($$UPDATE public.driver_payroll_periods SET status='calculated', net_payroll=1 WHERE id='79000000-0000-4000-8000-000000000002'$$,'P0001','PAY_APPROVED_AMOUNTS_IMMUTABLE','approved amounts cannot be overwritten');
SELECT throws_ok($$UPDATE public.driver_payroll_periods SET status='calculated' WHERE id='79000000-0000-4000-8000-000000000003'$$,'P0001','PAY_PERIOD_IMMUTABLE','paid period cannot be recalculated');
SELECT throws_ok($$UPDATE public.driver_payroll_periods SET status='cancelled',cancel_reason='test reason' WHERE id='79000000-0000-4000-8000-000000000004'$$,'P0001','PAY_PERIOD_IMMUTABLE','locked period cannot be cancelled');
SELECT throws_ok($$UPDATE public.driver_payroll_periods SET status='paid' WHERE id='79000000-0000-4000-8000-000000000001'$$,'P0001','PAY_TRANSITION_INVALID','calculation cannot bypass review');
INSERT INTO public.payroll_advances(id,tenant_id,driver_id,amount,advance_date,repayment_month,status,payroll_period_id)
VALUES ('79000000-0000-4000-8000-000000000010','00000000-0000-0000-0000-000000000001','79000000-0000-4000-8000-000000000001',100,CURRENT_DATE,'2026-01','repaid','79000000-0000-4000-8000-000000000001');
CREATE FUNCTION pg_temp.reject_rollback() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'rollback fault'; END; $$;
CREATE TRIGGER trg_test_fail_advance BEFORE UPDATE ON public.payroll_advances FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_rollback();
SELECT throws_ok($$UPDATE public.driver_payroll_periods SET status='cancelled',cancel_reason='test rollback' WHERE id='79000000-0000-4000-8000-000000000001'$$,'P0001','rollback fault','rollback failure aborts cancellation');
SELECT is((SELECT status::text FROM public.driver_payroll_periods WHERE id='79000000-0000-4000-8000-000000000001'),'calculated','failed cancellation preserves original status');
DROP TRIGGER trg_test_fail_advance ON public.payroll_advances;
SELECT lives_ok($$UPDATE public.driver_payroll_periods SET status='cancelled',cancel_reason='test rollback' WHERE id='79000000-0000-4000-8000-000000000001'$$,'cancellation succeeds atomically');
SELECT is((SELECT status FROM public.payroll_advances WHERE id='79000000-0000-4000-8000-000000000010'),'approved','advance restored');
SELECT is((SELECT payroll_period_id FROM public.payroll_advances WHERE id='79000000-0000-4000-8000-000000000010'),NULL::uuid,'advance unlinked');
SELECT throws_ok($$UPDATE public.driver_payroll_periods SET status='calculated' WHERE id='79000000-0000-4000-8000-000000000001'$$,'P0001','PAY_PERIOD_IMMUTABLE','cancelled period cannot be resurrected');
SELECT lives_ok($$UPDATE public.driver_payroll_periods SET status='paid' WHERE id='79000000-0000-4000-8000-000000000002'$$,'approved payroll can be marked paid without changing its amounts');
SELECT * FROM finish();
ROLLBACK;
