# P0-1 — Verification Report

Generated 2026-09-07 (offline sandbox). The repository was not modified
remotely; all changes are delivered as `p0-1-production-supabase.patch` plus
the full updated files under `files/`.

## Checks run

### 1. YAML validity of both workflows

Command: `python3 validate_yaml.py`

Result: **PASS**

```
OK YAML: /data/p0-1/new/.github/workflows/deploy.yml (jobs: ['preview', 'production'])
OK YAML: /data/p0-1/new/.github/workflows/ci.yml (jobs: ['ci', 'pgtap', 'e2e'])
ALL_YAML_OK
```

### 2. Script syntax

Command: `node --check scripts/verify-deploy-config.mjs`

Result: **PASS** (`SYNTAX_OK`)

### 3. Negative regression test (old deploy.yml — must fail)

Command: `node scripts/verify-deploy-config.mjs <old deploy.yml>`

Result: **FAILED as expected**, exit code 1, 5 violations:

```
❌ "NEXT_PUBLIC_SUPABASE_URL" in the "production" job must reference secrets.PRODUCTION_SUPABASE_URL; found: ${{ secrets.STAGING_SUPABASE_URL }}
❌ "NEXT_PUBLIC_SUPABASE_ANON_KEY" in the "production" job must reference secrets.PRODUCTION_SUPABASE_ANON_KEY; found: ${{ secrets.STAGING_SUPABASE_ANON_KEY }}
❌ "SUPABASE_SERVICE_ROLE_KEY" in the "production" job must reference secrets.PRODUCTION_SUPABASE_SERVICE_KEY; found: ${{ secrets.STAGING_SUPABASE_SERVICE_KEY }}
❌ Production job must not reference STAGING_* secrets (3 line(s))
❌ Production job is missing the "Verify production Supabase secrets" guard step
```

### 4. Positive regression test (new deploy.yml — must pass)

Command: `node scripts/verify-deploy-config.mjs <new deploy.yml>`

Result: **PASS**, exit code 0:

```
✅ No STAGING_* references in the production job
✅ Fail-fast secret guard step present
✅ Deploy config verification passed — production uses its own Supabase project
```

### 5. Patch applies cleanly to a fresh checkout of the old state

Commands: `git apply --check` + `git apply` in a fresh repo seeded with the
old files.

Result: **PASS** — `APPLY_CHECK_OK`, `APPLY_OK`; the post-apply tree is
byte-identical to `files/` (`IDENTICAL_TO_NEW`).

## Not run here (requires the repo + network)

- `pnpm lint`, `tsc --noEmit`, `vitest`, `next build` — the repository cannot
  be cloned in this sandbox (no network). The changed files are workflow YAML,
  an env template, a standalone Node script, and a Markdown runbook; none are
  part of the Next.js bundle. CI runs the full suite on the PR, including the
  new **Deploy config check** step.

## Changed files

- `.github/workflows/deploy.yml` (modified)
- `.github/workflows/ci.yml` (modified)
- `.env.example` (modified)
- `scripts/verify-deploy-config.mjs` (new)
- `docs/P0-1-production-supabase-runbook.md` (new)
