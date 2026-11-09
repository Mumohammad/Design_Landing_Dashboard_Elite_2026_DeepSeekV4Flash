-- Drivers module finalization (1/3):
--  * Traffic fines import with automatic vehicle -> driver matching. A fine is
--    attributed to whoever held the vehicle (vehicle_assignments) on the
--    violation date. Rows land in external_fine_imports (existing table).
--  * Platform rider card print log (HungerStation/Keeta/... cards are not
--    driver_cards rows, so they get their own append-only log).
BEGIN;

-- Saudi plates mix Arabic and Latin letters; normalise both to Latin letters
-- + Western digits so "أ ب ح ١٢٣٤", "ABJ 1234" and "1234-ABJ" all compare equal.
CREATE OR REPLACE FUNCTION driver_operations_private.normalize_plate(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH s AS (
    SELECT upper(translate(coalesce(p, ''),
      '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹أابحدرسصطعقكلمنهوىي',
      '01234567890123456789AABJDRSXTEGKLZNHUVV')) AS v
  )
  SELECT nullif(
    regexp_replace(v, '[^0-9]', '', 'g') || '-' || regexp_replace(v, '[^A-Z]', '', 'g'),
    '-')
  FROM s;
$$;
REVOKE ALL ON FUNCTION driver_operations_private.normalize_plate(text) FROM PUBLIC, anon, authenticated;

-- Match one fine: vehicle by normalised plate (letters in either order), then
-- the driver whose assignment covers the violation date.
CREATE OR REPLACE FUNCTION driver_operations_private.match_fine(p_tenant uuid, p_plate text, p_date date)
RETURNS TABLE (vehicle_id uuid, driver_id uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_norm text := driver_operations_private.normalize_plate(p_plate);
  v_digits text := split_part(v_norm, '-', 1);
  v_letters text := split_part(v_norm, '-', 2);
  v_vehicle uuid;
  v_driver uuid;
BEGIN
  IF v_norm IS NULL OR v_digits = '' THEN RETURN; END IF;
  SELECT v.id INTO v_vehicle FROM public.vehicles v
   WHERE v.tenant_id = p_tenant AND v.deleted_at IS NULL
     AND split_part(driver_operations_private.normalize_plate(v.plate_number), '-', 1) = v_digits
     AND split_part(driver_operations_private.normalize_plate(v.plate_number), '-', 2) IN (v_letters, reverse(v_letters))
   ORDER BY v.created_at LIMIT 1;
  IF v_vehicle IS NULL THEN RETURN; END IF;
  IF p_date IS NOT NULL THEN
    SELECT a.driver_id INTO v_driver FROM public.vehicle_assignments a
     WHERE a.vehicle_id = v_vehicle AND a.deleted_at IS NULL
       AND (a.assigned_at AT TIME ZONE 'Asia/Riyadh')::date <= p_date
       AND (a.unassigned_at IS NULL OR (a.unassigned_at AT TIME ZONE 'Asia/Riyadh')::date >= p_date)
     ORDER BY a.assigned_at DESC LIMIT 1;
  END IF;
  vehicle_id := v_vehicle; driver_id := v_driver;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION driver_operations_private.match_fine(uuid, text, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.import_external_fines(p_rows jsonb, p_source text DEFAULT 'manual', p_batch_ref text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t uuid := public.get_my_tenant_id();
  actor uuid := auth.uid();
  r jsonb;
  v_ref text; v_plate text; v_date date; v_amount numeric; v_deadline date;
  v_vehicle uuid; v_driver uuid; v_id uuid;
  n_in int := 0; n_matched int := 0; n_vehicle_only int := 0; n_unmatched int := 0; n_dup int := 0;
BEGIN
  IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('violations', 'create') THEN
    RAISE EXCEPTION 'AUTH007: violations permission required';
  END IF;
  IF p_source NOT IN ('manual', 'najm', 'moi', 'absher') THEN RAISE EXCEPTION 'FIN001: invalid source'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 1000 THEN
    RAISE EXCEPTION 'FIN002: provide up to 1000 rows';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_ref := nullif(btrim(r->>'external_ref'), '');
    v_plate := nullif(btrim(r->>'vehicle_plate'), '');
    IF v_ref IS NULL OR length(v_ref) > 100 THEN RAISE EXCEPTION 'FIN003: every row needs a fine reference'; END IF;
    BEGIN v_date := nullif(r->>'violation_date', '')::date; EXCEPTION WHEN others THEN RAISE EXCEPTION 'FIN004: invalid date for %', v_ref; END;
    BEGIN v_deadline := nullif(r->>'payment_deadline', '')::date; EXCEPTION WHEN others THEN v_deadline := NULL; END;
    BEGIN v_amount := nullif(r->>'fine_amount', '')::numeric; EXCEPTION WHEN others THEN RAISE EXCEPTION 'FIN005: invalid amount for %', v_ref; END;
    IF v_amount IS NOT NULL AND v_amount < 0 THEN RAISE EXCEPTION 'FIN005: invalid amount for %', v_ref; END IF;
    v_vehicle := NULL; v_driver := NULL;
    SELECT m.vehicle_id, m.driver_id INTO v_vehicle, v_driver FROM driver_operations_private.match_fine(t, v_plate, v_date) m;
    INSERT INTO public.external_fine_imports (tenant_id, created_by, source, source_batch_ref, external_ref, external_source,
      vehicle_plate, violation_date, violation_location, violation_type_code, fine_amount, payment_deadline, raw_data,
      matched_vehicle_id, matched_driver_id, status, match_notes, matched_at)
    VALUES (t, actor, p_source, left(p_batch_ref, 100), v_ref, left(nullif(btrim(r->>'external_source'), ''), 100),
      left(v_plate, 40), v_date, left(nullif(btrim(r->>'violation_location'), ''), 300), left(nullif(btrim(r->>'violation_type_code'), ''), 100),
      round(v_amount, 2), v_deadline, r,
      v_vehicle, v_driver,
      CASE WHEN v_driver IS NOT NULL THEN 'matched' ELSE 'unmatched' END::public.external_fine_status,
      CASE WHEN v_driver IS NOT NULL THEN 'auto: assignment on violation date'
           WHEN v_vehicle IS NOT NULL THEN 'auto: vehicle found, no driver assigned on that date'
           ELSE 'auto: no vehicle with this plate' END,
      CASE WHEN v_driver IS NOT NULL THEN now() END)
    ON CONFLICT (tenant_id, external_ref, source) DO NOTHING
    RETURNING id INTO v_id;
    n_in := n_in + 1;
    IF v_id IS NULL THEN n_dup := n_dup + 1;
    ELSIF v_driver IS NOT NULL THEN n_matched := n_matched + 1;
    ELSIF v_vehicle IS NOT NULL THEN n_vehicle_only := n_vehicle_only + 1;
    ELSE n_unmatched := n_unmatched + 1; END IF;
    v_id := NULL;
  END LOOP;
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, entity_id, action, new_values)
  VALUES (t, actor, 'violations', 'external_fine_imports', NULL, 'import',
          jsonb_build_object('rows', n_in, 'matched', n_matched, 'vehicle_only', n_vehicle_only, 'unmatched', n_unmatched, 'duplicates', n_dup, 'batch', p_batch_ref));
  RETURN jsonb_build_object('rows', n_in, 'matched', n_matched, 'vehicle_only', n_vehicle_only, 'unmatched', n_unmatched, 'duplicates', n_dup);
END;
$$;
REVOKE ALL ON FUNCTION public.import_external_fines(jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_external_fines(jsonb, text, text) TO authenticated;

-- Re-run matching for still-unmatched fines (after vehicles/assignments are fixed).
CREATE OR REPLACE FUNCTION public.rematch_external_fines()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t uuid := public.get_my_tenant_id();
  actor uuid := auth.uid();
  f record; v_vehicle uuid; v_driver uuid; n int := 0;
BEGIN
  IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('violations', 'update') THEN
    RAISE EXCEPTION 'AUTH007: violations permission required';
  END IF;
  FOR f IN SELECT id, vehicle_plate, violation_date FROM public.external_fine_imports
            WHERE tenant_id = t AND status = 'unmatched' FOR UPDATE LOOP
    v_vehicle := NULL; v_driver := NULL;
    SELECT m.vehicle_id, m.driver_id INTO v_vehicle, v_driver FROM driver_operations_private.match_fine(t, f.vehicle_plate, f.violation_date) m;
    IF v_vehicle IS NOT NULL THEN
      UPDATE public.external_fine_imports SET matched_vehicle_id = v_vehicle, matched_driver_id = v_driver,
        status = CASE WHEN v_driver IS NOT NULL THEN 'matched' ELSE 'unmatched' END::public.external_fine_status,
        match_notes = CASE WHEN v_driver IS NOT NULL THEN 'auto: assignment on violation date' ELSE 'auto: vehicle found, no driver assigned on that date' END,
        matched_at = CASE WHEN v_driver IS NOT NULL THEN now() END, matched_by = CASE WHEN v_driver IS NOT NULL THEN actor END
       WHERE id = f.id;
      IF v_driver IS NOT NULL THEN n := n + 1; END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('matched', n);
END;
$$;
REVOKE ALL ON FUNCTION public.rematch_external_fines() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rematch_external_fines() TO authenticated;

-- Manual resolution: assign a driver, ignore, mark duplicate, or link the
-- violation created from the fine.
CREATE OR REPLACE FUNCTION public.resolve_external_fine(p_id uuid, p_action text, p_driver_id uuid DEFAULT NULL, p_violation_id uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t uuid := public.get_my_tenant_id();
  actor uuid := auth.uid();
  v_old public.external_fine_imports;
  v_row public.external_fine_imports;
BEGIN
  IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('violations', 'update') THEN
    RAISE EXCEPTION 'AUTH007: violations permission required';
  END IF;
  SELECT * INTO v_old FROM public.external_fine_imports WHERE id = p_id AND tenant_id = t FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'FIN010: fine not found'; END IF;
  IF v_old.status = 'violation_created' THEN RAISE EXCEPTION 'FIN011: a violation was already created for this fine'; END IF;
  IF p_action = 'assign' THEN
    IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id AND tenant_id = t AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'FIN012: active tenant driver required';
    END IF;
    UPDATE public.external_fine_imports SET matched_driver_id = p_driver_id, status = 'matched', matched_by = actor, matched_at = now(),
      match_notes = left(coalesce(nullif(btrim(p_note), ''), 'manual assignment'), 500) WHERE id = p_id RETURNING * INTO v_row;
  ELSIF p_action IN ('ignore', 'duplicate') THEN
    UPDATE public.external_fine_imports SET status = (CASE WHEN p_action = 'ignore' THEN 'ignored' ELSE 'duplicate' END)::public.external_fine_status,
      matched_by = actor, match_notes = left(coalesce(nullif(btrim(p_note), ''), p_action), 500) WHERE id = p_id RETURNING * INTO v_row;
  ELSIF p_action = 'reopen' THEN
    UPDATE public.external_fine_imports SET status = CASE WHEN matched_driver_id IS NOT NULL THEN 'matched' ELSE 'unmatched' END::public.external_fine_status,
      match_notes = 'reopened' WHERE id = p_id RETURNING * INTO v_row;
  ELSIF p_action = 'link_violation' THEN
    IF NOT EXISTS (SELECT 1 FROM public.violations WHERE id = p_violation_id AND tenant_id = t AND deleted_at IS NULL
                    AND driver_id IS NOT DISTINCT FROM v_old.matched_driver_id) THEN
      RAISE EXCEPTION 'FIN013: violation must belong to the matched driver';
    END IF;
    UPDATE public.external_fine_imports SET violation_id = p_violation_id, status = 'violation_created', matched_by = actor
     WHERE id = p_id RETURNING * INTO v_row;
    UPDATE public.violations SET vehicle_id = coalesce(vehicle_id, v_old.matched_vehicle_id), external_fine_id = p_id WHERE id = p_violation_id;
  ELSE
    RAISE EXCEPTION 'FIN014: unknown action';
  END IF;
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, entity_id, action, old_values, new_values)
  VALUES (t, actor, 'violations', 'external_fine_imports', p_id, p_action, to_jsonb(v_old), to_jsonb(v_row));
  RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status);
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_external_fine(uuid, text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_external_fine(uuid, text, uuid, uuid, text) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_external_fines_driver ON public.external_fine_imports (tenant_id, matched_driver_id, violation_date DESC);

-- ═══ Platform card print log ═══
CREATE TABLE IF NOT EXISTS public.driver_platform_card_prints (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants (id),
  driver_id     uuid NOT NULL REFERENCES public.drivers (id),
  platform_code text NOT NULL CHECK (platform_code ~ '^[a-z][a-z0-9_]{1,39}$'),
  rider_id      text CHECK (rider_id IS NULL OR length(rider_id) <= 64),
  format        text NOT NULL CHECK (format IN ('pvc', 'a4', 'pdf', 'png', 'print')),
  printed_by    uuid,
  printed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_driver_platform_card_prints_driver ON public.driver_platform_card_prints (driver_id, printed_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_platform_card_prints_tenant ON public.driver_platform_card_prints (tenant_id, printed_at DESC);
ALTER TABLE public.driver_platform_card_prints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_platform_card_prints FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.driver_platform_card_prints TO authenticated;
DROP POLICY IF EXISTS driver_platform_card_prints_sel ON public.driver_platform_card_prints;
CREATE POLICY driver_platform_card_prints_sel ON public.driver_platform_card_prints
  FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id() AND public.user_has_permission('drivers', 'read'));

CREATE OR REPLACE FUNCTION public.record_driver_platform_card_prints(p_driver_id uuid, p_cards jsonb, p_format text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t uuid := public.get_my_tenant_id();
  actor uuid := auth.uid();
  c jsonb; n int := 0;
BEGIN
  IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('drivers', 'read') THEN
    RAISE EXCEPTION 'AUTH007: driver permission required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id AND tenant_id = t AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'DPA001: active tenant driver required';
  END IF;
  IF p_format NOT IN ('pvc', 'a4', 'pdf', 'png', 'print') THEN RAISE EXCEPTION 'DPC001: invalid format'; END IF;
  IF jsonb_typeof(p_cards) <> 'array' OR jsonb_array_length(p_cards) > 30 THEN RAISE EXCEPTION 'DPC002: invalid cards'; END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(p_cards) LOOP
    INSERT INTO public.driver_platform_card_prints (tenant_id, driver_id, platform_code, rider_id, format, printed_by)
    VALUES (t, p_driver_id, lower(btrim(c->>'platform_code')), left(nullif(btrim(c->>'rider_id'), ''), 64), p_format, actor);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.record_driver_platform_card_prints(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_driver_platform_card_prints(uuid, jsonb, text) TO authenticated;

COMMIT;
