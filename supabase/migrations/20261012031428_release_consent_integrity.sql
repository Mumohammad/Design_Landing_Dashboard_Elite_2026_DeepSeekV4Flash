BEGIN;
-- Consent evidence is append-only. A changed decision requires a new record.
CREATE OR REPLACE FUNCTION public.prevent_consent_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'CONSENT_APPEND_ONLY'; END;
$$;
REVOKE ALL ON FUNCTION public.prevent_consent_mutation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_driver_consent_immutable BEFORE UPDATE OR DELETE ON public.driver_consents
FOR EACH ROW EXECUTE FUNCTION public.prevent_consent_mutation();
CREATE TRIGGER trg_user_consent_immutable BEFORE UPDATE OR DELETE ON public.user_consents
FOR EACH ROW EXECUTE FUNCTION public.prevent_consent_mutation();
REVOKE UPDATE,DELETE ON public.driver_consents,public.user_consents FROM anon,authenticated;
ALTER TABLE public.driver_consents DROP CONSTRAINT IF EXISTS driver_consents_tenant_id_driver_id_consent_type_version_key;
ALTER TABLE public.user_consents DROP CONSTRAINT IF EXISTS user_consents_tenant_id_user_id_consent_type_version_key;
ALTER TABLE public.driver_consents ADD COLUMN event_sequence bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.user_consents ADD COLUMN event_sequence bigint GENERATED ALWAYS AS IDENTITY;
-- Use server-assigned insertion order; client timestamps cannot resurrect consent.
DO $policies$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname,tablename FROM pg_policies WHERE schemaname='public'
    AND tablename IN ('driver_consents','user_consents') AND cmd IN ('UPDATE','DELETE')
  LOOP EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,p.tablename); END LOOP;
END;
$policies$;
CREATE INDEX idx_driver_consent_latest ON public.driver_consents(tenant_id,driver_id,consent_type,event_sequence DESC);
CREATE INDEX idx_user_consent_latest ON public.user_consents(tenant_id,user_id,consent_type,event_sequence DESC);
CREATE OR REPLACE FUNCTION public.has_user_pdpl_consent(
  p_user_id uuid,
  p_consent_type text DEFAULT 'terms'
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_is_service boolean :=
    COALESCE((auth.jwt() ->> 'role') = 'service_role', false)
    OR current_setting('role', true) IN ('none', 'postgres');
BEGIN
  SELECT u.tenant_id
    INTO v_tenant_id
  FROM public.users u
  WHERE u.id = p_user_id
    AND u.deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT v_is_service AND (
    v_tenant_id IS DISTINCT FROM public.get_my_tenant_id()
    OR NOT public.user_has_permission('users', 'read')
  ) THEN
    RETURN false;
  END IF;

  RETURN COALESCE((SELECT c.accepted FROM public.user_consents c
    WHERE c.user_id=p_user_id AND c.tenant_id=v_tenant_id AND c.consent_type=p_consent_type
    ORDER BY c.event_sequence DESC LIMIT 1),false);
END;
$$;


CREATE OR REPLACE FUNCTION public.has_pdpl_consent(p_driver_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
  v_is_service boolean :=
    COALESCE((auth.jwt() ->> 'role') = 'service_role', false)
    OR current_setting('role', true) IN ('none', 'postgres');
  v_result boolean;
BEGIN
  SELECT d.tenant_id
    INTO v_tenant_id
  FROM public.drivers d
  WHERE d.id = p_driver_id
    AND d.deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT v_is_service AND (
    v_tenant_id IS DISTINCT FROM public.get_my_tenant_id()
    OR NOT public.user_has_permission('drivers', 'read')
  ) THEN
    RETURN false;
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (c.consent_type)
      c.consent_type,
      c.accepted
    FROM public.driver_consents c
    WHERE c.driver_id = p_driver_id
      AND c.tenant_id = v_tenant_id
      AND c.consent_type IN ('photo', 'sensitive_docs')
    ORDER BY c.consent_type, c.event_sequence DESC
  )
  SELECT count(*) = 2 AND COALESCE(bool_and(accepted), false)
    INTO v_result
  FROM latest;

  RETURN COALESCE(v_result, false);
END;
$$;


COMMIT;
