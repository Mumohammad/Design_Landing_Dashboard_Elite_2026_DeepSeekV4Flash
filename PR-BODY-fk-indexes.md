# FK Index Coverage — production perf hardening (Prompt J)

One migration, **279 indexes**, zero schema/constraint/data changes. Generated programmatically from the repo's own catalog — not hand-eyeballed.

Branch: `perf/fk-indexes` (off master `61dbb5d` = #56)

---

## Method (audit-driven)

1. Fresh local rebuild (`supabase db reset` — all 58 migrations incl. this one at the end).
2. Ran the prompt's audit query against the local rebuild → **288 unindexed FKs** (before). The prod audit reported 282 on 2026-09-29; the small delta is index-coverage drift between the prod snapshot and this repo's migrations — the repo is the schema source of truth, and every number below is from the repo's own catalog.
3. Resolved each gap FK's columns in **constraint order** (`conkey` + `WITH ORDINALITY` → `pg_attribute`) so composite FKs would get composite indexes — the audit found **zero composite FKs**; all 288 gaps are single-column.
4. Generated `CREATE INDEX IF NOT EXISTS idx_<table>_<first_fk_col> ON public.<table> (<col>);` per gap (prompt naming rule).

## Numbers

| | |
|---|---|
| Gap-list rows (before) | **288** |
| Indexes created | **279** |
| Skipped (judgment call) | **9** |
| Gap-list rows (after) | **9** — exactly the skipped FKs, nothing else |
| Name collisions with pre-existing indexes | **0** (verified via `pg_indexes` diff) |
| Intra-batch duplicate statements | **0** (verified `sort -u`) |
| Max identifier length | 52 chars (PostgreSQL limit 63) |
| Total public indexes | 296 → **575** (+279, verified) |

### Skipped FKs (9) — with reasons

Prompt's judgment-call list of lookup/type tables with 100% certainty of staying tiny:

| Table | Skipped FK columns | Reason |
|---|---|---|
| `delivery_platforms` | `tenant_id`, `created_by`, `updated_by` | Lookup table (handful of rows/tenant); seq scans of the FK proof are cheaper than the index upkeep |
| `leave_types` | `tenant_id`, `created_by`, `updated_by` | Lookup table, same rationale |
| `violation_types` | `tenant_id`, `created_by`, `updated_by` | Lookup table, same rationale |
| `expense_category_mappings` | — | In the prompt's skip set but has **zero gap**: its only FK is already indexed |
| `report_job_status` | — | In the prompt's skip set but has **no FK constraints at all** (zero-gap, nothing skipped) |

## Before / after audit output

Before (288 rows) — head:

```
accounting_periods|accounting_periods_closed_by_fkey
accounting_periods|accounting_periods_created_by_fkey
accounting_periods|accounting_periods_opened_by_fkey
accounting_periods|accounting_periods_updated_by_fkey
attendance_periods|attendance_periods_created_by_fkey
attendance_periods|attendance_periods_locked_by_fkey
attendance_periods|attendance_periods_updated_by_fkey
audit_log|audit_log_actor_id_fkey
bank_accounts|bank_accounts_created_by_fkey
bank_accounts|bank_accounts_tenant_id_fkey
...
```

After (9 rows — the intentional skips only):

```
leave_types|leave_types_tenant_id_fkey
leave_types|leave_types_created_by_fkey
leave_types|leave_types_updated_by_fkey
violation_types|violation_types_tenant_id_fkey
violation_types|violation_types_created_by_fkey
violation_types|violation_types_updated_by_fkey
delivery_platforms|delivery_platforms_tenant_id_fkey
delivery_platforms|delivery_platforms_created_by_fkey
delivery_platforms|delivery_platforms_updated_by_fkey
```

**The audit query now returns zero rows for every non-skipped table.**

## Why plain non-partial btree indexes

- **Non-partial on purpose**: a partial index (e.g. `WHERE deleted_at IS NULL`) does not satisfy the audit's `i.indpred IS NULL` predicate — and worse, `ON DELETE CASCADE` must proof-scan *every* child row, including the soft-deleted rows a partial index excludes.
- **Non-CONCURRENTLY on purpose**: `supabase db push` runs in a transaction where `CREATE INDEX CONCURRENTLY` cannot run (ZTD STOP rule forbids alternate paths). On the empty/staging stage this is instant. On prod, the push is queued by the #54 workflow (`concurrency group: db-push-master`, `cancel-in-progress: false`) and each index takes a brief `AccessExclusive` lock; **prefer a low-traffic window for the merge**.
- `IF NOT EXISTS` everywhere: idempotent, re-runnable, drift-proof.

## Test mapping (prompt scripts don't exist in this repo)

`npm run test:rls` and `npm run test:critical-paths` are **not defined** in `package.json` (repo scripts: `test`, `test:e2e`). Mapped to this repo's real equivalents, per the "no alternate paths" STOP rule being about migration failure — not test naming:

| Prompt intent | Repo equivalent | Result |
|---|---|---|
| RLS tests | pgTAP suites 010/013/036-coverage/058/060 within the full suite | all ok |
| Critical paths | Full pgTAP suite (11 files, incl. 066 accounting + 064 payroll wiring) | **328 ok / 0 fail** |
| Unit tests | `pnpm test` (vitest) | **509/509** |
| Typecheck | `tsc --noEmit` | exit 0 |

Index additions cannot affect RLS (evaluated per-row, index-agnostic) — confirmed by the suites above.

## Verification

1. **Audit → zero for non-skipped**: after-count = 9, all inside `{leave_types, violation_types, delivery_platforms}` ✔
2. **Fresh DB applies cleanly**: `supabase db reset` (all 58 migrations + seed) then full pgTAP suite → 328 ok, 0 `not ok`, 0 psql ERROR; post-reset gap count re-verified = 9 ✔
3. **pgTAP full suite**: 328 ok / 0 failed ✔
4. **vitest**: 509/509 ✔ · **tsc**: clean ✔
5. All 279 index names from the migration file exist in `pg_indexes` after reset (0 missing) ✔

## Migration note (post-merge push)

Post-merge push is automated by **#54** (`.github/workflows/supabase-deploy.yml`, `supabase db push --include-all` on `supabase/migrations/**` → master) **IF** the three repo secrets are set (steward action, unverified). Manual fallback:

```bash
supabase db push --project-ref wwfnsbilmyxeawgzicmv
```

## Worklog (inline, not committed)

- Gap list generated from the catalog, never eyeballed: audit query + `conkey`-ordinality column resolution in one SQL pass; migration body emitted by `format()` from the same query, so file and ground truth can't diverge.
- Verified zero name collisions against all 296 pre-existing index names before writing; naming needed no `_fk` suffixes (no table|first-col duplicates in the gap set).
- First file-assembly attempt (bash while-loop over 279 lines) timed out on Git Bash process-spawn overhead and left a partial file — caught it (`222 lines` vs expected), deleted, regenerated atomically with a single awk pass (466 lines, 279 statements).
- Local count 288 vs prod audit 282 documented as snapshot drift; repo is source of truth.
- `test:rls` / `test:critical-paths` don't exist in package.json — mapped to the repo's real gates rather than inventing scripts (documented above).
- ZTD held: single migration, indexes only, no DROP/ALTER/data, no alternate paths needed — nothing failed, so no STOP.
