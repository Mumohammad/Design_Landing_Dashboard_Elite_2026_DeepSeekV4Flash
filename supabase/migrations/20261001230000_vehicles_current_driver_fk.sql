-- 20261001230000_vehicles_current_driver_fk.sql
-- Prompt N — /vehicles crash: PostgREST embed hint `drivers!vehicles_current_driver_id_fkey`
-- resolves against the FK constraint name. That constraint was never created by any
-- repo migration (016_vehicles.sql declares the bare `current_driver_id UUID` column),
-- so fresh builds (local `supabase db reset` AND prod wwfnsbilmyxeawgzicmv) return
-- HTTP 400 for the vehicles list embed and the module crashes into the error boundary.
--
-- Fix: define the constraint canonically under the exact name the app embeds, with
-- ON DELETE SET NULL so a hard-deleted driver simply unassigns the vehicle (matches
-- src/lib/vehicles/assignments.ts free-the-vehicle semantics). Additive only.

-- ═══ 1) Data hygiene guard — orphan current_driver_id values ═══
-- An orphan (current_driver_id NOT NULL with no matching drivers row) can only arise
-- from a hard-deleted driver; nulling it is the safe, deterministic repair and is
-- required before the FK can be attached. Soft-deleted drivers keep their rows, so
-- those assignments are untouched.
DO $$
DECLARE
  v_orphans INT;
  v_orphan_ids uuid[];
BEGIN
  SELECT COUNT(*), COALESCE(array_agg(v.id), '{}') INTO v_orphans, v_orphan_ids
  FROM public.vehicles v
  WHERE v.current_driver_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = v.current_driver_id);

  IF v_orphans > 0 THEN
    -- Surface the affected vehicle ids in the db push log so the PR body can
    -- report them verbatim (Prompt N: orphan values must be reported).
    RAISE NOTICE 'vehicles_current_driver_fk: nulling % orphaned current_driver_id value(s) (driver rows hard-deleted) on vehicles: %',
      v_orphans, v_orphan_ids;
    UPDATE public.vehicles v
    SET current_driver_id = NULL, updated_at = now()
    WHERE v.current_driver_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = v.current_driver_id);
  ELSE
    RAISE NOTICE 'vehicles_current_driver_fk: no orphaned current_driver_id values';
  END IF;
END;
$$;

-- ═══ 2) Constraint — guarded idempotent add ═══
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicles_current_driver_id_fkey'
      AND conrelid = 'public.vehicles'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_current_driver_id_fkey
      FOREIGN KEY (current_driver_id) REFERENCES public.drivers(id)
      ON DELETE SET NULL;
    RAISE NOTICE 'vehicles_current_driver_fk: constraint added';
  ELSE
    RAISE NOTICE 'vehicles_current_driver_fk: constraint already exists';
  END IF;
END;
$$;

-- ═══ 3) Supporting index (Prompt J convention: every FK column gets an index) ═══
CREATE INDEX IF NOT EXISTS idx_vehicles_current_driver_id
  ON public.vehicles (current_driver_id);

-- ═══ 4) PostgREST cache reload ═══
NOTIFY pgrst, 'reload schema';

-- ═══ 5) Post-condition — fail loudly if the constraint is still absent ═══
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicles_current_driver_id_fkey'
      AND conrelid = 'public.vehicles'::regclass
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'vehicles_current_driver_fk: constraint vehicles_current_driver_id_fkey missing after migration';
  END IF;
END;
$$;
