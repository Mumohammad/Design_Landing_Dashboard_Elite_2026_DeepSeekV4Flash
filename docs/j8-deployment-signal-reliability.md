# J8 — Deployment Signal Reliability

**Date:** 2026-09-13 · **Branch:** `fix/j8-deployment-signal-reliability` · **Base:** `origin/master` @ `1785e95`

Two deployment-signal issues were investigated. Neither affects application behavior,
Supabase, or Vercel production configuration.

---

## Part A — GitHub "production" check failure (`Deploy — EliteDev`)

### Root cause (exact)

The `Deploy — EliteDev` workflow (`.github/workflows/deploy.yml`) had **two triggers**:

1. `pull_request` → `preview` job — **works** (uses the `preview` GitHub environment, which has its secrets configured).
2. `workflow_run` (after CI on `master`) → `production` job — **always failed**.

The `production` job failed **before touching Vercel at all**: every Vercel step
("Install Vercel CLI" → "Deploy production") shows `skipped` in the run history
(job `103718653735`), and the failure annotation is `Process completed with exit code 1`
at the **"Verify production Supabase secrets"** step.

That step is the **P0-1 fail-closed guard** (see `docs/P0-1-production-supabase-runbook.md`,
Step 4): it aborts the build unless the **`production` GitHub environment** defines
`PRODUCTION_SUPABASE_URL`, `PRODUCTION_SUPABASE_ANON_KEY`, `PRODUCTION_SUPABASE_SERVICE_KEY`
— and the repo's `production` environment currently has **no environment secrets**
(`GET /repos/…/environments/production` → `protection_rules: []`; secret contents are
auth-gated, so this is behavioral evidence, not a values check).

Discriminating evidence: **every** `workflow_run` (master) run in the workflow's history
failed, while `pull_request` runs succeeded — the only difference between the two jobs is
which GitHub environment's secrets they bind (`production` vs `preview`).

### Redundancy (confirmed)

Vercel's native Git integration already deploys `master` to production:

- Commit status **`Vercel – elite-dashboard` = success** ("Deployment has completed") on `1785e95`
- Deployment `6421129627` created by `vercel[bot]`, URL live (`/api/health` → `HTTP 200 healthy`)

The `production` GH job was therefore a **second, redundant deploy path** whose only
contribution was a permanent red ❌ on every master commit.

### Rule out (verified, not the cause)

| Hypothesis | Verdict |
|---|---|
| Missing `VERCEL_TOKEN` | **Ruled out** — same secret powers the `preview` job, which succeeds |
| Wrong `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | **Ruled out** — the job died before any Vercel step ran |
| Invalid CLI command / flags | **Ruled out** — never executed |
| Aliasing behavior | **Ruled out** — never reached |

### Fix applied in this branch

- Removed the `workflow_run` (master) trigger from `deploy.yml`.
- Tombstoned the `production` job with `if: false` + a comment explaining why and how to re-enable.
- `verify-deploy-config.mjs` (the P0-1 regression guard) still **passes** — the production
  job body keeps its PRODUCTION_*/STAGING_* invariants for the day it is legitimately re-enabled.

### Behavior after this change

| Event | Before | After |
|---|---|---|
| Pull request | `preview` job builds + deploys preview (staging Supabase) | **unchanged** |
| Push to master | CI → `Deploy — EliteDev` (`workflow_run`) → **red ❌** | CI only; no deploy workflow run |
| Vercel-native Git deploy on master | already the real production path | **unchanged** (primary) |

### To re-enable GH production deploys (optional, explicit human action)

1. Add **environment secrets** (values from Vercel/Supabase dashboards — names only listed here):
   - `PRODUCTION_SUPABASE_URL`
   - `PRODUCTION_SUPABASE_ANON_KEY`
   - `PRODUCTION_SUPABASE_SERVICE_KEY`
   - `STAGING_SUPABASE_URL` (needed by the guard's equality check + bundle verification)
2. Restore the `workflow_run` trigger and flip the job's `if: false` gate.
3. Decide whether the job still adds value over Vercel-native deploys (e.g. the
   production-bundle staging-reference guard).

---

## Part B — `elite-dashboard-b2b` BLOCKED

### Root cause (exact)

**Vercel Deployment Protection (SSO), not a build failure.** On the identical master commit `1785e95`:

| Probe | elite-dashboard | elite-dashboard-b2b |
|---|---|---|
| Commit status | success — "Deployment has completed" | failure — **"Deployment was blocked"** |
| Deployment URL `/api/health` | `HTTP 200 {"status":"healthy",…}` | `HTTP 302 → https://vercel.com/sso-api?…` |
| Git integration | `vercel[bot]` created the deployment | same — integration is attached and the **build succeeded** |

The `302 → vercel.com/sso-api` redirect is Vercel's SSO protection handshake for
`*.vercel.app` deployment URLs (the primary project has no deployment protection; B2B
protects everything except custom domains). Vercel's activity log documents exactly this
class of event: *"A deployment was blocked because the Git user could not be authorized
for the team."* The GitHub commit status mirrors Vercel's **gate**, not a broken build.

**Assessment:** B2B is **intentionally protected** (consistent policy: "all deployments
except custom domains"), not an accidental repo link — it receives the same pushes and
builds them successfully.

### Recommended Vercel dashboard action (no change executed)

If B2B's green-signal reliability matters more than protecting `*.vercel.app` URLs:

1. **Vercel Dashboard → team `elitesaasc-5643` → project `elite-dashboard-b2b` →
   Settings → Deployment Protection → SSO Protection** — either
   - turn it **off** for preview/development deployments (keep "Protect custom domains" off),
   - or scope it so Git-commit checks are not marked failed.
2. Alternatively, **Settings → Deployment Protection → Protection Bypass for Automation**
   — generate a bypass secret for automated consumers of the deployment URLs.
3. **Team settings → Members** — confirm the GitHub user pushing to `master` is an
   authorized team member (SSO-linked), since commit statuses record authorization failures.
4. If the signal noise is acceptable, **no action is needed** — the B2B production build
   itself is healthy, and custom-domain traffic is unaffected by SSO.

---

## Part C — Guardrails honored

- ✅ Branch `fix/j8-deployment-signal-reliability` from `origin/master` @ `1785e95`.
- ✅ Patch touches **only** `.github/workflows/deploy.yml` and this document.
- ✅ No Supabase SQL / migration / Edge Function / project-config change executed.
- ✅ No Vercel protection, Git-integration, alias, or domain change executed.
- ✅ No secrets read, printed, rotated, or committed. No PR created or merged.
- ✅ `fx08-order-lock-test-phaseA` stash untouched.

## Validation

- `node scripts/verify-deploy-config.mjs` → **passed** (P0-1 invariants intact)
- `python -c "yaml.safe_load(deploy.yml)"` → **YAML OK**
- `pnpm exec tsc --noEmit` → **exit 0**
- `pnpm exec vitest run` → **all tests passing** (see commit message for the run that gated the push)
