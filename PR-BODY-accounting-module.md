# Accounting Module (Invoices / Expenses / Payments) — Prompt I

Closes the accounting prompt: a NEW `/payments` list surface, journal entry-lines drill-down on `/accounting`, and the real financial KPIs the dashboard has been missing since #55 explicitly refused to fabricate them. Everything composes over the existing accounting stack (027 journal/finance_payments, 038 invoice engine, 021 expenses, 048–050 payments engine, 051 vat_reconciliation) — **zero new tables, zero new RPCs**.

Branch: `feat/accounting-module` (off `8c4e2db` = #55)

---

## What shipped

### 1. `/payments` — NEW surface (the missing list index)
`finance_payments` (migration 027) had NO list surface anywhere — only allocation indexes on `payment_allocations` existed. This page is its first index:

- **KPI cards**: payments count · receipts in (SAR) · payments out (SAR) · unallocated (SAR, `pending` + `partially_allocated`)
- **Columns**: ref (`payment_ref`, mono) · direction chip (`in` = تحصيل / `out` = سداد) · dual date (`formatDualDate` Hijri) · amount SAR · method (5 enum values, ar/en) · status chip (4 enum values) · customer/supplier (`name_ar` via FK embed) · allocation ref (deep link: `in` → `/invoices`, `out` → `/expenses`)
- **CSV export**: RFC-4180 + **UTF-8 BOM** (repo convention; accounting's `csv-utils.toCsv` is BOM-less, so the page uses the BOM-capable `dashboard-utils.toCsv` — chosen deliberately for Arabic-safe Excel opens)
- Loading / error / empty states; browser `createClient()` read (RLS-bound), matching every existing accounting page; soft-delete filter `.is("deleted_at", null)`; limit 100, newest first

### 2. `/accounting` — journal entry-lines drill-down (the missing depth)
The journal tab listed headers only and never fetched `journal_entry_lines`. Now each row expands in place:

- Chevron toggle per row (aria-expanded) → fetch `journal_entry_lines` filtered by `journal_entry_id` (`idx_jel_entry`, 027) with **embedded `chart_of_accounts(account_code, name_ar, name_en)`** — no join round-trip
- Lines table: account code + localized name · description · debit · credit, with a **debit/credit totals row** (proof-at-a-glance that the entry balances)
- Lines cached per entry; busy spinner and error state on the toggle; single-sided `chk_line_single_side` guarantees exactly one of debit/credit renders per line

### 3. `/dashboard` — the unblocked financial KPIs
Replaces the #55 "not restored" gap with real sources (`src/lib/accounting/kpis.ts`, NEW — server-only `"use server"` module; sales invoices by `issue_date` window + pending issued-not-paid read + expenses by `expense_date` window; graceful `available:false` like every other block):

| Card | Source | Deep link |
|---|---|---|
| Invoice Revenue (period, vs prev) | `invoices` sales, `idx_invoices_tenant_date` | `/invoices` |
| Pending Invoices (amount) | `invoices` issued-not-paid, `idx_invoices_tenant_status` | `/invoices` |
| Expenses (period, vs prev) | `expenses`, `idx_expenses_active` | `/expenses` |
| Net Result (revenue − expenses) | both | `/accounting` |

- `AccountingKpis` added to `DashboardSnapshot`; KPI CSV snapshot export extended with the 4 accounting rows (`KPI_CSV_META` + accounting block in `exportCsv`)
- `metric()` (private in actions.ts) hoisted to client-safe `buildMetric()` in `dashboard-utils.ts` — single source of truth for the delta/pct rounding + the previous=0 rule (100% only when there IS a value); +4 vitest tests
- ar/en translations: 4 `fin*` dashboard keys + `nav.payments` (both sections of `types.ts` AND `translations.ts`)
- Sidebar + command-palette entries for `/payments` (`CreditCard` icon, finance group)

---

## Coverage table

| Surface | Tables read | Writes | Handlers | Audit row shape | Deep links |
|---|---|---|---|---|---|
| `/payments` (NEW) | `finance_payments` (+ embedded `customers`, `suppliers`) | **none** — read-only list (mutations stay in the existing `recordPayment`/`voidPayment` flows) | client-side `load`, `exportCsv`, search filter | n/a (no writes) | `/invoices`, `/expenses` |
| `/accounting` journal drill-down | `journal_entry_lines` (+ embedded `chart_of_accounts`) | none — read-only expand | `toggleEntryLines` (fetch-once cache) | n/a | n/a |
| `/dashboard` financial KPIs | `invoices` (sales, window), `expenses` (window) | none — read-only aggregates | `getFinancialKpis` (server action, RLS-bound), `buildMetric` (pure) | n/a | `/invoices`, `/expenses`, `/accounting` |
| CSV exports | — | — | `/payments` page export; dashboard KPI snapshot (extended) | n/a | columns in-file |

Every pre-existing mutation on these tables (`recordPayment`, `voidPayment`, `postJournalEntry`, invoice lifecycle) already writes its `audit_log` row per the #51 contract — nothing new writes, so no new audit shape is introduced.

---

## Migration: `20260928000000_accounting_surfaces.sql`

**Two indexes, both individually justified** — idempotent `CREATE INDEX IF NOT EXISTS`, partial on `deleted_at IS NULL`, forward-only with rollback notes:

1. `idx_finance_payments_tenant_date ON finance_payments(tenant_id, payment_date DESC) WHERE deleted_at IS NULL` — the `/payments` list + CSV export scan path (tenant-scoped, newest-first). **finance_payments had NO tenant-leading index at all** before this migration; the page's ORDER BY shape had no support whatsoever.
2. `idx_finance_payments_tenant_status ON finance_payments(tenant_id, status) WHERE deleted_at IS NULL` — status-chip filtering, the unallocated KPI (`status IN ('pending','partially_allocated')`), and the void action's status guard.

**No new RPCs**: in-app composition is a handful of bounded reads (≤100-row windowed lists + 3 aggregate reads over indexed columns) — nothing "genuinely too heavy" to justify a SECURITY DEFINER RPC.

**No new tables**: every surface composes over 027/038/021/048–050/051. The prompt's assumption that the accounting stack was missing was wrong in the best way — the audit found ~9.5k lines of production accounting lib + 2,500-line `/accounting` page already live; this PR adds only the missing read surfaces.

---

## pgTAP: `066_accounting_module_tests.sql` — plan(22) = 22 ok

1. **Migration indexes (3)** — both new indexes exist with partial predicates verified via `indexdef` LIKE; date index verified `payment_date DESC`
2. **Read-path re-assertion (3)** — `idx_invoices_tenant_date`, `idx_invoices_tenant_status`, `idx_expenses_active` (drift-proofing for the KPI read paths)
3. **Journal immutability (5)** — draft→posted lands (balanced fixture passes JRN004's balance-on-post); posted edit refused (JRN001); un-post refused (JRN001); posted delete refused (JRN003); posted→reversed is the sanctioned exit, then frozen (JRN002)
4. **Invoice enum shape (1)** — all 8 `invoice_status` states
5. **finance_payments CHECK guards (3)** — zero amount refused (`chk_finance_payment_amount`), invalid direction refused (direction CHECK), valid in/out/void fixtures land
6. **RLS (6)** — anon-zero across `finance_payments`/`invoices`/`expenses`/`journal_entries`/`journal_entry_lines`; authenticated sees own tenant rows; **real tenant-B user sees zero of tenant A** (tenant resolved via `public.users.auth_user_id`, not a spoofable claim)

Fixture discipline per 064: fixed-UUID namespace (`13111111-…` tenant A, `13222222-…` tenant B, `_invite_provisioned` auth contract), insert-if-absent + **delete-and-reinsert self-repair for the journal entry** (a committed prior run leaves it `reversed`, and JRN002 forbids resetting it — this is why suite runs commit at EOF and must self-repair).

## Full-suite result (fresh rebuild)

```
supabase db reset          → all 57 migrations + 20260928000000 applied, seed ok
pgTAP (11 files)           → 328 ok, 0 not ok, 0 psql ERROR (was 306)
066_accounting_module_tests → 1..22, 22 ok, exit 0 (proven re-runnable ×3)
```

---

## Gates (ALL green)

| Gate | Result |
|---|---|
| `pnpm lint` | exit 0 — **0 errors, 71 warnings** (at the pre-existing baseline; no new warnings) |
| `tsc --noEmit` | exit 0 |
| `pnpm test` | **509/509** across 41 files (was 505; +4 `buildMetric` tests) |
| `pnpm build` | exit 0 — `/payments` route present in the manifest |
| pgTAP fresh rebuild | `supabase db reset` + 11 suites → **328 ok / 0 fail** |
| Anti-goal sweep | clean on changed files (hits are pre-existing `searchPlaceholder` i18n keys + ZATCA sandbox copy) |
| Conflict markers | clean |

## How to verify in 60 seconds

1. `pnpm dev` → sign in → **/payments** — KPI cards, direction/status chips, search, Export CSV (opens with Arabic intact — BOM), allocation ref links to `/invoices` or `/expenses`
2. **/accounting** → Journal tab → click any row's chevron → lines expand with CoA code/name + debit/credit totals; totals match (balanced entries only ever post)
3. **/dashboard** → new "Accounting" KPI section (Invoice Revenue / Pending Invoices / Expenses / Net Result) → click a card → lands on the right surface; Export CSV → 4 new `fin*` rows at the bottom
4. `npx supabase db reset && docker exec -i supabase_db_nextjs-version psql -U postgres -d postgres -tA --single-transaction < supabase/tests/066_accounting_module_tests.sql` → `1..22`, 22 ok, exit 0

## Migration note (post-merge push)

Post-merge schema push is automated by **#54**: `.github/workflows/supabase-deploy.yml` runs `supabase db push --include-all` against `wwfnsbilmyxeawgzicmv` on every change to `supabase/migrations/**` on master — **IF** the three repo secrets (`SUPABASE_PROJECT_ID`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`) are set (steward action, unverified). Manual fallback if the workflow skips or fails:

```bash
supabase db push --project-ref wwfnsbilmyxeawgzicmv
```

## Worklog (inline, not committed)

- Audited the live schema before writing anything: 031–036 journal hardening, 038 invoice engine, 021/063 expense engine, 048–050 payments engine, 051 VAT recon — the stack was already far more complete than the prompt assumed, so the scope became "missing read surfaces + KPI unblock", exactly what #55 deferred.
- `buildMetric` hoist: `metric()` was file-private in a `"use server"` module — the client needed identical rounding, so it moved to the client-safe utils file with tests. The `previous=0 → 100%` rule is preserved verbatim.
- Chose BOM CSV on the new page over accounting's BOM-less `toCsv` — Arabic labels in Excel; RFC-4180 escaping identical.
- Fixed a self-inflicted corruption mid-session: an escaped `\r` in a file edit embedded a stray CR plus two junk "tag" tokens into accounting/page.tsx (175 parse errors). Cleaned to `      )` via awk and verified via the TS parser API before moving on.
- Hit the classic two-stack trap: `supabase db reset` rebuilt `supabase_db_nextjs-version` while I was first testing against a stale second stack (`supabase_db_elite-dev-2026`, different project). All pgTAP numbers above are from the correct container.
- 066 initially plan(21)/22-ok — my count vs my own header; the committed-fixture JRN002 trap (reverse-d state survives EOF commit; cannot UPDATE back) was caught by the double-run and fixed with delete-and-reinsert repair.
- Out of scope (backlog-note only, per prompt): ZATCA live submission UI (adapter + CSID onboarding exist), bank reconciliation UI (tables + triggers exist in 027), multi-currency, WPS bank files / payslip PDFs (payroll backlog #53).
