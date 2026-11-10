# Approvals Module (Prompt E)

One inbox for every pending decision: `/approvals` composes expenses, driver leave requests, and driver applications into a single oldest-first queue (capped read RPC, KPI chips, type + date filters, CSV export, approve/reject with a mandatory reason), guarded by atomic decision RPCs, with an `audit_log` row on every decision.

> **Archived-v1, superseded:** #38 (approvals). Its intent is mined (one place to decide things), none of its code is cherry-picked.

**Composed, not invented.** All three decision sources pre-exist (expenses 021, driver_leave_requests 018, driver_applications 029/030) — this PR adds zero new domain tables. What's genuinely new: the unified capped read RPC, two atomic decision RPCs for the sources that lacked one, queue predicate indexes, and the surface. Expense approvals **reuse** the existing FX-06 `approve_expense_atomic` (063) instead of duplicating it.

---

## Part 1 — Surface (`/approvals`, new route)

### Route/use-case coverage table (live DB facts per row)

| Route / use-case | Reads (tables / functions) | Writes | Handlers / notes |
| --- | --- | --- | --- |
| `/approvals` — unified queue (oldest-first) | `expenses` (is_approved=false) + `driver_leave_requests` (status='pending') + `driver_applications` (submitted/under_review) via `fetch_pending_approvals()` RPC — tenant-scoped, `ORDER BY requested_at ASC`, cap clamped in SQL (default 50 / max 100) | **none** | `fetchApprovalsPage()` (`src/lib/approvals/queries.ts`) — admin client behind `requirePermission`; tenant from `getCurrentUser()` only, never the browser |
| `/approvals` — filters (type, date range) | applied **server-side** inside the RPC (`p_type/p_from/p_to`) | **none** | Filter state re-fetches the capped page; type narrows to one source |
| `/approvals` — KPI chips | computed from the fetched page only (total, per-type counts, stale > 3 days) | **none** | Page-scoped live facts — no fabricated values (drivers/users/audit precedent) |
| `/approvals` — CSV export | client-side over the fetched rows (≤ cap) | **none** | `approvalsToCsv()` (RFC-4180 escaping, UTF-8 BOM); requester masked per PDPL state before export |
| `/approvals` — approve/reject an **expense** | — | `approve_expense_atomic` (FX-06, pre-existing: claims row + payable + event, one transaction) for approve; **guarded conditional UPDATE** (claims the `is_approved=false` row) for reject — expenses have no rejected terminal state, so the decision lives on the audit trail | `decideExpense()` — `requirePermission("expenses","approve")`; `EXP002` ⇒ graceful `alreadyDecided` |
| `/approvals` — approve/reject a **leave request** | — | `decide_leave_request_atomic` (this PR): conditional UPDATE claims the pending row (0 rows ⇒ LVE002), approve flips the driver to `on_leave` via `set_driver_status`, reject persists the mandatory reason in `review_notes` | `decideLeaveRequest()` — `requirePermission("attendance","approve")`; `LVE002` ⇒ graceful `alreadyDecided` |
| `/approvals` — approve/reject an **application** | — | `decide_application_atomic` (this PR): conditional UPDATE claims the pre-decision row (0 rows ⇒ APP002), persists `reviewed_by`/`reviewed_at`/`review_note` (030 columns; `reviewed_by` = custom `users.id` per that migration's convention) | `decideApplication()` — `requirePermission("hr","approve")`; `APP002` ⇒ graceful `alreadyDecided` |
| Every decision — audit + UX | `audit_log` | `writeAuditLog()` per decision (`from/to/reason/surface:"approvals_inbox"`), module-tagged `expenses`/`attendance`/`hr` | Webhook `expense.approved` re-emitted on the FX-06 path; `revalidatePath` for `/approvals` + source modules |
| `/approvals` — decision dialog | — | via the three actions above | Mandatory reason (zod 5–500 chars, server + client parity), confirm-destructive on reject, stale-item guard surfaces "already decided" instead of a 500 |
| Loading / empty / error | — | — | `EnterpriseModulePage` skeleton rows; bilingual empty states (queue-empty vs no-matches); `loading.tsx` + `error.tsx` (digest ref only, no SQL internals) |
| Nav | — | — | `app-sidebar.tsx` + `command-search.tsx` wired with `t.nav.approvals`; i18n keys added to **both** locales |

### Two reviewer id-spaces (deliberate)

`driver_leave_requests.reviewed_by` → `auth.users(id)` (018), `driver_applications.reviewed_by` → custom `users(id)` (030). The actions pass `currentUser.authUserId` vs `currentUser.id` respectively — the same distinction the audit module hit (`actor_id` vs `users.id`), encoded in the RPC signatures.

### Explicitly deferred

- **Bulk decisions** — one row at a time for this PR; the atomic RPCs make bulk a thin loop later.
- **Realtime queue updates** — manual Refresh + filter-driven re-fetch (repo pattern).
- **Delegations / out-of-office routing, SLA escalation** — the `stale > 3 days` chip is the floor, not the ceiling.

## Part 2 — Migration + pgTAP

**Migration (this PR):** `20260926120000_approvals_module.sql` — idempotent, forward-only.

1. **Queue predicate indexes:** 2 new — `idx_leave_requests_pending_queue` (018's pending index is not `IF NOT EXISTS`, so the surface ships its own guarded equivalent on `(tenant_id, requested_at)`) and `idx_driver_apps_pending_queue` (`driver_applications` had **no** submitted/under_review partial index at all) — plus 2 re-asserted `IF NOT EXISTS` (`idx_expenses_pending_approval` from 021, `idx_driver_apps_review_queue` from 030) for drift-proofing.
2. **`fetch_pending_approvals(p_tenant, p_type, p_from, p_to, p_limit)`** — SECURITY DEFINER, `STABLE`, pinned `search_path=public`, UNION ALL over the three sources, oldest-first, cap clamped in SQL (`LEAST(GREATEST(COALESCE(p_limit,50),1),100)`, same convention as `fetch_audit_trail_page`). EXECUTE revoked from PUBLIC/anon, granted to `authenticated, service_role`. PDPL: the applications projection never carries the raw mobile — only a presence flag.
3. **`decide_leave_request_atomic`** — LVE003 (invalid decision) / LVE004 (rejection reason required) before any write; conditional UPDATE claims the row (0 rows ⇒ LVE002 already decided — the race arbiter, 063 expense-RPC parity); approved leave calls `set_driver_status(...,'on_leave',...)` (drivers-module contract). Service-role only.
4. **`decide_application_atomic`** — APP003/APP004 mirrors, claims `submitted/under_review` rows (0 rows ⇒ APP002), persists the 030 review columns. Service-role only.

**Fresh-rebuild proof** (`supabase db reset` → `CREATE EXTENSION pgtap` → every suite with `-tA --single-transaction`):

```
PASS 010_full_rls_test_suite.sql        — 109/109
PASS 011_track1_rpc_grants_tests.sql    —  25/25
PASS 012_drivers_module_tests.sql       —  41/41
PASS 013_sensitive_tables_rls_tests.sql —  24/24
PASS 058_rls_security_tests.sql         —   1/1
PASS 060_behavioral_rls_tests.sql       —  10/10
PASS 061_users_module_tests.sql         —  28/28
PASS 062_audit_trail_tests.sql          —  25/25
PASS 063_approvals_module_tests.sql     —  34/34   ← NEW
────────────────────────────────────────────────
pgTAP Results: 297/297 passed, 0 failed  (plan counts proven, zero `not ok`, zero psql ERROR lines)
```

**Suite `063_approvals_module_tests.sql` (34 tests)** proves: RPC security shape (SECURITY DEFINER + pinned search_path; anon denied; authenticated + service_role granted; both decision RPCs service-role-**only**); **behavioral queue** (composes all three sources, definer never crosses tenants even when the other tenant's row is older, oldest-first ordering, type filter, date-range filter, cap clamp asserted in the function definition); RLS tenant isolation + anon-zero on every source; **leave decisions** (approve claims + flips driver `on_leave`, LVE002 double-decision, LVE004 mandatory reason, reason + `auth.users` reviewer persisted, LVE003 invalid decision); **application decisions** (approve claims + persists the `users.id` reviewer, APP002 double-decision, APP004 mandatory note, decided rows leave the queue); all 4 queue indexes with their partial predicates.

**Two pgTAP traps this suite documents so the next suite doesn't rediscover them:**

- **`plan(N)` must equal the actual assertion count.** The suite grew by three split asserts while the plan still read 30 — `finish()` printed "planned 30 but ran 33" and the CI runner (any plan mismatch = failed file) rejected it. Now `plan(34)` with a header note.
- **One SQL statement must never both call the data-modifying RPC and read the row it wrote.** The application-approve assert originally combined `(RPC(...) ->> 'decision') = 'approved' AND (SELECT reviewed_by ...) = ...` in one `is()`. Postgres evaluates a statement's volatile function and its snapshot-taking subplans in **unspecified order** — the read could take the pre-update snapshot and see `reviewed_by = NULL`, flipping the AND to NULL (`have: NULL`). It reproduced only in the full-runner sequence (planner/statistics state differs after prior suites) and never in isolation — a textbook heisenbug. Split into two asserts (section 5 already did this; 6 now matches), with the rule written into both section headers.

**Leak discipline.** `--single-transaction` does NOT stop on errors — the pre-abort portion COMMITs at EOF (worklog gotcha from #51), so failed runs leak fixtures and later suites inherit them. 063's fixtures are therefore **self-repairing**, not merely guarded: insert-if-absent everywhere, decision-state resets (undoes leaked approvals on the shared fixed-UUID rows), the shared `users.5555…` row is **upserted to `general_manager`** (062 owns the same UUID with `role='supervisor'` — a 062 leak would otherwise leave this suite's reviewer under-privileged), and the shared driver is reset from `on_leave` (a leaked approved leave would break the approve transition). 063 passed 34/34 on the fresh rebuild, on immediate re-runs over its own committed fixtures, and on top of 061/062 leaked state. (061/062 themselves still fail on bare re-runs without a reset — pre-existing from Prompts C/D, untouched here; CI always resets first.)

## Part 3 — Saudi compliance / PDPL

- **PDPL masking:** the queue RPC never projects applicant mobile/identity numbers (presence flag only); applicant display names are masked per the users-module consent gate (`has_user_pdpl_consent`, batched per distinct requester, fail-closed ⇒ masked) before render **and** before CSV export.
- **Hijri dual dates:** pending-age + timestamps via the shared formatting helpers (Gregorian + Umm al-Qura, AR/EN aware).
- **Arabic copy parity:** every UI string bilingual (KPIs, filters, dialog, empty states, error toasts) — users/audit inline-string convention.
- **AIDesigner lock:** `EnterpriseModulePage` shell, `rounded-2xl` glassmorphic toolbar, KPI chips, module badge dots in brand palette, `dir="ltr"` on UUIDs/JSON/emails — no new tokens, no keyframe inventions.

### Anti-goal sweep

```
grep -rin 'mock\|TODO\|FIXME\|lorem' \
  src/lib/approvals "src/app/(dashboard)/approvals" \
  supabase/migrations/20260926120000_approvals_module.sql \
  supabase/tests/063_approvals_module_tests.sql
→ 0 hits outside test files. No mock data, TODOs, FIXMEs, or lorem anywhere
  in the module; no merge-conflict markers in the tree.
```

### Gate results

| Gate | Result |
| --- | --- |
| `pnpm lint` | exit 0, **0 errors, 77 warnings** (≤ 78 baseline — one pre-existing warning vanished in a file this branch never touched) |
| `pnpm exec tsc --noEmit` | clean |
| `pnpm test` | **466/466** (38 files; +35 approvals tests: 22 utils + 13 actions) |
| `pnpm build` | exit 0, `○ /approvals` emitted |
| pgTAP fresh rebuild | **297/297** (263 baseline + 34 new) |
| Anti-goal / conflict-marker sweep | clean |

## Agent worklog entry (chat context only — not committed)

```
## 2026-09-26 — Approvals Module (Prompt E) — v4-flash
Branch: feat/approvals-module (off master afdd3e2). Supersedes archived-v1 #38.
Shipped: /approvals unified inbox composing 3 pre-existing decision sources
(expenses is_approved=false / leave_requests pending / applications
submitted+under_review) via fetch_pending_approvals (SD/pinned/capped 100/
oldest-first); decide_leave_request_atomic (LVE002/003/004, set_driver_status
on approve) + decide_application_atomic (APP002/003/004, users.id reviewer per
030); expense decisions REUSE approve_expense_atomic (FX-06). Every decision:
requirePermission + zod reason 5-500 + writeAuditLog(surface=approvals_inbox)
+ alreadyDecided graceful stale handling. DB: 20260926120000 (2 new partial
queue indexes + 2 re-asserted; 3 RPCs; service-role-only decisions).
Tests: 063_approvals_module_tests.sql 34/34; vitest 466/466 (+35).
Gates: lint 0 err (77 warn <= 78 baseline), tsc 0, build 0 (○ /approvals),
pgTAP 297/297 fresh rebuild.
Gotchas: plan(N) MUST equal assert count — finish() diagnostics fail the CI
runner; NEVER combine a mutating RPC + a read of its row in one SQL statement
(unspecified subplan snapshot order ⇒ nondeterministic pre-update read, the
"have: NULL" heisenbug) — split into two asserts; --single-transaction commits
at EOF even on success, so fixtures are permanent and suites must self-repair
(upsert shared users row — 062 owns same UUID as supervisor; reset shared
driver from on_leave; reset decision state on shared rows).
Post-merge: supabase db push --project-ref wwfnsbilmyxeawgzicmv.
Deferred: bulk decisions, realtime, delegations/SLA.
```

## How to verify in 60 seconds

1. `pnpm dlx supabase db reset` → `CREATE EXTENSION pgtap` → run `supabase/tests/063_approvals_module_tests.sql` → `1..34`, zero `not ok`.
2. `psql ... -c "SELECT has_function_privilege('authenticated','public.decide_leave_request_atomic(uuid, uuid, text, text, uuid)','EXECUTE')"` → `false` (service-role boundary).
3. Sign in as GM → **/approvals**: KPI chips (total / expenses / leaves / applications / stale), oldest-first queue mixing all three source types.
4. Set **Type = leave_request** → only leave rows; set a **date range** → list narrows server-side.
5. **Reject** any item → the dialog demands a reason (5–500 chars); after confirm the item leaves the queue and an `audit_log` row with `surface:"approvals_inbox"` appears in **/audit-log**.
6. Double-submit (open the same item in a second tab before deciding) → the second decision reports "already decided" instead of erroring.

**Post-merge:** `supabase db push --project-ref wwfnsbilmyxeawgzicmv` (staging first, then prod).

## Backlog (explicitly out of scope here)

- Bulk approve/reject (thin loop over the atomic RPCs once UI lands).
- Realtime queue subscriptions; delegations / out-of-office; SLA escalation beyond the 3-day stale chip.
- Making 061/062 leak-proof on bare re-runs (pre-existing; CI resets first).

## References

- `docs/phase-2-schema-plan.md` — expenses (§ 021), attendance/leave (§ 018), driver applications (§ 029/030), audit_log (ADR-007)
- `docs/phase-2-auth-plan.md` §7 (authorization boundary), §9 (audit writes)
- Expense race arbiter precedent: `063_expense_approval_race.sql` (FX-06) — the conditional-UPDATE claim pattern both decision RPCs follow
- Drivers/users/audit precedent: #48/#49/#50/#51 (`writeAuditLog` payload anatomy, consent gate, CSV, module shell)
- `PR-BODY-audit-trail.md` — surface/PR conventions followed
