-- Driver platform accounts: one rider ID per delivery platform (HungerStation,
-- Keeta, Jahez, Mrsool, ...). The primary account mirrors into drivers.rider_id
-- so the payroll engine (which joins on rider_id) keeps working unchanged.
-- Writes go through SECURITY DEFINER RPCs only; clients can read their tenant.
BEGIN;

CREATE TABLE IF NOT EXISTS public.driver_platform_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants (id),
  driver_id          uuid NOT NULL REFERENCES public.drivers (id),
  platform_code      text NOT NULL CHECK (platform_code ~ '^[a-z][a-z0-9_]{1,39}$'),
  platform_driver_id text NOT NULL CHECK (platform_driver_id ~ '^[A-Za-z0-9._/-]{1,64}$'),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'inactive')),
  is_primary         boolean NOT NULL DEFAULT false,
  notes              text CHECK (notes IS NULL OR length(notes) <= 500),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid,
  deleted_at         timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_driver_platform_accounts_driver_platform
  ON public.driver_platform_accounts (driver_id, platform_code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_driver_platform_accounts_rider
  ON public.driver_platform_accounts (tenant_id, platform_code, platform_driver_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_driver_platform_accounts_primary
  ON public.driver_platform_accounts (driver_id) WHERE is_primary AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_driver_platform_accounts_tenant
  ON public.driver_platform_accounts (tenant_id, platform_code) WHERE deleted_at IS NULL;

ALTER TABLE public.driver_platform_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_platform_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.driver_platform_accounts TO authenticated;
DROP POLICY IF EXISTS driver_platform_accounts_tenant_sel ON public.driver_platform_accounts;
CREATE POLICY driver_platform_accounts_tenant_sel ON public.driver_platform_accounts
  FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id() AND deleted_at IS NULL);

COMMENT ON TABLE public.driver_platform_accounts IS
  'Per-platform rider IDs for a driver (one per platform). The primary account mirrors into drivers.rider_id.';

-- Keep drivers.rider_id equal to the primary account (or clear it when the
-- previous primary ID is removed).
CREATE OR REPLACE FUNCTION driver_operations_private.sync_driver_rider_id(p_driver uuid, p_previous text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_primary text;
BEGIN
  SELECT platform_driver_id INTO v_primary FROM public.driver_platform_accounts
   WHERE driver_id = p_driver AND is_primary AND deleted_at IS NULL;
  IF v_primary IS NOT NULL THEN
    UPDATE public.drivers SET rider_id = v_primary WHERE id = p_driver AND rider_id IS DISTINCT FROM v_primary;
  ELSIF p_previous IS NOT NULL THEN
    UPDATE public.drivers SET rider_id = NULL WHERE id = p_driver AND rider_id = p_previous;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION driver_operations_private.sync_driver_rider_id(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_driver_platform_account(
  p_driver_id uuid,
  p_platform_code text,
  p_platform_driver_id text,
  p_status text DEFAULT 'active',
  p_is_primary boolean DEFAULT false,
  p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t uuid := public.get_my_tenant_id();
  actor uuid := auth.uid();
  v_code text := lower(btrim(coalesce(p_platform_code, '')));
  v_rider text := btrim(coalesce(p_platform_driver_id, ''));
  v_status text := coalesce(nullif(btrim(p_status), ''), 'active');
  v_old public.driver_platform_accounts;
  v_row public.driver_platform_accounts;
  v_prev_primary text;
  v_make_primary boolean;
BEGIN
  IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('drivers', 'update') THEN
    RAISE EXCEPTION 'AUTH007: driver permission required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id AND tenant_id = t AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'DPA001: active tenant driver required';
  END IF;
  IF v_code !~ '^[a-z][a-z0-9_]{1,39}$' THEN RAISE EXCEPTION 'DPA002: invalid platform'; END IF;
  IF v_rider !~ '^[A-Za-z0-9._/-]{1,64}$' THEN RAISE EXCEPTION 'DPA003: invalid platform rider ID'; END IF;
  IF v_status NOT IN ('active', 'suspended', 'inactive') THEN RAISE EXCEPTION 'DPA004: invalid status'; END IF;
  IF p_notes IS NOT NULL AND length(p_notes) > 500 THEN RAISE EXCEPTION 'DPA005: notes too long'; END IF;
  IF EXISTS (SELECT 1 FROM public.driver_platform_accounts
              WHERE tenant_id = t AND platform_code = v_code AND platform_driver_id = v_rider
                AND driver_id <> p_driver_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'DPA006: this rider ID is already linked to another driver';
  END IF;

  PERFORM 1 FROM public.drivers WHERE id = p_driver_id FOR UPDATE;
  SELECT platform_driver_id INTO v_prev_primary FROM public.driver_platform_accounts
   WHERE driver_id = p_driver_id AND is_primary AND deleted_at IS NULL;
  SELECT * INTO v_old FROM public.driver_platform_accounts
   WHERE driver_id = p_driver_id AND platform_code = v_code AND deleted_at IS NULL FOR UPDATE;
  -- First account becomes primary automatically.
  v_make_primary := coalesce(p_is_primary, false) OR v_prev_primary IS NULL OR coalesce(v_old.is_primary, false);
  IF v_make_primary THEN
    UPDATE public.driver_platform_accounts SET is_primary = false, updated_at = now(), updated_by = actor
     WHERE driver_id = p_driver_id AND is_primary AND deleted_at IS NULL AND platform_code <> v_code;
  END IF;

  IF v_old.id IS NULL THEN
    INSERT INTO public.driver_platform_accounts (tenant_id, driver_id, platform_code, platform_driver_id, status, is_primary, notes, created_by, updated_by)
    VALUES (t, p_driver_id, v_code, v_rider, v_status, v_make_primary, nullif(btrim(coalesce(p_notes, '')), ''), actor, actor)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.driver_platform_accounts
       SET platform_driver_id = v_rider, status = v_status, is_primary = v_make_primary,
           notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now(), updated_by = actor
     WHERE id = v_old.id RETURNING * INTO v_row;
  END IF;

  PERFORM driver_operations_private.sync_driver_rider_id(p_driver_id, v_prev_primary);
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, entity_id, action, old_values, new_values)
  VALUES (t, actor, 'drivers', 'driver_platform_accounts', v_row.id, CASE WHEN v_old.id IS NULL THEN 'create' ELSE 'update' END,
          CASE WHEN v_old.id IS NULL THEN NULL ELSE to_jsonb(v_old) END, to_jsonb(v_row));
  RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.save_driver_platform_account(uuid, text, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_driver_platform_account(uuid, text, text, text, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_driver_platform_account(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t uuid := public.get_my_tenant_id();
  actor uuid := auth.uid();
  v_old public.driver_platform_accounts;
  v_next uuid;
BEGIN
  IF actor IS NULL OR t IS NULL OR NOT public.user_has_permission('drivers', 'update') THEN
    RAISE EXCEPTION 'AUTH007: driver permission required';
  END IF;
  SELECT * INTO v_old FROM public.driver_platform_accounts WHERE id = p_id AND tenant_id = t AND deleted_at IS NULL FOR UPDATE;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'DPA007: platform account not found'; END IF;
  PERFORM 1 FROM public.drivers WHERE id = v_old.driver_id FOR UPDATE;
  UPDATE public.driver_platform_accounts SET deleted_at = now(), is_primary = false, updated_at = now(), updated_by = actor WHERE id = p_id;
  IF v_old.is_primary THEN
    SELECT id INTO v_next FROM public.driver_platform_accounts
     WHERE driver_id = v_old.driver_id AND deleted_at IS NULL
     ORDER BY (status = 'active') DESC, created_at, id LIMIT 1;
    IF v_next IS NOT NULL THEN
      UPDATE public.driver_platform_accounts SET is_primary = true, updated_at = now(), updated_by = actor WHERE id = v_next;
    END IF;
    PERFORM driver_operations_private.sync_driver_rider_id(v_old.driver_id, v_old.platform_driver_id);
  END IF;
  INSERT INTO public.audit_log (tenant_id, actor_id, module, entity_type, entity_id, action, old_values)
  VALUES (t, actor, 'drivers', 'driver_platform_accounts', p_id, 'delete', to_jsonb(v_old));
  RETURN jsonb_build_object('id', p_id, 'next_primary_id', v_next);
END;
$$;
REVOKE ALL ON FUNCTION public.remove_driver_platform_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_driver_platform_account(uuid) TO authenticated;

-- Backfill: existing single rider IDs become the primary platform account.
INSERT INTO public.driver_platform_accounts (tenant_id, driver_id, platform_code, platform_driver_id, is_primary)
SELECT d.tenant_id, d.id, coalesce(lower(p.code), 'hungerstation'), btrim(d.rider_id), true
  FROM public.drivers d
  LEFT JOIN public.delivery_platforms p ON p.id = d.primary_platform_id
 WHERE d.deleted_at IS NULL AND btrim(coalesce(d.rider_id, '')) ~ '^[A-Za-z0-9._/-]{1,64}$'
   AND coalesce(lower(p.code), 'hungerstation') ~ '^[a-z][a-z0-9_]{1,39}$'
   AND NOT EXISTS (SELECT 1 FROM public.driver_platform_accounts a WHERE a.driver_id = d.id AND a.deleted_at IS NULL)
ON CONFLICT DO NOTHING;

COMMIT;
