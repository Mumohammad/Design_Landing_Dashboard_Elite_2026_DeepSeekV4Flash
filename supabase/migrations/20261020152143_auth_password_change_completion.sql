BEGIN;
ALTER TABLE public.users
  ADD COLUMN credential_revision bigint NOT NULL DEFAULT 0 CHECK(credential_revision>=0),
  ADD COLUMN credential_requirement_version bigint NOT NULL DEFAULT 0 CHECK(credential_requirement_version>=0),
  ADD COLUMN password_requirement_version bigint NOT NULL DEFAULT 0 CHECK(password_requirement_version>=0);

-- Requiring another change, including an explicit true -> true reset, invalidates
-- any in-flight completion. Normal profile edits do not change this generation.
CREATE FUNCTION public.version_password_requirement()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  NEW.password_requirement_version := OLD.password_requirement_version
    + CASE WHEN NEW.must_change_password THEN 1 ELSE 0 END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.version_password_requirement() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER version_password_requirement BEFORE UPDATE OF must_change_password ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.version_password_requirement();

-- Observe Auth's real credential transition transactionally. An administrator's
-- reset must never clear a required user change. No hash or password is copied.
CREATE FUNCTION public.observe_auth_password_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_profile record; v_changed_at timestamptz := statement_timestamp();
BEGIN
  IF NEW.encrypted_password IS NOT DISTINCT FROM OLD.encrypted_password
    OR NULLIF(NEW.encrypted_password,'') IS NULL THEN RETURN NEW; END IF;
  FOR v_profile IN
    UPDATE public.users SET credential_revision=credential_revision+1,password_changed_at=v_changed_at,
      credential_requirement_version=password_requirement_version
    WHERE auth_user_id=NEW.id AND deleted_at IS NULL
    RETURNING id,tenant_id,credential_revision
  LOOP
    INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
    VALUES(v_profile.tenant_id,NULL,'auth','users',v_profile.id,'auth_password_changed',
      jsonb_build_object('source','supabase_auth','password_changed_at',v_changed_at,'credential_revision',v_profile.credential_revision));
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.observe_auth_password_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER observe_auth_password_change AFTER UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW WHEN(OLD.encrypted_password IS DISTINCT FROM NEW.encrypted_password)
  EXECUTE FUNCTION public.observe_auth_password_change();

-- Trusted app code calls this only after the user's authenticated Auth update
-- succeeds. Concurrent credentials or a newly forced reset require a new change.
CREATE FUNCTION public.complete_user_password_change(p_actor uuid,p_expected_revision bigint,p_requirement_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_profile public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.users WHERE auth_user_id=p_actor AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_profile.status<>'active' OR (v_profile.locked_until IS NOT NULL AND v_profile.locked_until>now()) THEN
    RAISE EXCEPTION 'AUTH_PASSWORD_ACCOUNT: active unlocked account required';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision<1 OR p_requirement_version IS NULL
    OR v_profile.credential_revision<>p_expected_revision
    OR v_profile.password_requirement_version<>p_requirement_version OR v_profile.password_changed_at IS NULL THEN
    RAISE EXCEPTION 'AUTH_PASSWORD_CONCURRENT: credential or requirement changed; start a new password change';
  END IF;
  IF v_profile.credential_requirement_version<>p_requirement_version THEN
    RAISE EXCEPTION 'AUTH_PASSWORD_CONCURRENT: credential predates the current requirement';
  END IF;
  IF v_profile.must_change_password THEN
    UPDATE public.users SET must_change_password=false WHERE id=v_profile.id;
    INSERT INTO public.audit_log(tenant_id,actor_id,module,entity_type,entity_id,action,new_values)
    VALUES(v_profile.tenant_id,p_actor,'auth','users',v_profile.id,'required_password_change_completed',
      jsonb_build_object('credential_revision',p_expected_revision,'password_requirement_version',p_requirement_version));
  END IF;
  RETURN jsonb_build_object('completed',true,'credential_revision',p_expected_revision);
END;
$$;
REVOKE ALL ON FUNCTION public.complete_user_password_change(uuid,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_user_password_change(uuid,bigint,bigint) TO service_role;

-- Shared business-data boundary. Separate own-profile/MFA bootstrap stays open.
CREATE OR REPLACE FUNCTION public.has_required_assurance()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT NOT EXISTS(SELECT 1 FROM public.users u WHERE u.auth_user_id=(SELECT auth.uid()) AND u.must_change_password)
  AND (COALESCE((SELECT auth.jwt()->>'aal')='aal2',false) OR NOT (
    EXISTS(SELECT 1 FROM public.users u WHERE u.auth_user_id=(SELECT auth.uid()) AND u.role IN('general_manager','admin'))
    OR EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=(SELECT auth.uid()) AND f.status='verified')
  ));
$$;
REVOKE ALL ON FUNCTION public.has_required_assurance() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.has_required_assurance() TO authenticated,service_role;
COMMIT;
