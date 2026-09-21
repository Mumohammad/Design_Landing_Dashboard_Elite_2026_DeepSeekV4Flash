# P0-1 Review Fixes — Implementation Bundle

Implements REV-1, REV-2, REV-3, REV-5, REV-6 and REV-7 from the P0-1
post-implementation review. Everything below was validated in a sandbox:
YAML parse, `node --check`, verifier old-fails/new-passes, guard tests,
bundle-check simulation, and `git apply --check` on both patches.

## What changed

| Fix | File | Change |
| --- | --- | --- |
| REV-1 (High) | `.github/workflows/deploy.yml` | Guard step passes secrets via `env:` and reads `$VAR` — no secret interpolation into the `run:` block (was shell-injectable) |
| REV-2 (Medium) | `.github/workflows/deploy.yml` | Guard refuses when `PRODUCTION_SUPABASE_URL` equals `STAGING_SUPABASE_URL` |
| REV-6 (Medium) | `.github/workflows/deploy.yml` | New step `Verify production bundle has no staging references` greps `.vercel/output` for the staging host before deploy |
| REV-5 (Low) | `.github/workflows/ci.yml` | `Deploy config check` moved to run right after `Install dependencies` (fail fast) |
| REV-1/2/6 guard | `scripts/verify-deploy-config.mjs` | Now asserts guard env vars, no interpolation, and bundle-check presence; allows `STAGING_SUPABASE_URL` for comparison only. Also fixed the job-key regex to match the real 2-space indentation (the shipped regex matched nothing) |
| REV-3 (Medium) | `.gitattributes` (new) | LF normalization for yml/yaml/json/md/mjs — stops the CRLF diff churn |
| REV-7 (Blocker) | `src/app/dashboard/page.tsx`, `src/app/dashboard/settings/page.tsx`, `src/app/api/platform/login/route.ts` | Removed all `any` types that fail `pnpm lint` (typed `RecentDriver`, `Tenant`, `TenantRow` interfaces) |
| Docs | `docs/P0-1-production-supabase-runbook.md` | Step 4 adds `STAGING_SUPABASE_URL`; Step 6 adds the bundle-check item |

## Applying — Windows PowerShell (single-line commands)

Your branch `fix/p0-1-production-supabase` is based on an OLD commit
(440e4579, 2026-09-01) and is missing `src/app/dashboard`, `src/app/platform`
and other directories that exist on master. Recommended order:

1. Update the branch with master first:

```powershell
cd "C:\Users\Zbook\Downloads\shadcn-dashboard-landing-template-main (1)\shadcn-dashboard-landing-template-main\nextjs-version"; git checkout fix/p0-1-production-supabase; git pull origin master
```

2. Apply the hardening patch (workflow + verifier + runbook + .gitattributes):

```powershell
git apply p0-1-review-hardening.patch
```

3. Apply the lint-fix patch (the three `any` files):

```powershell
git apply p0-1-review-lint-fixes.patch
```

4. Verify:

```powershell
node scripts\verify-deploy-config.mjs; pnpm lint
```

5. Stage, commit, push (single line):

```powershell
git add .github\workflows\deploy.yml .github\workflows\ci.yml scripts\verify-deploy-config.mjs docs\P0-1-production-supabase-runbook.md .gitattributes src\app\dashboard\page.tsx src\app\dashboard\settings\page.tsx src\app\api\platform\login\route.ts; git commit -m "fix(p0-1): harden deploy guard, verify bundle, fix lint blockers"; git push
```

If `git apply` fails (line endings), fall back: copy `files\*` over the
working tree with `Copy-Item -Recurse -Force`, then re-run the verifier.

## Tests included

- `tests/test_hardened_guard.py` + `tests/guard-step.yml` — 7 cases incl.
  injection and prod==staging regression (all pass).
- Run: `python tests\test_hardened_guard.py`

## Still owner actions (not code)

1. Create the Supabase production project and apply migrations 001-061
   without seeding (runbook Steps 1-3).
2. Add `PRODUCTION_SUPABASE_URL`, `PRODUCTION_SUPABASE_ANON_KEY`,
   `PRODUCTION_SUPABASE_SERVICE_KEY` AND `STAGING_SUPABASE_URL` to
   GitHub -> Settings -> Environments -> production (runbook Step 4).
3. Mirror in Vercel production env (runbook Step 5).
4. Merge PR #15 (consider splitting the browserslist change out).
5. After the first deploy, confirm the bundle-check step passes.

## Notes

- `master` still has the original P0-1 bug until PR #15 merges.
- The patch is authoritative; the files under `files\` are copies of the
  new versions for reference.
- RLS and authorization are untouched. Arabic/English/RTL/LTR untouched.
