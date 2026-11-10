BEGIN;
REVOKE EXECUTE ON FUNCTION public.compute_driver_completeness(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_driver_completeness(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_chart_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_chart_account() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_user_self_escalation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_auth_user_to_custom_users() FROM PUBLIC;
COMMIT;
