BEGIN;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
COMMENT ON COLUMN public.tenants.trial_ends_at IS 'End of the 14-day free trial. Set at registration.';
CREATE INDEX IF NOT EXISTS idx_tenants_trial ON public.tenants(trial_ends_at) WHERE trial_ends_at IS NOT NULL;
COMMIT;
