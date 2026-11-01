-- Online card payments (Moyasar hosted checkout: mada, Visa/Mastercard,
-- Apple Pay) for platform subscription invoices. Service-role only: attempts
-- are created by an authenticated server action and settled only after the
-- server re-reads the payment from Moyasar with the secret key.
BEGIN;

-- Reconcile drift: production gained tenants.billing_status out of band
-- (platform admin console). No-op there; creates it for fresh databases.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'trialing';

CREATE TABLE public.platform_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_invoice_id uuid NOT NULL REFERENCES public.platform_invoices(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'moyasar' CHECK (provider = 'moyasar'),
  provider_invoice_id text UNIQUE CHECK (provider_invoice_id IS NULL OR length(provider_invoice_id) <= 100),
  provider_payment_id text CHECK (provider_payment_id IS NULL OR length(provider_payment_id) <= 100),
  checkout_url text CHECK (checkout_url IS NULL OR (checkout_url ~ '^https://' AND length(checkout_url) <= 1000)),
  amount_halalas integer NOT NULL CHECK (amount_halalas > 0),
  currency text NOT NULL DEFAULT 'SAR' CHECK (currency = 'SAR'),
  status text NOT NULL DEFAULT 'creating' CHECK (status IN ('creating', 'initiated', 'paid', 'failed', 'expired', 'canceled')),
  failure_reason text CHECK (failure_reason IS NULL OR length(failure_reason) <= 300),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX platform_payment_attempts_invoice ON public.platform_payment_attempts(platform_invoice_id, created_at DESC);
CREATE INDEX platform_payment_attempts_tenant ON public.platform_payment_attempts(tenant_id, created_at DESC);
-- At most one settled attempt per invoice (double-payment guard).
CREATE UNIQUE INDEX platform_payment_attempts_one_paid ON public.platform_payment_attempts(platform_invoice_id) WHERE status = 'paid';

ALTER TABLE public.platform_payment_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_payment_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.platform_payment_attempts TO service_role;

ALTER TABLE public.platform_invoices
  ADD COLUMN IF NOT EXISTS payment_method text CHECK (payment_method IS NULL OR payment_method IN ('manual', 'card')),
  ADD COLUMN IF NOT EXISTS payment_reference text CHECK (payment_reference IS NULL OR length(payment_reference) <= 100);

-- Settle exactly once: invoice → paid, tenant → active_paid, attempt → paid, audit.
CREATE OR REPLACE FUNCTION public.settle_platform_card_payment(p_attempt_id uuid, p_provider_payment_id text, p_amount_halalas integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  a public.platform_payment_attempts%ROWTYPE;
  inv public.platform_invoices%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.platform_payment_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAY001: unknown payment attempt'; END IF;
  SELECT * INTO inv FROM public.platform_invoices WHERE id = a.platform_invoice_id FOR UPDATE;
  IF a.status = 'paid' AND inv.payment_reference IS NOT DISTINCT FROM a.provider_payment_id THEN RETURN 'already_settled'; END IF;
  IF a.failure_reason LIKE 'Captured after%' THEN RETURN 'duplicate_payment'; END IF;
  IF p_amount_halalas IS DISTINCT FROM a.amount_halalas OR inv.tenant_id <> a.tenant_id
     OR round(inv.amount * 100)::integer <> a.amount_halalas OR inv.currency <> 'SAR' THEN
    RAISE EXCEPTION 'PAY002: payment does not match the invoice';
  END IF;
  IF inv.status = 'paid' THEN
    -- Paid some other way while checkout was open: record it, never double-settle.
    UPDATE public.platform_payment_attempts SET
      status = CASE WHEN EXISTS (SELECT 1 FROM public.platform_payment_attempts x WHERE x.platform_invoice_id = a.platform_invoice_id AND x.status = 'paid') THEN 'failed' ELSE 'paid' END,
      provider_payment_id = left(p_provider_payment_id, 100), paid_at = now(), updated_at = now(),
      failure_reason = 'Captured after the invoice was already paid; refund required'
    WHERE id = a.id;
    INSERT INTO public.audit_log(tenant_id, actor_id, module, entity_type, entity_id, action, new_values)
      VALUES (a.tenant_id, NULL, 'platform_billing', 'platform_invoices', inv.id, 'card_payment_duplicate',
              jsonb_build_object('attempt_id', a.id, 'provider_payment_id', p_provider_payment_id, 'amount_halalas', p_amount_halalas));
    RETURN 'duplicate_payment';
  END IF;
  IF inv.status NOT IN ('pending', 'overdue') THEN RAISE EXCEPTION 'PAY003: invoice is not payable'; END IF;

  UPDATE public.platform_payment_attempts SET status = 'paid', provider_payment_id = left(p_provider_payment_id, 100), paid_at = now(), updated_at = now() WHERE id = a.id;
  UPDATE public.platform_invoices SET status = 'paid', paid_at = now(), updated_at = now(), payment_method = 'card', payment_reference = left(p_provider_payment_id, 100) WHERE id = inv.id;
  UPDATE public.tenants SET billing_status = 'active_paid' WHERE id = a.tenant_id;
  INSERT INTO public.audit_log(tenant_id, actor_id, module, entity_type, entity_id, action, new_values)
    VALUES (a.tenant_id, a.created_by, 'platform_billing', 'platform_invoices', inv.id, 'card_payment_settled',
            jsonb_build_object('attempt_id', a.id, 'provider', a.provider, 'provider_payment_id', p_provider_payment_id, 'amount_halalas', p_amount_halalas));
  RETURN 'settled';
END;
$$;
REVOKE ALL ON FUNCTION public.settle_platform_card_payment(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_platform_card_payment(uuid, text, integer) TO service_role;

COMMIT;
