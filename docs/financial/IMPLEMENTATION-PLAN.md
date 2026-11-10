# Financial Implementation Plan

> **Status:** Plan only. **Do NOT execute any phase now.**
> Prerequisite for every phase: Supabase project configured, migrations 001–030 applied (including **027_accounting**), `@supabase/ssr` installed, GM user created, demo mode available.

**Global ordering rule:** the phases below follow dependency order. Deviate only if repository analysis during a phase proves a different dependency.

---

## PHASE 0 — Architecture (this document set)
- **Done.** Docs: MASTER, ACCOUNTING, INVOICE, VAT, ZATCA-BOUNDARY, DATABASE-DESIGN, EVENT-MODEL, SECURITY-DESIGN, IMPLEMENTATION-PLAN, TEST-STRATEGY.
- **Approval gate:** finance owner reviews & approves the CoA, VAT recoverability rules, invoice numbering, and the event model before any migration is written.

## PHASE 1 — Accounting foundation (verify + apply)
- Apply `027_accounting.sql` if not applied; verify RLS, sequences, triggers, seeds.
- Verify `createChartAccount` / `postJournalEntry` / `createReceivable` against the schema.
- Add DB-level journal balance CHECK trigger (defense-in-depth).
- **Validation:** journal immutability (JRN001–003), period rejection on closed, tenant isolation.

## PHASE 2 — Chart of Accounts
- CoA CRUD UI (bilingual) + actions (create/update/deactivate) — reuse `EnterpriseModulePage`.
- CoA import/export (CSV), account opening balances, per-tenant defaults.
- **Validation:** code uniqueness, type/normal-balance consistency, parent validation.

## PHASE 3 — Journal Engine
- Reversal entry flow (post reversal of a posted entry with linkage).
- Journal approval workflow (optional `journal_approvals`: submit → approve → post).
- Period-close action (open → closing → closed) + reopen with reason.
- DB function `post_journal(...)` for atomic journal+lines+event insert.
- **Validation:** reversal math, closed-period blocking, atomicity under simulated failure.

## PHASE 4 — Customer/Supplier foundation
- CRUD actions + UI for `customers` and `suppliers` (bilingual, tax_number, credit limit).
- **Validation:** tenant scoping, code sequences, tax_number format (15-digit placeholder rule), no real data.

## PHASE 5 — Invoice Engine
- Migrations: `invoices`, `invoice_lines`, `credit_notes`, `debit_notes` + numbering sequences + immutability triggers + RLS.
- Server Actions: create draft, issue, **finalize** (compute subtotal/VAT/total server-side, NUMERIC), cancel (unpaid only), credit/debit note issuance.
- Emit `InvoiceFinalizedEvent` / `InvoiceCancelledEvent` / `CreditNoteIssuedEvent` / `DebitNoteIssuedEvent` into `financial_events`.
- UI: invoice list + detail (reuse EnterpriseModulePage), bilingual.
- **Validation:** finalized immutability, math correctness (mock invoice 100,000/15,000/115,000), numbering.

## PHASE 6 — Invoice PDF + Print + QR
- `buildInvoiceHtml()` (A4, bilingual, RTL) from the existing `document-html.ts` pattern.
- Print via browser; record in `generated_documents` with `verify_url`.
- QR: server-side QR (qrcode package) carrying the documented tax-QR field set (seller VAT no., date/time, total, VAT amount) — as a **verification QR** for now, not ZATCA.
- Store rendered files in tenant bucket (signed URLs).
- **Validation:** A4 print preview, QR scannability, verify page for invoice docs.

## PHASE 7 — Purchase/Expense integration
- Purchase invoice approval flow → `payables` + `PurchaseInvoiceApprovedEvent`.
- Expense approval → `ExpenseApprovedEvent` (expense categories map to CoA expense accounts).
- **Validation:** AP creation, expense → journal mapping, input VAT capture.

## PHASE 8 — VAT Engine
- Migrations: `vat_periods`, `vat_adjustments` (+ RLS, immutability on finalize).
- Recoverability classification on input ledger (`recoverable | non_recoverable | pending_review`).
- Consumers for tax events (output from invoices, input from purchases/expenses).
- `vat_adjustments` for credit/debit notes + corrections.
- UI: VAT dashboard (output/input/net, periods, adjustments).
- **Validation:** the three mock scenarios (0 / 5,000 payable / 5,000 receivable), non-recoverable exclusion.

## PHASE 9 — Accounting ↔ Invoice ↔ VAT integration
- Build the event dispatcher (poll `financial_events` → dispatch to engine consumers) with idempotent processing and `skipped_duplicate` handling.
- Wire finalize → journal + VAT row automatically; payment → allocation + journal.
- Failure/retry handling, monitoring via `financial_events.processing_status`.
- **Validation:** end-to-end mock: invoice → journal → VAT; replay same event → no double-post.

## PHASE 10 — VAT reconciliation
- Reconciliation view per VAT period: output − recoverable input ± adjustments = net position.
- Outstanding/review items list (pending_review rows).
- Bilingual report output (CSV + print HTML).
- **Validation:** reconciliation equals manual calculation on mock data.

## PHASE 11 — VAT return preparation
- Per-period VAT return summary (bilingual), export CSV + print.
- **No submission API** (out of scope until ZATCA).
- **Validation:** return matches reconciliation; numbers round-trip exactly (NUMERIC).

## PHASE 12 — Financial reports
- Views: Profit & Loss, Balance Sheet, Cash Flow (security_invoker, posted entries only).
- Reporting UI + CSV export (reuse `report_generation_log` queue pattern).
- **Validation:** statements balance (Assets = Liabilities + Equity) on mock data.

## PHASE 13 — Security/audit review
- Review RLS on all new tables, immutability triggers, permissions matrix, audit coverage.
- Pen-test-like checks: cross-tenant reads, forged tenant_id on INSERT/UPDATE, posted-row mutation attempts, service-role exposure.
- **Validation:** security checklist sign-off.

## PHASE 14 — Full automated testing
- Unit: calculations (decimal-safe), WPS/CSV builders, event idempotency, VAT scenarios.
- Integration: Server Actions against test tenant; RLS behavior.
- E2E (if framework added): invoice → payment → report happy path.
- **Validation:** `pnpm test` green (framework to be added; none exists today).

## PHASE 15 — ZATCA preparation/integration
- Only after Phases 0–14 are complete and approved.
- Re-read ZATCA-BOUNDARY.md; obtain official ZATCA requirements from authoritative sources; confirm scope with finance owner.
- Build adapter consuming `InvoiceFinalizedEvent` + invoice/tax payloads; store responses; add invoice `zatca_status` fields.
- **Do not** claim compliance until verified.

---

## Phase dependencies (why this order)
- 1–3 before 5: invoices post to the journal engine.
- 4 before 5: invoices need customers.
- 5–6 before 9: integration needs finalized invoices + documents.
- 7 before 8: input VAT comes from purchases/expenses.
- 8 before 10–11: reconciliation needs VAT periods/adjustments.
- 12 after 9: statements need integrated journals.
