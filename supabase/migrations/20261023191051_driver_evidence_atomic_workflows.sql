BEGIN;
-- Caller-bound evidence changes; no existing business records or Storage objects
-- are repaired, removed or reclassified by applying this migration.
ALTER TABLE public.driver_documents ADD COLUMN workflow_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.driver_cards ADD COLUMN workflow_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.driver_compliance_overrides ADD COLUMN workflow_version integer NOT NULL DEFAULT 1;
DO $acl$ DECLARE tab text;cols text;BEGIN
 FOREACH tab IN ARRAY ARRAY['driver_documents','driver_cards','driver_compliance_overrides','driver_card_prints'] LOOP
  EXECUTE format('REVOKE INSERT,UPDATE,DELETE ON public.%I FROM PUBLIC,anon,authenticated,service_role',tab);
  SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute WHERE attrelid=('public.'||tab)::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('REVOKE INSERT (%s),UPDATE (%s) ON public.%I FROM PUBLIC,anon,authenticated,service_role',cols,cols,tab);
 END LOOP;
END;$acl$;
-- Uploaded evidence is append-only. Every replacement uses a new object name;
-- neither a stale browser nor a later upload can overwrite verified bytes.
DROP POLICY IF EXISTS storage_driver_documents_update ON storage.objects;
DROP POLICY IF EXISTS storage_driver_photos_update ON storage.objects;
CREATE TABLE driver_operations_private.photo_records(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),driver_id uuid NOT NULL REFERENCES public.drivers(id),object_id uuid NOT NULL,path text NOT NULL,mime_type text NOT NULL,size_bytes bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),created_by uuid NOT NULL REFERENCES auth.users(id),retired_at timestamptz,retired_by uuid REFERENCES auth.users(id)
);
ALTER TABLE driver_operations_private.photo_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON driver_operations_private.photo_records FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX driver_photo_evidence_driver ON driver_operations_private.photo_records(tenant_id,driver_id,created_at DESC);
CREATE FUNCTION driver_operations_private.evidence_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $guard$
DECLARE immutable_old jsonb;immutable_new jsonb;allowed text[];
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'EVIDENCE_HISTORY_IMMUTABLE';END IF;
 IF current_user='service_role' THEN RAISE EXCEPTION 'EVIDENCE_CALLER_REQUIRED' USING ERRCODE='42501';END IF;
 IF TG_TABLE_NAME='driver_documents' THEN
  IF NOT OLD.is_active OR OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'EVIDENCE_HISTORY_IMMUTABLE';END IF;
  allowed:=ARRAY['workflow_version','updated_at','updated_by','is_active','deleted_at','is_verified','verified_by','verified_at'];
  IF OLD.is_verified AND (NEW.is_verified,NEW.verified_by,NEW.verified_at) IS DISTINCT FROM (OLD.is_verified,OLD.verified_by,OLD.verified_at) THEN RAISE EXCEPTION 'EVIDENCE_HISTORY_IMMUTABLE';END IF;
 ELSIF TG_TABLE_NAME='driver_cards' THEN
  IF OLD.status<>'active' OR OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'EVIDENCE_HISTORY_IMMUTABLE';END IF;
  allowed:=ARRAY['workflow_version','updated_at','updated_by','status','revoked_at','revoke_reason','reprint_count'];
  IF NEW.status NOT IN('active','revoked') OR NEW.reprint_count<OLD.reprint_count OR NEW.reprint_count>OLD.reprint_count+1 THEN RAISE EXCEPTION 'EVIDENCE_HISTORY_IMMUTABLE';END IF;
 ELSE
  IF OLD.revoked_at IS NOT NULL OR OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'EVIDENCE_HISTORY_IMMUTABLE';END IF;
  allowed:=ARRAY['workflow_version','updated_at','updated_by','revoked_at'];
 END IF;
 immutable_old:=to_jsonb(OLD)-allowed;immutable_new:=to_jsonb(NEW)-allowed;
 IF immutable_old IS DISTINCT FROM immutable_new THEN RAISE EXCEPTION 'EVIDENCE_IDENTITY_IMMUTABLE';END IF;
 NEW.workflow_version:=OLD.workflow_version+1;NEW.updated_at:=clock_timestamp();RETURN NEW;
END;$guard$;
CREATE TRIGGER evidence_history_guard BEFORE UPDATE OR DELETE ON public.driver_documents FOR EACH ROW EXECUTE FUNCTION driver_operations_private.evidence_history_guard();
CREATE TRIGGER evidence_history_guard BEFORE UPDATE OR DELETE ON public.driver_cards FOR EACH ROW EXECUTE FUNCTION driver_operations_private.evidence_history_guard();
CREATE TRIGGER evidence_history_guard BEFORE UPDATE OR DELETE ON public.driver_compliance_overrides FOR EACH ROW EXECUTE FUNCTION driver_operations_private.evidence_history_guard();
CREATE FUNCTION driver_operations_private.print_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$BEGIN RAISE EXCEPTION 'EVIDENCE_HISTORY_IMMUTABLE';END;$$;
CREATE TRIGGER evidence_print_history_guard BEFORE UPDATE OR DELETE ON public.driver_card_prints FOR EACH ROW EXECUTE FUNCTION driver_operations_private.print_history_guard();
REVOKE ALL ON FUNCTION driver_operations_private.evidence_history_guard(),driver_operations_private.print_history_guard() FROM PUBLIC,anon,authenticated,service_role;
-- The existing service/cron engine must use the same first lock as the caller
-- workflow; otherwise a stale service computation could overwrite fresh state.
CREATE OR REPLACE FUNCTION public.compute_driver_compliance(p_driver_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_driver     public.drivers%ROWTYPE;
  v_rules_text text;
  v_rules      jsonb := '{}'::jsonb;
  v_warn_days  integer := 30;
  v_req_health boolean := true;
  v_req_hdp    boolean := true;
  v_today      date := CURRENT_DATE;
  v_reqs       jsonb := '[]'::jsonb;
  v_blockers   integer := 0;
  v_missing    integer := 0;
  v_warnings   integer := 0;
  v_pending    integer := 0;
  v_level      text;
  v_score      integer;
  v_key        text;
  v_status     text;
  v_detail     text;
  v_blocker    boolean;
  v_override   boolean;
  v_doc        record;
  v_vehicle    record;
BEGIN
  SELECT * INTO v_driver FROM public.drivers
   WHERE id = p_driver_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'driver_not_found');
  END IF;

  -- Tenant-configurable rules (fall back to Saudi-market defaults).
  SELECT s.value INTO v_rules_text
    FROM public.system_settings s
   WHERE s.tenant_id = v_driver.tenant_id
     AND s.key = 'driver_compliance_rules'
     AND s.deleted_at IS NULL
   ORDER BY s.updated_at DESC
   LIMIT 1;

  BEGIN
    v_rules := COALESCE(v_rules_text::jsonb, '{}'::jsonb);
    v_warn_days  := COALESCE((v_rules->>'warn_days')::integer, 30);
    v_req_health := COALESCE((v_rules->>'require_health_certificate')::boolean, true);
    v_req_hdp    := COALESCE((v_rules->>'require_home_delivery_permit')::boolean, true);
  EXCEPTION WHEN others THEN
    v_warn_days := 30; v_req_health := true; v_req_hdp := true;
  END;

  -- ── identity (National ID / Iqama) — blocker ─────────────────────────────
  v_key := 'identity'; v_blocker := true; v_detail := NULL;
  IF v_driver.iqama_number IS NOT NULL AND btrim(v_driver.iqama_number) <> '' THEN
    IF v_driver.iqama_expiry_date IS NULL THEN
      v_status := 'valid'; v_detail := 'no_expiry_captured';
    ELSIF v_driver.iqama_expiry_date < v_today THEN
      v_status := 'expired';
    ELSIF v_driver.iqama_expiry_date <= v_today + v_warn_days THEN
      v_status := 'expiring';
    ELSE
      v_status := 'valid';
    END IF;
  ELSE
    SELECT d.expiry_date, d.is_verified INTO v_doc
      FROM public.driver_documents d
     WHERE d.driver_id = p_driver_id AND d.doc_type IN ('national_id', 'iqama')
       AND d.is_active AND d.deleted_at IS NULL
     ORDER BY d.expiry_date DESC NULLS LAST, d.created_at DESC
     LIMIT 1;
    IF NOT FOUND THEN
      v_status := 'missing';
    ELSIF NOT v_doc.is_verified THEN
      v_status := 'pending_review';
    ELSIF v_doc.expiry_date IS NOT NULL AND v_doc.expiry_date < v_today THEN
      v_status := 'expired';
    ELSIF v_doc.expiry_date IS NOT NULL AND v_doc.expiry_date <= v_today + v_warn_days THEN
      v_status := 'expiring';
    ELSE
      v_status := 'valid';
    END IF;
  END IF;
  SELECT TRUE INTO v_override FROM public.driver_compliance_overrides o
   WHERE o.driver_id = p_driver_id AND o.requirement = v_key
     AND o.revoked_at IS NULL AND o.expires_at > now() AND o.deleted_at IS NULL LIMIT 1;
  IF COALESCE(v_override, false) AND v_status IN ('missing', 'expired') THEN
    v_status := 'override_active';
  END IF;
  v_reqs := v_reqs || jsonb_build_object('key', v_key, 'status', v_status,
            'blocker', v_blocker, 'detail', v_detail, 'override', COALESCE(v_override, false));
  IF v_blocker AND v_status IN ('missing', 'expired') THEN v_blockers := v_blockers + 1;
  ELSIF v_status = 'pending_review' THEN v_pending := v_pending + 1;
  ELSIF v_status IN ('expiring', 'override_active') THEN v_warnings := v_warnings + 1;
  ELSIF v_status = 'missing' THEN v_missing := v_missing + 1; END IF;

  -- ── driving licence — blocker ────────────────────────────────────────────
  v_key := 'driving_license'; v_blocker := true; v_detail := NULL; v_override := false;
  IF v_driver.license_number IS NULL OR btrim(v_driver.license_number) = '' THEN
    v_status := 'missing';
  ELSIF v_driver.license_expiry_date IS NULL THEN
    v_status := 'valid'; v_detail := 'no_expiry_captured';
  ELSIF v_driver.license_expiry_date < v_today THEN
    v_status := 'expired';
  ELSIF v_driver.license_expiry_date <= v_today + v_warn_days THEN
    v_status := 'expiring';
  ELSE
    v_status := 'valid';
  END IF;
  SELECT TRUE INTO v_override FROM public.driver_compliance_overrides o
   WHERE o.driver_id = p_driver_id AND o.requirement = v_key
     AND o.revoked_at IS NULL AND o.expires_at > now() AND o.deleted_at IS NULL LIMIT 1;
  IF COALESCE(v_override, false) AND v_status IN ('missing', 'expired') THEN
    v_status := 'override_active';
  END IF;
  v_reqs := v_reqs || jsonb_build_object('key', v_key, 'status', v_status,
            'blocker', v_blocker, 'detail', v_detail, 'override', COALESCE(v_override, false));
  IF v_blocker AND v_status IN ('missing', 'expired') THEN v_blockers := v_blockers + 1;
  ELSIF v_status IN ('expiring', 'override_active') THEN v_warnings := v_warnings + 1; END IF;

  -- ── photo / selfie ───────────────────────────────────────────────────────
  v_key := 'photo'; v_blocker := false; v_detail := NULL;
  IF v_driver.photo_url IS NOT NULL AND btrim(v_driver.photo_url) <> '' THEN
    v_status := 'valid';
  ELSE
    v_status := 'missing'; v_missing := v_missing + 1;
  END IF;
  v_reqs := v_reqs || jsonb_build_object('key', v_key, 'status', v_status,
            'blocker', v_blocker, 'detail', v_detail, 'override', false);

  -- ── document-type requirements (health certificate, home delivery permit,
  --    Ajeer for residents) — latest active document decides ────────────────
  FOR v_key, v_blocker IN
    SELECT k, b FROM (VALUES
      ('health_certificate',   v_req_health),
      ('home_delivery_permit', v_req_hdp),
      ('ajeer_permit',         (v_driver.nationality_code IS NOT NULL
                                 AND v_driver.nationality_code <> 'SA'
                                 AND v_driver.identity_type = 'iqama'))
    ) AS r(k, b)
  LOOP
    v_detail := NULL; v_override := false;
    SELECT d.expiry_date, d.is_verified INTO v_doc
      FROM public.driver_documents d
     WHERE d.driver_id = p_driver_id AND d.doc_type = v_key::public.driver_document_type
       AND d.is_active AND d.deleted_at IS NULL
     ORDER BY d.expiry_date DESC NULLS LAST, d.created_at DESC
     LIMIT 1;
    IF NOT FOUND THEN
      IF v_blocker THEN v_status := 'missing'; ELSE v_status := 'not_required'; END IF;
    ELSIF NOT v_doc.is_verified THEN
      v_status := 'pending_review';
    ELSIF v_doc.expiry_date IS NOT NULL AND v_doc.expiry_date < v_today THEN
      v_status := 'expired';
    ELSIF v_doc.expiry_date IS NOT NULL AND v_doc.expiry_date <= v_today + v_warn_days THEN
      v_status := 'expiring';
    ELSE
      v_status := 'valid';
    END IF;
    SELECT TRUE INTO v_override FROM public.driver_compliance_overrides o
     WHERE o.driver_id = p_driver_id AND o.requirement = v_key
       AND o.revoked_at IS NULL AND o.expires_at > now() AND o.deleted_at IS NULL LIMIT 1;
    IF COALESCE(v_override, false) AND v_status IN ('missing', 'expired') THEN
      v_status := 'override_active';
    END IF;
    v_reqs := v_reqs || jsonb_build_object('key', v_key, 'status', v_status,
              'blocker', v_blocker, 'detail', v_detail, 'override', COALESCE(v_override, false));
    IF v_status = 'not_required' OR v_status = 'valid' THEN NULL;
    ELSIF v_blocker AND v_status IN ('missing', 'expired') THEN v_blockers := v_blockers + 1;
    ELSIF v_status = 'missing' THEN v_missing := v_missing + 1;
    ELSIF v_status = 'pending_review' THEN v_pending := v_pending + 1;
    ELSIF v_status IN ('expiring', 'override_active') THEN v_warnings := v_warnings + 1; END IF;
  END LOOP;

  -- ── vehicle link (only when a vehicle is assigned) — blocker ─────────────
  v_key := 'vehicle_link'; v_blocker := true; v_detail := NULL; v_override := false;
  IF v_driver.current_vehicle_id IS NULL THEN
    v_status := 'not_required';
  ELSE
    SELECT registration_expiry, insurance_expiry, status AS vehicle_status
      INTO v_vehicle
      FROM public.vehicles
     WHERE id = v_driver.current_vehicle_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      v_status := 'expired'; v_detail := 'vehicle_record_missing';
    ELSIF v_vehicle.vehicle_status IN ('retired', 'off_road') THEN
      v_status := 'expired'; v_detail := 'vehicle_' || v_vehicle.vehicle_status;
    ELSIF v_vehicle.registration_expiry IS NOT NULL AND v_vehicle.registration_expiry < v_today THEN
      v_status := 'expired'; v_detail := 'registration_expired';
    ELSIF v_vehicle.insurance_expiry IS NOT NULL AND v_vehicle.insurance_expiry < v_today THEN
      v_status := 'expired'; v_detail := 'insurance_expired';
    ELSIF (v_vehicle.registration_expiry IS NOT NULL AND v_vehicle.registration_expiry <= v_today + v_warn_days)
       OR (v_vehicle.insurance_expiry IS NOT NULL AND v_vehicle.insurance_expiry <= v_today + v_warn_days) THEN
      v_status := 'expiring';
    ELSE
      v_status := 'valid';
    END IF;
  END IF;
  v_reqs := v_reqs || jsonb_build_object('key', v_key, 'status', v_status,
            'blocker', v_blocker, 'detail', v_detail, 'override', false);
  IF v_status = 'expired' THEN v_blockers := v_blockers + 1;
  ELSIF v_status = 'expiring' THEN v_warnings := v_warnings + 1; END IF;

  -- ── employment status ────────────────────────────────────────────────────
  v_key := 'employment_status'; v_blocker := true; v_detail := NULL;
  IF v_driver.status IN ('terminated', 'blacklisted') THEN
    v_status := 'blocked'; v_blockers := v_blockers + 1;
  ELSIF v_driver.status = 'suspended' THEN
    v_status := 'suspended';
  ELSE
    v_status := 'valid';
  END IF;
  v_reqs := v_reqs || jsonb_build_object('key', v_key, 'status', v_status,
            'blocker', v_blocker, 'detail', v_detail, 'override', false);

  -- ── driver card (annual) — warning-level ─────────────────────────────────
  v_key := 'driver_card'; v_blocker := false; v_detail := NULL;
  IF v_driver.card_status = 'active' THEN
    v_status := 'valid';
  ELSIF v_driver.card_status = 'not_issued' THEN
    v_status := 'missing';
  ELSE
    v_status := 'expiring'; v_detail := 'card_' || v_driver.card_status;
  END IF;
  v_reqs := v_reqs || jsonb_build_object('key', v_key, 'status', v_status,
            'blocker', v_blocker, 'detail', v_detail, 'override', false);
  IF v_status = 'expiring' THEN v_warnings := v_warnings + 1; END IF;
  -- card 'missing' is informational: does not raise compliance level

  -- ── level + score ────────────────────────────────────────────────────────
  IF v_driver.status = 'suspended' THEN
    v_level := 'suspended';
  ELSIF v_blockers > 0 THEN
    v_level := 'critical_block';
  ELSIF v_missing > 0 THEN
    v_level := 'non_compliant';
  ELSIF v_pending > 0 THEN
    v_level := 'pending_review';
  ELSIF v_warnings > 0 THEN
    v_level := 'compliant_warnings';
  ELSE
    v_level := 'fully_compliant';
  END IF;

  v_score := GREATEST(0,
    100 - (40 * v_blockers) - (15 * v_missing) - (10 * v_pending) - (5 * v_warnings));

  UPDATE public.drivers
  SET compliance_risk_score      = (100 - v_score),
      documents_complete         = (v_missing = 0 AND v_pending = 0),
      last_compliance_review_at  = now(),
      dispatch_eligible          = (v_level IN ('fully_compliant', 'compliant_warnings')
                                    AND v_driver.status = 'active'),
      updated_at                 = now()
  WHERE id = p_driver_id;

  INSERT INTO public.driver_compliance_results
    (tenant_id, driver_id, level, score, details, triggered_by)
  VALUES
    (v_driver.tenant_id, p_driver_id, v_level, v_score,
     jsonb_build_object('level', v_level, 'score', v_score,
                        'blockers', v_blockers, 'missing', v_missing,
                        'pending', v_pending, 'warnings', v_warnings,
                        'requirements', v_reqs, 'computed_at', now()),
     auth.uid());

  RETURN jsonb_build_object(
    'level', v_level, 'score', v_score,
    'blockers', v_blockers, 'missing', v_missing,
    'pending', v_pending, 'warnings', v_warnings,
    'requirements', v_reqs);
END;
$func$;


REVOKE ALL ON FUNCTION public.compute_driver_compliance(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.compute_driver_compliance(uuid) TO service_role;
CREATE FUNCTION driver_operations_private.evidence_mutation(p_action text,p_driver_id uuid,p_driver_version integer,p_input jsonb,p_id uuid,p_expected_version integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $evidence$
DECLARE t uuid:=public.get_my_tenant_id();actor uuid:=auth.uid();d public.drivers%ROWTYPE;doc public.driver_documents%ROWTYPE;card public.driver_cards%ROWTYPE;ov public.driver_compliance_overrides%ROWTYPE;obj storage.objects%ROWTYPE;path text;mime text;bytes bigint;stamp timestamptz;summary jsonb;result_id uuid;result_version integer;serial text;result_status text;doc_kind public.driver_document_type;expiry date;reason text;v_requirement text;duration integer;old_values jsonb;new_values jsonb;permission text;allowed_keys text[];
BEGIN
 IF actor IS NULL OR t IS NULL THEN RAISE EXCEPTION 'EVIDENCE_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF p_action IS NULL OR p_action NOT IN('document_register','document_verify','document_remove','override_create','override_revoke','card_issue','card_revoke','card_print','photo_update','photo_remove','recompute') OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'EVIDENCE_INPUT' USING ERRCODE='22023';END IF;
 permission:=CASE WHEN p_action IN('document_verify','override_create','override_revoke','card_revoke') THEN 'approve' WHEN p_action='card_print' THEN 'print' ELSE 'update' END;
 IF NOT public.user_has_permission('drivers',permission) THEN RAISE EXCEPTION 'EVIDENCE_FORBIDDEN' USING ERRCODE='42501';END IF;
 allowed_keys:=CASE p_action WHEN 'document_register' THEN ARRAY['file_path','doc_type','doc_number','expiry_date','issuing_authority','file_size','mime_type'] WHEN 'photo_update' THEN ARRAY['file_path','file_size','mime_type'] WHEN 'override_create' THEN ARRAY['requirement','reason','days','attachment_url'] WHEN 'card_revoke' THEN ARRAY['reason'] WHEN 'card_print' THEN ARRAY['format','batch_ref'] ELSE ARRAY[]::text[] END;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE NOT k=ANY(allowed_keys)) OR p_driver_version IS NULL OR p_driver_version<=0 OR (p_action IN('document_verify','document_remove','override_revoke','card_revoke','card_print') AND (p_id IS NULL OR p_expected_version IS NULL OR p_expected_version<=0)) OR (p_action NOT IN('document_verify','document_remove','override_revoke','card_revoke','card_print') AND (p_id IS NOT NULL OR p_expected_version IS NOT NULL)) THEN RAISE EXCEPTION 'EVIDENCE_INPUT' USING ERRCODE='22023';END IF;
 SELECT * INTO d FROM public.drivers WHERE id=p_driver_id AND tenant_id=t AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVIDENCE_NOT_FOUND';END IF;
 stamp:=clock_timestamp();
 IF p_driver_version IS NULL OR d.profile_version<>p_driver_version THEN RAISE EXCEPTION 'EVIDENCE_STALE';END IF;
 result_id:=d.id;old_values:=jsonb_build_object('profile_version',d.profile_version);new_values:='{}';
 IF p_action IN('document_register','photo_update') THEN
  path:=p_input->>'file_path';
  IF path IS NULL OR length(path)>500 OR path NOT LIKE t::text||'/'||d.id::text||'/%' OR path LIKE '%..%' OR substring(path FROM length(t::text||'/'||d.id::text||'/')+1) !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' OR (p_action='photo_update' AND path NOT LIKE t::text||'/'||d.id::text||'/photo-%') THEN RAISE EXCEPTION 'EVIDENCE_OBJECT_REQUIRED';END IF;
  SELECT * INTO obj FROM storage.objects WHERE bucket_id=CASE WHEN p_action='photo_update' THEN 'driver-photos' ELSE 'driver-documents' END AND name=path FOR SHARE;
  IF NOT FOUND OR coalesce(obj.owner_id,obj.owner::text) IS DISTINCT FROM actor::text OR coalesce(obj.metadata->>'size','') !~ '^[0-9]{1,12}$' THEN RAISE EXCEPTION 'EVIDENCE_OBJECT_REQUIRED';END IF;
  bytes:=(obj.metadata->>'size')::bigint;mime:=lower(obj.metadata->>'mimetype');
  IF bytes<=0 OR bytes>(CASE WHEN p_action='photo_update' THEN 5242880 ELSE 20971520 END) OR mime IS NULL OR mime NOT IN('image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif','image/bmp') AND (p_action='photo_update' OR mime<>'application/pdf') THEN RAISE EXCEPTION 'EVIDENCE_OBJECT_REQUIRED';END IF;
  IF p_input?'file_size' AND (p_input->>'file_size')::bigint<>bytes OR p_input?'mime_type' AND lower(p_input->>'mime_type') IS DISTINCT FROM mime THEN RAISE EXCEPTION 'EVIDENCE_OBJECT_REQUIRED';END IF;
 END IF;
 IF p_action='document_register' THEN
  doc_kind:=(p_input->>'doc_type')::public.driver_document_type;
  IF doc_kind IS NULL OR length(coalesce(p_input->>'doc_number',''))>100 OR length(coalesce(p_input->>'issuing_authority',''))>200 THEN RAISE EXCEPTION 'EVIDENCE_INPUT';END IF;
  expiry:=nullif(p_input->>'expiry_date','')::date;
  IF (SELECT count(*) FROM public.driver_documents WHERE tenant_id=t AND driver_id=d.id AND doc_type=doc_kind AND is_active AND deleted_at IS NULL)>1 THEN RAISE EXCEPTION 'EVIDENCE_HISTORY_REVIEW';END IF;
  IF EXISTS(SELECT 1 FROM public.driver_documents WHERE tenant_id=t AND file_url=path) THEN RAISE EXCEPTION 'EVIDENCE_OBJECT_REGISTERED';END IF;
  UPDATE public.driver_documents SET is_active=false,updated_by=actor WHERE tenant_id=t AND driver_id=d.id AND doc_type=doc_kind AND is_active AND deleted_at IS NULL;
  INSERT INTO public.driver_documents(tenant_id,driver_id,doc_type,doc_number,expiry_date,issuing_authority,file_url,file_size_bytes,mime_type,created_by,updated_by) VALUES(t,d.id,doc_kind,nullif(btrim(p_input->>'doc_number'),''),expiry,nullif(btrim(p_input->>'issuing_authority'),''),path,bytes,mime,actor,actor) RETURNING id,workflow_version INTO result_id,result_version;
  new_values:=jsonb_build_object('doc_type',doc_kind,'verified',false,'has_expiry',expiry IS NOT NULL);
 ELSIF p_action IN('document_verify','document_remove') THEN
  SELECT * INTO doc FROM public.driver_documents WHERE id=p_id AND tenant_id=t AND driver_id=d.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVIDENCE_NOT_FOUND';END IF;
  IF p_expected_version IS NULL OR doc.workflow_version<>p_expected_version THEN RAISE EXCEPTION 'EVIDENCE_STALE';END IF;
  IF NOT doc.is_active OR doc.deleted_at IS NOT NULL OR (p_action='document_verify' AND doc.is_verified) THEN RAISE EXCEPTION 'EVIDENCE_NOT_CURRENT';END IF;
  IF (SELECT count(*) FROM public.driver_documents WHERE tenant_id=t AND driver_id=d.id AND doc_type=doc.doc_type AND is_active AND deleted_at IS NULL)<>1 THEN RAISE EXCEPTION 'EVIDENCE_HISTORY_REVIEW';END IF;
  IF p_action='document_verify' THEN
   IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='driver-documents' AND name=doc.file_url AND name LIKE t::text||'/'||d.id::text||'/%') THEN RAISE EXCEPTION 'EVIDENCE_OBJECT_REQUIRED';END IF;
   UPDATE public.driver_documents SET is_verified=true,verified_by=actor,verified_at=stamp,updated_by=actor WHERE id=doc.id RETURNING workflow_version INTO result_version;
  ELSE UPDATE public.driver_documents SET is_active=false,deleted_at=stamp,updated_by=actor WHERE id=doc.id RETURNING workflow_version INTO result_version;END IF;
  result_id:=doc.id;old_values:=old_values||jsonb_build_object('version',doc.workflow_version,'verified',doc.is_verified);new_values:=jsonb_build_object('doc_type',doc.doc_type,'verified',p_action='document_verify','retired',p_action='document_remove');
 ELSIF p_action='override_create' THEN
  v_requirement:=p_input->>'requirement';reason:=btrim(coalesce(p_input->>'reason',''));duration:=(p_input->>'days')::integer;
  IF v_requirement IS NULL OR v_requirement NOT IN('identity','driving_license','health_certificate','home_delivery_permit','ajeer_permit') OR length(reason) NOT BETWEEN 5 AND 500 OR duration IS NULL OR duration NOT IN(7,30,90) OR length(coalesce(p_input->>'attachment_url',''))>1000 OR nullif(p_input->>'attachment_url','') IS NOT NULL AND (p_input->>'attachment_url') !~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$' THEN RAISE EXCEPTION 'EVIDENCE_INPUT';END IF;
  IF EXISTS(SELECT 1 FROM public.driver_compliance_overrides WHERE tenant_id=t AND driver_id=d.id AND driver_compliance_overrides.requirement=v_requirement AND revoked_at IS NULL AND deleted_at IS NULL AND expires_at>stamp) THEN RAISE EXCEPTION 'EVIDENCE_ALREADY_CURRENT';END IF;
  summary:=public.compute_driver_compliance(d.id);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(summary->'requirements') req WHERE req->>'key'=v_requirement AND req->>'status' IN('missing','expired')) THEN RAISE EXCEPTION 'EVIDENCE_REVIEW_REQUIRED';END IF;
  INSERT INTO public.driver_compliance_overrides(tenant_id,driver_id,requirement,reason,attachment_url,approved_by,expires_at,created_by,updated_by) VALUES(t,d.id,v_requirement,reason,nullif(p_input->>'attachment_url',''),actor,stamp+make_interval(days=>duration),actor,actor) RETURNING id,workflow_version INTO result_id,result_version;
  new_values:=jsonb_build_object('requirement',v_requirement,'reason_recorded',true,'duration_days',duration,'has_attachment',nullif(p_input->>'attachment_url','') IS NOT NULL);
 ELSIF p_action='override_revoke' THEN
  SELECT * INTO ov FROM public.driver_compliance_overrides WHERE id=p_id AND tenant_id=t AND driver_id=d.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVIDENCE_NOT_FOUND';END IF;
  IF p_expected_version IS NULL OR ov.workflow_version<>p_expected_version THEN RAISE EXCEPTION 'EVIDENCE_STALE';END IF;
  IF ov.revoked_at IS NOT NULL OR ov.deleted_at IS NOT NULL OR ov.expires_at<=stamp THEN RAISE EXCEPTION 'EVIDENCE_NOT_CURRENT';END IF;
  UPDATE public.driver_compliance_overrides SET revoked_at=stamp,updated_by=actor WHERE id=ov.id RETURNING workflow_version INTO result_version;
  result_id:=ov.id;old_values:=old_values||jsonb_build_object('version',ov.workflow_version);new_values:=jsonb_build_object('requirement',ov.requirement,'revoked',true);
 ELSIF p_action='card_issue' THEN
  IF d.status NOT IN('active','on_leave') THEN RAISE EXCEPTION 'EVIDENCE_DRIVER_INACTIVE';END IF;
  IF EXISTS(SELECT 1 FROM public.driver_cards WHERE tenant_id=t AND driver_id=d.id AND status='active' AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>stamp)) THEN RAISE EXCEPTION 'EVIDENCE_ALREADY_CURRENT';END IF;
  serial:='EL-'||to_char(stamp AT TIME ZONE 'Asia/Riyadh','YYYY')||'-'||upper(replace(gen_random_uuid()::text,'-',''));
  INSERT INTO public.driver_cards(tenant_id,driver_id,card_serial,status,issued_at,expires_at,created_by,updated_by) VALUES(t,d.id,serial,'active',stamp,stamp+interval '365 days',actor,actor) RETURNING id,workflow_version INTO result_id,result_version;
  UPDATE public.drivers SET card_status='active',updated_by=actor WHERE id=d.id;
  result_status:='active';new_values:=jsonb_build_object('status','active');
 ELSIF p_action IN('card_revoke','card_print') THEN
  SELECT * INTO card FROM public.driver_cards WHERE id=p_id AND tenant_id=t AND driver_id=d.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVIDENCE_NOT_FOUND';END IF;
  IF p_expected_version IS NULL OR card.workflow_version<>p_expected_version THEN RAISE EXCEPTION 'EVIDENCE_STALE';END IF;
  IF card.status<>'active' OR card.deleted_at IS NOT NULL OR card.expires_at IS NOT NULL AND card.expires_at<=stamp THEN RAISE EXCEPTION 'EVIDENCE_NOT_CURRENT';END IF;
  IF (SELECT count(*) FROM public.driver_cards WHERE tenant_id=t AND driver_id=d.id AND status='active' AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>stamp))<>1 THEN RAISE EXCEPTION 'EVIDENCE_HISTORY_REVIEW';END IF;
  IF p_action='card_revoke' THEN
   reason:=btrim(coalesce(p_input->>'reason',''));IF length(reason) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'EVIDENCE_INPUT';END IF;
   UPDATE public.driver_cards SET status='revoked',revoked_at=stamp,revoke_reason=reason,updated_by=actor WHERE id=card.id RETURNING workflow_version INTO result_version;
   UPDATE public.drivers SET card_status='revoked',updated_by=actor WHERE id=d.id;
   result_status:='revoked';new_values:=jsonb_build_object('status','revoked','reason_recorded',true);
  ELSE
   IF d.status NOT IN('active','on_leave') THEN RAISE EXCEPTION 'EVIDENCE_DRIVER_INACTIVE';END IF;
   IF coalesce(p_input->>'format','') NOT IN('pvc','a4','screen') OR length(coalesce(p_input->>'batch_ref',''))>100 THEN RAISE EXCEPTION 'EVIDENCE_INPUT';END IF;
   INSERT INTO public.driver_card_prints(tenant_id,card_id,printed_by,format,batch_ref) VALUES(t,card.id,actor,p_input->>'format',nullif(btrim(p_input->>'batch_ref'),''));
   UPDATE public.driver_cards SET reprint_count=reprint_count+1,updated_by=actor WHERE id=card.id RETURNING workflow_version INTO result_version;
   result_status:='active';new_values:=jsonb_build_object('format',p_input->>'format','request_recorded',true);
  END IF;
  result_id:=card.id;serial:=card.card_serial;old_values:=old_values||jsonb_build_object('version',card.workflow_version,'status',card.status);
 ELSIF p_action='photo_update' THEN
  IF d.photo_url IS NOT DISTINCT FROM path THEN RAISE EXCEPTION 'EVIDENCE_ALREADY_CURRENT';END IF;
  UPDATE driver_operations_private.photo_records SET retired_at=stamp,retired_by=actor WHERE tenant_id=t AND driver_id=d.id AND retired_at IS NULL;
  INSERT INTO driver_operations_private.photo_records(tenant_id,driver_id,object_id,path,mime_type,size_bytes,created_by) VALUES(t,d.id,obj.id,path,mime,bytes,actor);
  UPDATE public.drivers SET photo_url=path,updated_by=actor WHERE id=d.id;
  old_values:=old_values||jsonb_build_object('had_photo',d.photo_url IS NOT NULL);new_values:=jsonb_build_object('has_photo',true);
 ELSIF p_action='photo_remove' THEN
  IF d.photo_url IS NULL THEN RAISE EXCEPTION 'EVIDENCE_NOT_CURRENT';END IF;
  UPDATE driver_operations_private.photo_records SET retired_at=stamp,retired_by=actor WHERE tenant_id=t AND driver_id=d.id AND retired_at IS NULL;
  UPDATE public.drivers SET photo_url=NULL,updated_by=actor WHERE id=d.id;
  old_values:=old_values||jsonb_build_object('had_photo',true);new_values:=jsonb_build_object('has_photo',false);
 END IF;
 summary:=public.compute_driver_compliance(d.id);
 IF summary?'error' THEN RAISE EXCEPTION 'EVIDENCE_COMPUTE_FAILED';END IF;
 SELECT profile_version INTO p_driver_version FROM public.drivers WHERE id=d.id;
 new_values:=new_values||jsonb_build_object('driver_id',d.id,'profile_version',p_driver_version,'version',result_version);
 INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,old_values,new_values) VALUES(t,actor,'drivers','driver_evidence',result_id,p_action||CASE WHEN p_action='card_print' THEN '_requested' ELSE '' END,old_values,new_values);
 RETURN jsonb_build_object('id',result_id,'driver_id',d.id,'profile_version',p_driver_version,'version',result_version,'serial',serial,'status',result_status,'summary',summary-'requirements');
END;$evidence$;
CREATE FUNCTION public.mutate_driver_evidence(p_action text,p_driver_id uuid,p_driver_version integer,p_input jsonb DEFAULT '{}',p_id uuid DEFAULT NULL,p_expected_version integer DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT driver_operations_private.evidence_mutation(p_action,p_driver_id,p_driver_version,p_input,p_id,p_expected_version);$$;
REVOKE ALL ON FUNCTION driver_operations_private.evidence_mutation(text,uuid,integer,jsonb,uuid,integer),public.mutate_driver_evidence(text,uuid,integer,jsonb,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION driver_operations_private.evidence_mutation(text,uuid,integer,jsonb,uuid,integer),public.mutate_driver_evidence(text,uuid,integer,jsonb,uuid,integer) TO authenticated;
COMMIT;
