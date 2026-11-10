# CI Migration Push Automation (Prompt H)

Retires the manual `supabase db push` post-merge step forever. Vercel deploys do **not** apply migrations — every module merge has required a hand-run push (4 so far, one blocked on the 20-token login cap). From now on, any merge to `master` that touches `supabase/migrations/**` is pushed to the linked project automatically by CI, with a concurrency guard, fail-loud errors, and a step summary of the applied migration history.

Small PR: one workflow file + docs notes. Zero app code touched.

---

## What's in the PR

### 1. `.github/workflows/supabase-deploy.yml` (new)

| Aspect | Implementation |
| --- | --- |
| **Trigger** | `push` to `master` with `paths: supabase/migrations/**` (plus the workflow file itself, so workflow changes are exercised), and `workflow_dispatch` for manual re-runs |
| **Toolchain** | `supabase/setup-cli@v1` pinned to **`v2.118.0`** (current latest, 2026-09-25) — no floating `latest` on a prod-write path |
| **Job steps** | secret presence check → `supabase link --project-ref $SUPABASE_PROJECT_ID` → `supabase db push` → step summary |
| **Env** | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID` — all from **repo-level Actions secrets** (deliberately *not* environment secrets: no human-gate on a migration push; master is already the protected branch) |
| **Safety** | `concurrency: db-push-master` with `cancel-in-progress: false` — overlapping master merges **serialize** (a cancelled run would silently skip its migrations); no `continue-on-error` anywhere; secrets passed via `env:` and read as shell variables, never interpolated into `run:` blocks (deploy.yml idiom) |
| **Step summary** | project ref, commit, and the last 20 lines of `supabase migration list` after every successful push |
| **`--include-all`** | `db push --include-all` marks migrations present on disk but missing from the remote history table — first CI run after any out-of-band (SQL-editor) push converges instead of looping on a remote-history mismatch |

### 2. PR dry-run decision (the "keep it simple" clause)

The prompt's optional PR dry-run gate needs a live `link` — i.e. repo secrets present and a network write path on every PR, which is neither simple nor free. **Skipped**, as the prompt permits. Instead the workflow's `workflow_dispatch` trigger accepts a **`dry_run` boolean input**: `supabase db push --dry-run` lists pending migrations against the linked project and applies nothing. Manual gate before a risky push, or to rehearse the workflow itself, in one click.

### 3. Docs notes

- **`docs/GITHUB_SECRETS_SETUP.md`** — new "Supabase Migrations (CI db push)" section: the three secrets, where each value comes from, the org-scoping note for the access token (see checklist below), the 20-token-cap warning (create one scoped token, reuse it — don't mint throwaways), a 4-step verification recipe (dispatch dry-run → dispatch real → merge a test migration PR), the 403-on-link troubleshooting note, and the rollback line.
- **`docs/RELEASE_CHECKLIST.md`** — the module PR convention one-liner: *"post-merge db push is automated by `.github/workflows/supabase-deploy.yml` — remove the manual-push action line from future PR bodies."*
- **`docs/DEPLOYMENT_RUNBOOK.md`** — Database Setup section now leads with the automation note; manual `db push` is documented as the out-of-band escape hatch only.

---

## ⚠️ Steward action — repo secrets must be set (cannot be done in code)

Before the first automated push runs, add to **GitHub → Settings → Secrets and variables → Actions → Repository secrets**:

| Secret | Value | Notes |
| --- | --- | --- |
| ☐ `SUPABASE_PROJECT_ID` | `wwfnsbilmyxeawgzicmv` | The production project every module PR's post-merge push has targeted |
| ☐ `SUPABASE_ACCESS_TOKEN` | personal access token, **scoped to the org owning `wwfnsbilmyxeawgzicmv`** | Dashboard → Account → Access Tokens. **Org matters:** the worklog records repeated 403s because the CLI token's account belonged to a different org than the linked project (`lddflxhsjfcrpcybrpxu`). Mint under the right account, name it `github-actions-db-push`, reuse it — the 20-token cap is real |
| ☐ `SUPABASE_DB_PASSWORD` | the project's database password | Reset available at Dashboard → Project Settings → Database if not stored |

Until all three exist, the workflow's first step fails with an explicit `MISSING: …` message naming this doc (fail-loud, fail-informative — by design, not a red-herring failure).

## Rollback

Disabling the workflow = revert `.github/workflows/supabase-deploy.yml` (single file). Post-merge pushes become manual again (`supabase db push --project-ref wwfnsbilmyxeawgzicmv`). The concurrency group, `workflow_dispatch` runs, and step summaries leave no residue on the project itself.

---

## Gates

| Gate | Result |
| --- | --- |
| Workflow YAML | `js-yaml` parse clean (actionlint not installed locally; expressions/`inputs` context hand-reviewed against the dispatch-boolean shape) |
| `pnpm lint` | exit 0, **0 errors, 71 warnings** (exact pre-change baseline — no app code touched) |
| `pnpm exec tsc --noEmit` | clean |
| `pnpm build` | exit 0 |
| `pnpm test` | n/a — no app or test code changed in this PR (CI runs it anyway) |

## Out of scope (per prompt)

- Staging-first pipeline (elite-staging project is INACTIVE — restoring it is a separate decision)
- Edge function deploys, seed automation

## Post-merge verification (60 seconds)

1. **Actions → "Supabase DB Push — migrations" → Run workflow** with `dry_run = true` → green run, summary lists pending migrations (or "up to date"), nothing applied.
2. Re-run with `dry_run = false` → pending migrations apply; step summary shows `migration list`.
3. Merge any PR touching `supabase/migrations/**` → the workflow triggers automatically on the master push and the manual-push line in its PR body can be dropped from then on.

## References

- `docs/GITHUB_SECRETS_SETUP.md` — secrets setup (extended here)
- `.github/workflows/deploy.yml` — secret-handling idiom (env-var indirection, fail-closed checks) and the staging/production separation context
- `docs/agent-worklog.md` — the 403 org-mismatch history that motivates the token-scoping note
- PR-BODY-payroll-vehicles-wiring.md / PR-BODY-approvals-module.md — the "Post-merge: `supabase db push`" convention this PR retires
