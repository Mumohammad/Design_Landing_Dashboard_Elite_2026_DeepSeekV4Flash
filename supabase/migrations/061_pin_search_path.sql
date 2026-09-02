-- 061: Pin search_path on SECURITY DEFINER functions
--
-- Incident 2026-09-02: all logins failed with 500 (`type "user_status"
-- does not exist`, SQLSTATE 42704) when GoTrue updated last_sign_in_at.
-- Root cause: sync_auth_user_to_custom_users() runs with the caller's
-- search_path; GoTrue connects as supabase_auth_admin whose path lacks
-- `public`, so unqualified enum casts ('active'::user_status) broke.
-- Rule: every SECURITY DEFINER function must pin its search_path.

alter function public.sync_auth_user_to_custom_users() set search_path = public, auth;
alter function public.get_my_tenant_id() set search_path = public, auth;
alter function public.compute_driver_completeness(uuid) set search_path = public, auth;
