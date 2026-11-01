-- Drivers module finalization (3/3):
--  * Driver self-service portal: tokenised, expiring links (only a SHA-256 hash
--    is stored). The public portal is served by server code with the service
--    role after resolving the hash; drivers can view their cards/documents and
--    submit renewals, which staff review before they enter the vault.
--  * Government checks register: manual Muqeem / Absher / GOSI / Qiwa / traffic
--    verifications with reference, result and next due date (append-only).
BEGIN;

-- ═══ Portal links ═══
CREATE TABLE IF NOT EXISTS public.driver_portal_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants (id),
  driver_id    uuid NOT NULL REFERENCES public.drivers (id),
  token_hash   text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  use_count    integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid
);
CREATE INDEX IF NOT EXISTS idx_driver_portal_links_driver ON public.driver_portal_links (driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_portal_links_tenant ON public.driver_portal_links (tenant_id);
ALTER TABLE public.driver_portal_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_portal_links FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, tenant_id, driver_id, expires_at, revoked_at, last_used_at, use_count, created_at, created_by) ON public.driver_portal_links TO authenticated;
GRANT ALL ON public.driver_portal_links TO service_role;
DROP POLICY IF EXISTS driver_portal_links_sel ON public.driver_portal_links;
CREATE POLICY driver_portal_links_sel ON public.driver_portal_links FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.user_has_permission('drivers', 'read'));

CREATE OR REPLACE FUNCTION public.issue_driver_portal_link(p_driver_id uuid, p_token_hash text, p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t uuid := public.get_my_tenant_id();
  actor uuid := auth.uid();
  n public.driver_portal_links;
BEGIN
  IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('drivers', 'update') THEN
    RAISE EXCEPTION 'AUTH007: driver permission required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id AND tenant_id = t AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'DPA001: active tenant driver required';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'DPL001: invalid token'; END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 90 THEN RAISE EXCEPTION 'DPL002: link validity must be 1-90 days'; END IF;
  UPDATE public.driver_portal_links SET revoked_at = now() WHERE driver_id = p_driver_id AND tenant_id = t AND revoked_at IS NULL;
  INSERT INTO public.driver_portal_links (tenant_id, driver_id, token_hash, expires_at, created_by)
  VALUES (t, p_driver_id, p_token_hash, now() + make_interval(days => p_days), actor) RETURNING * INTO n;
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, entity_id, action, new_values)
  VALUES (t, actor, 'drivers', 'driver_portal_link', n.id, 'portal_link_issued', jsonb_build_object('driver_id', p_driver_id, 'expires_at', n.expires_at));
  RETURN jsonb_build_object('id', n.id, 'expires_at', n.expires_at);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_driver_portal_link(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_driver_portal_link(uuid, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_driver_portal_links(p_driver_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t uuid := public.get_my_tenant_id();
  actor uuid := auth.uid();
  c integer;
BEGIN
  IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('drivers', 'update') THEN
    RAISE EXCEPTION 'AUTH007: driver permission required';
  END IF;
  UPDATE public.driver_portal_links SET revoked_at = now() WHERE driver_id = p_driver_id AND tenant_id = t AND revoked_at IS NULL;
  GET DIAGNOSTICS c = ROW_COUNT;
  IF c > 0 THEN
    INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, entity_id, action, new_values)
    VALUES (t, actor, 'drivers', 'driver_portal_link', p_driver_id, 'portal_link_revoked', jsonb_build_object('count', c));
  END IF;
  RETURN c;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_driver_portal_links(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_driver_portal_links(uuid) TO authenticated;

-- ═══ Portal submissions (renewals uploaded by the driver) ═══
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('driver-portal-uploads', 'driver-portal-uploads', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS storage_driver_portal_uploads_read ON storage.objects;
CREATE POLICY storage_driver_portal_uploads_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'driver-portal-uploads' AND public.storage_path_in_current_tenant(name) AND public.user_has_permission('drivers', 'read'));

CREATE TABLE IF NOT EXISTS public.driver_portal_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants (id),
  driver_id    uuid NOT NULL REFERENCES public.drivers (id),
  link_id      uuid REFERENCES public.driver_portal_links (id),
  doc_type     text NOT NULL CHECK (doc_type ~ '^[a-z_]{2,40}$'),
  doc_number   text CHECK (doc_number IS NULL OR length(doc_number) <= 100),
  expiry_date  date,
  file_path    text NOT NULL CHECK (length(file_path) <= 300),
  mime_type    text NOT NULL,
  file_size    integer NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  driver_note  text CHECK (driver_note IS NULL OR length(driver_note) <= 500),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  review_note  text CHECK (review_note IS NULL OR length(review_note) <= 500),
  document_id  uuid,
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_driver_portal_submissions_driver ON public.driver_portal_submissions (driver_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_portal_submissions_tenant ON public.driver_portal_submissions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_driver_portal_submissions_link ON public.driver_portal_submissions (link_id);
ALTER TABLE public.driver_portal_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_portal_submissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.driver_portal_submissions TO authenticated;
GRANT ALL ON public.driver_portal_submissions TO service_role;
DROP POLICY IF EXISTS driver_portal_submissions_sel ON public.driver_portal_submissions;
CREATE POLICY driver_portal_submissions_sel ON public.driver_portal_submissions FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.user_has_permission('drivers', 'read'));

CREATE OR REPLACE FUNCTION public.review_driver_portal_submission(p_id uuid, p_action text, p_note text DEFAULT NULL, p_document_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t uuid := public.get_my_tenant_id();
  actor uuid := auth.uid();
  s public.driver_portal_submissions;
BEGIN
  IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('drivers', 'update') THEN
    RAISE EXCEPTION 'AUTH007: driver permission required';
  END IF;
  SELECT * INTO s FROM public.driver_portal_submissions WHERE id = p_id AND tenant_id = t FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'DPS001: submission not found'; END IF;
  IF s.status <> 'pending' THEN RAISE EXCEPTION 'DPS002: submission already reviewed'; END IF;
  IF p_action = 'accept' THEN
    IF p_document_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.driver_documents WHERE id = p_document_id AND tenant_id = t AND driver_id = s.driver_id) THEN
      RAISE EXCEPTION 'DPS003: register the document in the vault first';
    END IF;
    UPDATE public.driver_portal_submissions SET status = 'accepted', document_id = p_document_id, review_note = left(nullif(btrim(p_note), ''), 500), reviewed_by = actor, reviewed_at = now()
    WHERE id = s.id RETURNING * INTO s;
  ELSIF p_action = 'reject' THEN
    UPDATE public.driver_portal_submissions SET status = 'rejected', review_note = left(nullif(btrim(p_note), ''), 500), reviewed_by = actor, reviewed_at = now()
    WHERE id = s.id RETURNING * INTO s;
  ELSE
    RAISE EXCEPTION 'DPS009: unknown action';
  END IF;
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, entity_id, action, new_values)
  VALUES (t, actor, 'drivers', 'driver_portal_submission', s.id, 'portal_submission_' || p_action, to_jsonb(s));
  RETURN to_jsonb(s);
END;
$$;
REVOKE ALL ON FUNCTION public.review_driver_portal_submission(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_driver_portal_submission(uuid, text, text, uuid) TO authenticated;

-- ═══ Government checks register ═══
CREATE TABLE IF NOT EXISTS public.driver_government_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants (id),
  driver_id    uuid NOT NULL REFERENCES public.drivers (id),
  check_type   text NOT NULL CHECK (check_type IN ('muqeem', 'absher', 'gosi', 'qiwa', 'traffic', 'mudad')),
  result       text NOT NULL CHECK (result IN ('ok', 'issue', 'pending')),
  reference    text CHECK (reference IS NULL OR length(reference) <= 100),
  notes        text CHECK (notes IS NULL OR length(notes) <= 1000),
  checked_on   date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Riyadh')::date),
  next_due_on  date,
  checked_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_driver_government_checks_driver ON public.driver_government_checks (driver_id, check_type, checked_on DESC);
CREATE INDEX IF NOT EXISTS idx_driver_government_checks_tenant ON public.driver_government_checks (tenant_id, next_due_on);
ALTER TABLE public.driver_government_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_government_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.driver_government_checks TO authenticated;
DROP POLICY IF EXISTS driver_government_checks_sel ON public.driver_government_checks;
CREATE POLICY driver_government_checks_sel ON public.driver_government_checks FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.user_has_permission('drivers', 'read'));

CREATE OR REPLACE FUNCTION public.record_driver_government_check(
  p_driver_id uuid, p_check_type text, p_result text, p_reference text DEFAULT NULL, p_notes text DEFAULT NULL,
  p_checked_on date DEFAULT NULL, p_next_due_on date DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t uuid := public.get_my_tenant_id();
  actor uuid := auth.uid();
  n public.driver_government_checks;
  d date := coalesce(p_checked_on, (now() AT TIME ZONE 'Asia/Riyadh')::date);
BEGIN
  IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('drivers', 'update') THEN
    RAISE EXCEPTION 'AUTH007: driver permission required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id AND tenant_id = t AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'DPA001: active tenant driver required';
  END IF;
  IF d > (now() AT TIME ZONE 'Asia/Riyadh')::date THEN RAISE EXCEPTION 'GOV001: check date cannot be in the future'; END IF;
  IF p_next_due_on IS NOT NULL AND p_next_due_on < d THEN RAISE EXCEPTION 'GOV002: next due date must be after the check date'; END IF;
  INSERT INTO public.driver_government_checks (tenant_id, driver_id, check_type, result, reference, notes, checked_on, next_due_on, checked_by)
  VALUES (t, p_driver_id, p_check_type, p_result, left(nullif(btrim(p_reference), ''), 100), left(nullif(btrim(p_notes), ''), 1000), d, p_next_due_on, actor)
  RETURNING * INTO n;
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, entity_id, action, new_values)
  VALUES (t, actor, 'drivers', 'driver_government_check', n.id, 'government_check_recorded', to_jsonb(n));
  RETURN to_jsonb(n);
END;
$$;
REVOKE ALL ON FUNCTION public.record_driver_government_check(uuid, text, text, text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_driver_government_check(uuid, text, text, text, text, date, date) TO authenticated;

COMMIT;
