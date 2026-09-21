# P0-1 — Production Supabase Project & Deploy Repoint — Runbook

> Status: code changes prepared (2026-09-07). The Supabase project itself must
> be created by a workspace owner with Supabase access. This document is the
> exact procedure; the deploy job fails fast until it is completed.

## Why this exists

The production deploy job in `.github/workflows/deploy.yml` previously built
with `STAGING_SUPABASE_*` secrets. Any pilot traffic would have been written
to the staging database. The workflow now requires `PRODUCTION_SUPABASE_*`
secrets and aborts the build if they are missing.

## Prerequisites

- Supabase dashboard access (owner) — https://supabase.com/dashboard
- Supabase CLI locally — `supabase --version`
- GitHub admin on the repo (environment secrets)
- Vercel project access

## Step 1 — Create the production project

1. Supabase Dashboard → **New project** → name: `EliteDev Production`.
2. **Region:** pick the region that satisfies your data-residency
   requirements. Staging is `iad1` (us-east-1). For Saudi deployments the
   nearest commonly used region is `eu-central-1` (Frankfurt); confirm current
   availability in the dashboard and record the decision.
3. Set a strong database password; store it in a password manager.
4. Optional but recommended: enable **Point-in-Time Recovery** now (cheap
   insurance; restore drills are tracked as P1-9).

## Step 2 — Apply migrations (do NOT seed)

```bash
supabase link --project-ref <production-project-ref>
supabase db push            # applies migrations 001–061
supabase migration list     # confirm all applied
```

Do **not** run `supabase db seed` against production. `supabase/seed.sql`
contains demo credentials (`Test1234!`) and placeholder API keys
(tracked as R-08 / P0-8).

## Step 3 — Match auth configuration to staging

In the production project's **Authentication** settings:

- **Site URL** → production app URL (e.g. `https://app.elitedev.com.sa`)
- **Redirect URLs** → production app URL paths
- Keep direct signups **disabled** (AUTH010 bans self-service signup;
  provisioning is invite-only). Do not relax this.
- Configure the same email provider (Resend) and templates as staging.
- Re-apply any MFA policy configured on staging.

## Step 4 — Add GitHub environment secrets

GitHub → **Settings → Environments → `production` → Environment secrets**:

| Secret | Source |
| --- | --- |
| `PRODUCTION_SUPABASE_URL` | Project Settings → API → Project URL |
| `PRODUCTION_SUPABASE_ANON_KEY` | Project Settings → API → anon public key |
| `PRODUCTION_SUPABASE_SERVICE_KEY` | Project Settings → API → service_role key |
| `STAGING_SUPABASE_URL` | Staging project's URL — used only for the guard's equality check and the bundle verification; never used to build |

The deploy job now fails fast if any of these are missing.

## Step 5 — Mirror in Vercel production environment

The workflow overrides these at build time, but set the same three values in
**Vercel → Project → Settings → Environment Variables → Production** so any
build outside the workflow is also correct.

## Step 6 — Verification checklist

1. Merge the P0-1 branch; the production job must pass the
   **Verify production Supabase secrets** step.
2. `curl https://<prod>/api/health` → `"status":"healthy"`.
3. Confirm the built bundle contains the **production** project URL and not
   the staging URL (search the served JS for the staging project ref).
4. Log in with a real production user and create a test row; confirm the row
   appears in the **production** Supabase dashboard, not staging.
5. Confirm **Deploy config check** is green in CI
   (`scripts/verify-deploy-config.mjs`).
6. Confirm the **Verify production bundle has no staging references** step
   passes — it greps `.vercel/output` for the staging host and refuses to
   deploy if found.

## Guardrails

- Never commit real production credentials; secrets live only in GitHub/Vercel.
- RLS and authorization are unchanged by this task.
- Staging remains the preview-deployment backend — that is intentional.
