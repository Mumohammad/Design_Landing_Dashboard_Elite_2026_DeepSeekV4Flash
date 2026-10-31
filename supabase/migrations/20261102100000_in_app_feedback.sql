-- In-app feedback / support requests (topbar "Feedback"). Service-role only:
-- written by a rate-limited server action, triaged by the platform operator.
BEGIN;

CREATE TABLE public.app_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('bug', 'idea', 'question', 'praise')),
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 5 AND 4000),
  page_path text CHECK (page_path IS NULL OR length(page_path) <= 300),
  user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 300),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_feedback_recent ON public.app_feedback(status, created_at DESC);
CREATE INDEX app_feedback_tenant ON public.app_feedback(tenant_id, created_at DESC);
ALTER TABLE public.app_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.app_feedback TO service_role;

COMMIT;
