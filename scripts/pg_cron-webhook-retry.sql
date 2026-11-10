-- FX-05: plan-independent scheduler for webhook retries + delivery retention.
--
-- WHY THIS EXISTS: the retry ladder is 30s → 2m → 10m → 30m → 2h with
-- MAX_DELIVERY_ATTEMPTS = 5, so a delivery's whole retry lifecycle finishes
-- within ~2h05m. Vercel Hobby clamps vercel.json cron schedules to once per
-- day, which would miss nearly every retry window. Options:
--   * Vercel Pro/Enterprise → the vercel.json entry ("*/10 * * * *") fires
--     as scheduled; you do NOT need this script.
--   * Vercel Hobby (or preference) → run THIS script once in Supabase
--     (Studio → SQL Editor). pg_cron hits the deployed cron route every
--     10 minutes with the CRON_SECRET bearer. No npm dependency involved.
--
-- The route itself fails closed (503 without CRON_SECRET, 401 with a wrong
-- bearer), so a stale or leaked schedule cannot trigger it.
--
-- REPLACE BOTH PLACEHOLDERS BEFORE RUNNING:
--   1. YOUR-PRODUCTION-DOMAIN  → your Vercel production domain
--   2. REPLACE_WITH_CRON_SECRET → the same value as the CRON_SECRET env var
--
-- Re-running: cron job names are unique — unschedule first if re-scheduling:
--   SELECT cron.unschedule('webhook-retry-cron');

-- Extensions: pg_cron MUST live in pg_catalog on Supabase; pg_net in extensions.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'webhook-retry-cron',
  '*/10 * * * *',
  $$
  SELECT net.http_get(
    url := 'https://YOUR-PRODUCTION-DOMAIN/api/webhooks/cron',
    headers := '{"Authorization": "Bearer REPLACE_WITH_CRON_SECRET"}'::jsonb,
    timeout_msec := 15000
  )
  $$
);

-- Verify the job is registered:
--   SELECT jobid, jobname, schedule, active FROM cron.job;
-- Inspect recent runs (status + response):
--   SELECT start_time, status FROM cron.job_run_details
--   WHERE jobname = 'webhook-retry-cron'
--   ORDER BY start_time DESC LIMIT 10;
