-- Drivers module finalization (2/3):
--  * Digital handover evidence: photos + driver/supervisor signatures stored in
--    a private, tenant-scoped bucket and attached to vehicle_handover_forms.
--    A signature acknowledges the inspection; acknowledged forms stay immutable.
--  * Driver offboarding: checklist + final settlement + clearance certificate.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('handover-evidence', 'handover-evidence', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS storage_handover_evidence_read ON storage.objects;
CREATE POLICY storage_handover_evidence_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'handover-evidence' AND public.storage_path_in_current_tenant(name) AND public.user_has_permission('assignments', 'read'));
DROP POLICY IF EXISTS storage_handover_evidence_insert ON storage.objects;
CREATE POLICY storage_handover_evidence_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'handover-evidence' AND public.storage_path_in_current_tenant(name) AND public.user_has_permission('assignments', 'update'));

CREATE OR REPLACE FUNCTION public.attach_handover_evidence(
  p_form_id uuid,
  p_photos text[] DEFAULT NULL,
  p_signer text DEFAULT NULL,
  p_signature_path text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t uuid := public.get_my_tenant_id();
  actor uuid := auth.uid();
  h public.vehicle_handover_forms;
  n public.vehicle_handover_forms;
  prefix text;
  p text;
BEGIN
  IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('assignments', 'update') THEN
    RAISE EXCEPTION 'AUTH007: assignment permission required';
  END IF;
  SELECT * INTO h FROM public.vehicle_handover_forms WHERE id = p_form_id AND tenant_id = t AND deleted_at IS NULL FOR UPDATE;
  IF h.id IS NULL THEN RAISE EXCEPTION 'HOE001: handover form not found'; END IF;
  prefix := t::text || '/' || h.id::text || '/';
  IF p_photos IS NOT NULL THEN
    IF h.driver_acknowledged_at IS NOT NULL AND h.supervisor_acknowledged_at IS NOT NULL THEN
      RAISE EXCEPTION 'HOE002: signed handover evidence is immutable';
    END IF;
    IF coalesce(array_length(h.photos, 1), 0) + coalesce(array_length(p_photos, 1), 0) > 24 THEN
      RAISE EXCEPTION 'HOE003: up to 24 photos per handover';
    END IF;
    FOREACH p IN ARRAY p_photos LOOP
      IF p IS NULL OR left(p, length(prefix)) <> prefix OR p ~ '\.\.' OR length(p) > 300 THEN RAISE EXCEPTION 'HOE004: invalid evidence path'; END IF;
    END LOOP;
  END IF;
  IF p_signer IS NOT NULL THEN
    IF p_signer NOT IN ('driver', 'supervisor') THEN RAISE EXCEPTION 'HOE005: invalid signer'; END IF;
    IF p_signature_path IS NULL OR left(p_signature_path, length(prefix)) <> prefix OR p_signature_path ~ '\.\.' THEN RAISE EXCEPTION 'HOE004: invalid evidence path'; END IF;
    IF (p_signer = 'driver' AND h.driver_acknowledged_at IS NOT NULL) OR (p_signer = 'supervisor' AND h.supervisor_acknowledged_at IS NOT NULL) THEN
      RAISE EXCEPTION 'HOE006: already signed';
    END IF;
  END IF;
  UPDATE public.vehicle_handover_forms SET
    photos = CASE WHEN p_photos IS NULL THEN photos ELSE coalesce(photos, '{}') || p_photos END,
    driver_signature_url = CASE WHEN p_signer = 'driver' THEN p_signature_path ELSE driver_signature_url END,
    driver_acknowledged_at = CASE WHEN p_signer = 'driver' THEN now() ELSE driver_acknowledged_at END,
    supervisor_signature_url = CASE WHEN p_signer = 'supervisor' THEN p_signature_path ELSE supervisor_signature_url END,
    supervisor_acknowledged_at = CASE WHEN p_signer = 'supervisor' THEN now() ELSE supervisor_acknowledged_at END,
    finalized_at = CASE WHEN p_signer IS NOT NULL AND finalized_at IS NULL THEN now() ELSE finalized_at END,
    finalized_by = CASE WHEN p_signer IS NOT NULL AND finalized_at IS NULL THEN actor ELSE finalized_by END,
    updated_by = actor
  WHERE id = h.id RETURNING * INTO n;
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, entity_id, action, old_values, new_values)
  VALUES (t, actor, 'vehicles', 'vehicle_handover_forms', h.id,
    CASE WHEN p_signer IS NOT NULL THEN 'vehicle_handover_signed_' || p_signer ELSE 'vehicle_handover_photos_added' END,
    jsonb_build_object('photos', coalesce(array_length(h.photos, 1), 0), 'driver_signed', h.driver_acknowledged_at IS NOT NULL, 'supervisor_signed', h.supervisor_acknowledged_at IS NOT NULL),
    jsonb_build_object('photos', coalesce(array_length(n.photos, 1), 0), 'driver_signed', n.driver_acknowledged_at IS NOT NULL, 'supervisor_signed', n.supervisor_acknowledged_at IS NOT NULL));
  RETURN jsonb_build_object('id', n.id, 'photos', coalesce(array_length(n.photos, 1), 0),
    'driver_acknowledged_at', n.driver_acknowledged_at, 'supervisor_acknowledged_at', n.supervisor_acknowledged_at);
END;
$$;
REVOKE ALL ON FUNCTION public.attach_handover_evidence(uuid, text[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_handover_evidence(uuid, text[], text, text) TO authenticated;

-- ═══ Offboarding ═══
CREATE TABLE IF NOT EXISTS public.driver_offboarding (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants (id),
  driver_id             uuid NOT NULL REFERENCES public.drivers (id),
  status                text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  exit_type             text NOT NULL CHECK (exit_type IN ('resignation', 'termination', 'end_of_contract', 'transfer', 'final_exit', 'other')),
  reason                text CHECK (reason IS NULL OR length(reason) <= 1000),
  last_working_day      date NOT NULL,
  checklist             jsonb NOT NULL DEFAULT '{}'::jsonb,
  settlement_amount     numeric(12, 2) CHECK (settlement_amount IS NULL OR settlement_amount BETWEEN -1000000 AND 1000000),
  settlement_notes      text CHECK (settlement_notes IS NULL OR length(settlement_notes) <= 1000),
  clearance_ref         text UNIQUE,
  completed_at          timestamptz,
  completed_by          uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_driver_offboarding_open ON public.driver_offboarding (driver_id) WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS idx_driver_offboarding_tenant ON public.driver_offboarding (tenant_id, status, last_working_day DESC);
ALTER TABLE public.driver_offboarding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_offboarding FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.driver_offboarding TO authenticated;
DROP POLICY IF EXISTS driver_offboarding_sel ON public.driver_offboarding;
CREATE POLICY driver_offboarding_sel ON public.driver_offboarding FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.user_has_permission('drivers', 'read'));

-- Manual checklist keys (system checks such as vehicle return are derived live).
CREATE OR REPLACE FUNCTION driver_operations_private.offboarding_manual_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ARRAY['assets_returned', 'final_settlement', 'exit_interview', 'gosi_deregistered', 'muqeem_updated', 'visa_or_transfer', 'access_revoked']::text[];
$$;
REVOKE ALL ON FUNCTION driver_operations_private.offboarding_manual_keys() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_driver_offboarding(
  p_driver_id uuid,
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t uuid := public.get_my_tenant_id();
  actor uuid := auth.uid();
  o public.driver_offboarding;
  n public.driver_offboarding;
  k text;
  missing text[];
BEGIN
  IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('drivers', 'update') THEN
    RAISE EXCEPTION 'AUTH007: driver permission required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id AND tenant_id = t AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'DPA001: active tenant driver required';
  END IF;
  SELECT * INTO o FROM public.driver_offboarding WHERE driver_id = p_driver_id AND tenant_id = t AND status = 'in_progress' FOR UPDATE;

  IF p_action = 'start' THEN
    IF o.id IS NOT NULL THEN RAISE EXCEPTION 'OFB001: offboarding already in progress'; END IF;
    INSERT INTO public.driver_offboarding (tenant_id, driver_id, exit_type, reason, last_working_day, created_by, updated_by)
    VALUES (t, p_driver_id, coalesce(p_payload->>'exit_type', 'other'), nullif(btrim(p_payload->>'reason'), ''),
            coalesce(nullif(p_payload->>'last_working_day', '')::date, (now() AT TIME ZONE 'Asia/Riyadh')::date), actor, actor)
    RETURNING * INTO n;
  ELSIF o.id IS NULL THEN
    RAISE EXCEPTION 'OFB002: no offboarding in progress';
  ELSIF p_action = 'check' THEN
    k := p_payload->>'key';
    IF NOT (k = ANY (driver_operations_private.offboarding_manual_keys())) THEN RAISE EXCEPTION 'OFB003: unknown checklist item'; END IF;
    UPDATE public.driver_offboarding SET
      checklist = checklist || jsonb_build_object(k, CASE WHEN coalesce((p_payload->>'done')::boolean, false)
        THEN jsonb_build_object('done', true, 'at', now(), 'by', actor, 'note', left(nullif(btrim(p_payload->>'note'), ''), 300))
        ELSE jsonb_build_object('done', false) END),
      updated_at = now(), updated_by = actor
    WHERE id = o.id RETURNING * INTO n;
  ELSIF p_action = 'update' THEN
    UPDATE public.driver_offboarding SET
      exit_type = coalesce(p_payload->>'exit_type', exit_type),
      reason = CASE WHEN p_payload ? 'reason' THEN nullif(btrim(p_payload->>'reason'), '') ELSE reason END,
      last_working_day = coalesce(nullif(p_payload->>'last_working_day', '')::date, last_working_day),
      settlement_amount = CASE WHEN p_payload ? 'settlement_amount' THEN nullif(p_payload->>'settlement_amount', '')::numeric ELSE settlement_amount END,
      settlement_notes = CASE WHEN p_payload ? 'settlement_notes' THEN nullif(btrim(p_payload->>'settlement_notes'), '') ELSE settlement_notes END,
      updated_at = now(), updated_by = actor
    WHERE id = o.id RETURNING * INTO n;
  ELSIF p_action = 'complete' THEN
    SELECT array_agg(x) INTO missing FROM unnest(driver_operations_private.offboarding_manual_keys()) x
     WHERE coalesce((o.checklist->x->>'done')::boolean, false) IS NOT TRUE;
    IF missing IS NOT NULL THEN RAISE EXCEPTION 'OFB004: complete every checklist item first (%)', array_to_string(missing, ', '); END IF;
    IF EXISTS (SELECT 1 FROM public.vehicle_assignments WHERE driver_id = p_driver_id AND tenant_id = t AND is_current AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'OFB005: return the assigned vehicle first';
    END IF;
    IF EXISTS (SELECT 1 FROM public.driver_platform_accounts WHERE driver_id = p_driver_id AND tenant_id = t AND status = 'active' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'OFB006: deactivate platform rider accounts first';
    END IF;
    UPDATE public.driver_offboarding SET status = 'completed', completed_at = now(), completed_by = actor,
      clearance_ref = 'CLR-' || to_char(now() AT TIME ZONE 'Asia/Riyadh', 'YYYYMMDD') || '-' || upper(substr(replace(o.id::text, '-', ''), 1, 6)),
      updated_at = now(), updated_by = actor
    WHERE id = o.id RETURNING * INTO n;
  ELSIF p_action = 'cancel' THEN
    UPDATE public.driver_offboarding SET status = 'cancelled', updated_at = now(), updated_by = actor WHERE id = o.id RETURNING * INTO n;
  ELSE
    RAISE EXCEPTION 'OFB009: unknown action';
  END IF;

  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, entity_id, action, old_values, new_values)
  VALUES (t, actor, 'drivers', 'driver_offboarding', n.id, 'offboarding_' || p_action, CASE WHEN o.id IS NULL THEN NULL ELSE to_jsonb(o) END, to_jsonb(n));
  RETURN to_jsonb(n);
END;
$$;
REVOKE ALL ON FUNCTION public.save_driver_offboarding(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_driver_offboarding(uuid, text, jsonb) TO authenticated;

COMMIT;
