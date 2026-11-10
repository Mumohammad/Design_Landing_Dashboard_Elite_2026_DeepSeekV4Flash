-- 20260917210000_phase_a_table_grants.sql
-- Fix PGRST205: the Phase A module tables (20260915120000_drivers_module_foundation.sql)
-- were created without role grants, so PostgREST never exposed them — its schema
-- cache omits tables the API roles cannot see, and every API call failed with
-- PGRST205 "Could not find the table in the schema cache".
--
-- Grant the same privileges the core tables (drivers, driver_documents) carry,
-- then ask PostgREST to reload. RLS policies (unchanged) still govern row access.

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON public.driver_consents,
     public.driver_compliance_results,
     public.driver_compliance_overrides,
     public.driver_calendar_events,
     public.driver_assets,
     public.driver_cards,
     public.driver_card_prints
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
