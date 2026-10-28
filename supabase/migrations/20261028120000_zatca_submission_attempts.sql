-- Append-only evidence of every non-production ZATCA submission attempt
-- (compliance check, reporting, clearance), including rejections. Written
-- only by the server (service role); never readable or writable by clients.
CREATE TABLE IF NOT EXISTS public.zatca_submission_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  issuance_id uuid NOT NULL REFERENCES public.zatca_document_issuances(id),
  environment text NOT NULL CHECK (environment IN ('sandbox','simulation')),
  pipeline text NOT NULL CHECK (pipeline IN ('compliance','reporting','clearance')),
  status text NOT NULL CHECK (status IN ('reported','cleared','rejected','failed')),
  http_status integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  invoice_hash text NOT NULL CHECK (invoice_hash ~ '^[A-Za-z0-9+/]{43}=$'),
  signed_xml text NOT NULL CHECK (octet_length(signed_xml) BETWEEN 1 AND 2097152),
  cleared_xml text CHECK (cleared_xml IS NULL OR octet_length(cleared_xml) BETWEEN 1 AND 2097152),
  response jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response) = 'object'),
  error_code text CHECK (error_code IS NULL OR length(error_code) <= 40),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_zatca_submission_attempts_issuance
  ON public.zatca_submission_attempts(tenant_id, issuance_id, created_at DESC);

ALTER TABLE public.zatca_submission_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zatca_submission_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.zatca_submission_attempts TO service_role;

-- Evidence is immutable: no updates or deletes, even by the service role.
CREATE OR REPLACE FUNCTION public.zatca_submission_attempts_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'ZTC_EVIDENCE: submission attempts are append-only' USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS trg_zatca_submission_attempts_immutable ON public.zatca_submission_attempts;
CREATE TRIGGER trg_zatca_submission_attempts_immutable
  BEFORE UPDATE OR DELETE ON public.zatca_submission_attempts
  FOR EACH ROW EXECUTE FUNCTION public.zatca_submission_attempts_immutable();

-- The attempt must belong to the issuance's tenant and environment.
CREATE OR REPLACE FUNCTION public.zatca_submission_attempts_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.zatca_document_issuances d
    WHERE d.id = NEW.issuance_id AND d.tenant_id = NEW.tenant_id AND d.environment = NEW.environment
      AND d.invoice_hash = NEW.invoice_hash) THEN
    RAISE EXCEPTION 'ZTC_EVIDENCE: attempt does not match its issuance' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_zatca_submission_attempts_scope ON public.zatca_submission_attempts;
CREATE TRIGGER trg_zatca_submission_attempts_scope
  BEFORE INSERT ON public.zatca_submission_attempts
  FOR EACH ROW EXECUTE FUNCTION public.zatca_submission_attempts_scope();

REVOKE ALL ON FUNCTION public.zatca_submission_attempts_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zatca_submission_attempts_scope() FROM PUBLIC, anon, authenticated;
