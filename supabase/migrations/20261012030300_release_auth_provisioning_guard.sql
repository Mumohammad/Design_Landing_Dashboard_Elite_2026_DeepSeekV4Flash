BEGIN;
CREATE OR REPLACE FUNCTION public.sync_auth_user_to_custom_users()
RETURNS TRIGGER AS $$
DECLARE
  v_existing_user UUID;
  v_is_invite_provisioned BOOLEAN;
BEGIN
  -- ── INSERT: only allow invite-provisioned users ─────────────────
  IF TG_OP = 'INSERT' THEN
    -- Check if this auth user was already provisioned (replay protection)
    SELECT id INTO v_existing_user
    FROM public.users
    WHERE auth_user_id = NEW.id;

    IF v_existing_user IS NOT NULL THEN
      -- Already provisioned (e.g., acceptInvite completed). Just sync.
      RETURN NEW;
    END IF;

    -- Only Admin API app metadata, Auth-managed invited_at, or privileged SQL
    -- can authorize provisioning. Public signup cannot set these fields.
    SELECT COALESCE(u.raw_app_meta_data ->> '_invite_provisioned', 'false') = 'true'
      OR u.invited_at IS NOT NULL
      OR (session_user = 'postgres' AND COALESCE(current_setting('role', true), 'none') IN ('none','postgres'))
      INTO v_is_invite_provisioned FROM auth.users u WHERE u.id = NEW.id;

    IF v_is_invite_provisioned THEN
      -- acceptInvite() will insert users/memberships/roles after this trigger.
      -- Do NOT auto-create — wait for the explicit server action.
      RETURN NEW;
    END IF;

    -- NO INVITE MARKER: This is a direct public signup attempt.
    -- BLOCK IT: Ban the user and reject the login.
    -- We cannot delete the auth.users row from a trigger, but we can ban them.
    UPDATE auth.users
    SET banned_until = NOW() + INTERVAL '10 years',
        raw_app_meta_data = raw_app_meta_data || '{"blocked_signup": true}'::jsonb
    WHERE id = NEW.id;

    RAISE EXCEPTION 'AUTH010: Direct signup is not permitted. Use the invite flow.';
  END IF;

  -- ── UPDATE: sync status changes (keep existing logic) ───────────
  IF TG_OP = 'UPDATE' THEN
    UPDATE public.users
    SET status = CASE
      WHEN NEW.banned_until IS NOT NULL AND NEW.banned_until > NOW()
        THEN 'locked'::public.user_status
      WHEN NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL
        THEN 'active'::public.user_status
      ELSE status
    END,
    updated_at = NOW()
    WHERE auth_user_id = NEW.id;
    RETURN NEW;
  END IF;

  -- ── DELETE: soft-delete the custom users row (keep existing logic) ──
  IF TG_OP = 'DELETE' THEN
    UPDATE public.users
    SET status = 'inactive'::public.user_status,
        deleted_at = NOW(),
        updated_at = NOW()
    WHERE auth_user_id = OLD.id;
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
REVOKE ALL ON FUNCTION public.sync_auth_user_to_custom_users() FROM PUBLIC, anon, authenticated;


-- Auth writes Admin API app metadata/invited_at after the initial INSERT.
-- Check the final row at commit, so the guard observes those trusted fields.
DROP TRIGGER IF EXISTS on_auth_user_changed ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_insert_guard ON auth.users;
CREATE TRIGGER on_auth_user_changed AFTER UPDATE OR DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_auth_user_to_custom_users();
CREATE CONSTRAINT TRIGGER on_auth_user_insert_guard AFTER INSERT ON auth.users
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.sync_auth_user_to_custom_users();
COMMIT;
