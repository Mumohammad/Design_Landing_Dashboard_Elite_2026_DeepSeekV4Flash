-- Periodic management notification digest (email).
-- One settings row per tenant; a tenant without a row uses the defaults
-- (enabled, daily, general managers + admins, every category).
-- Service-role only: the app reads/writes through permission-checked server
-- actions (settings:read / settings:update) and the CRON_SECRET-guarded job.
BEGIN;

CREATE TABLE public.notification_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  frequency text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekly')),
  weekly_day smallint NOT NULL DEFAULT 0 CHECK (weekly_day BETWEEN 0 AND 6),
  horizon_days smallint NOT NULL DEFAULT 30 CHECK (horizon_days BETWEEN 7 AND 90),
  recipient_roles text[] NOT NULL DEFAULT ARRAY['general_manager', 'admin']::text[]
    CHECK (recipient_roles <@ ARRAY['general_manager','admin','accountant','supervisor','hr_officer','operations_officer','payroll_officer','platform_coordinator','readonly_auditor']::text[]),
  extra_recipients text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (cardinality(extra_recipients) <= 20),
  categories text[] NOT NULL DEFAULT ARRAY['drivers','vehicles','maintenance','finance','approvals','violations']::text[]
    CHECK (cardinality(categories) >= 1 AND categories <@ ARRAY['drivers','vehicles','maintenance','finance','approvals','violations']::text[]),
  only_when_alerts boolean NOT NULL DEFAULT true,
  last_sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_settings TO service_role;

-- One row per tenant per business day: the unique key makes the scheduled run
-- idempotent (a retried cron cannot email management twice the same day).
CREATE TABLE public.notification_digest_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_date date NOT NULL,
  kind text NOT NULL DEFAULT 'scheduled' CHECK (kind IN ('scheduled', 'test')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  recipients integer NOT NULL DEFAULT 0 CHECK (recipients >= 0),
  items integer NOT NULL DEFAULT 0 CHECK (items >= 0),
  critical integer NOT NULL DEFAULT 0 CHECK (critical >= 0),
  detail text CHECK (detail IS NULL OR length(detail) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX notification_digest_log_daily
  ON public.notification_digest_log(tenant_id, run_date) WHERE kind = 'scheduled';
CREATE INDEX notification_digest_log_recent
  ON public.notification_digest_log(tenant_id, created_at DESC);
ALTER TABLE public.notification_digest_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_digest_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_digest_log TO service_role;

COMMIT;
