# Accounting Engine — Architecture

> **Status:** Architecture (documentation only). Migration `027_accounting.sql` already exists and must be applied in Supabase before this engine is functional. No production code changed.

---

## 1. Ownership

The Accounting Engine is the **single source of truth for the General Ledger**. It owns:

- Chart of Accounts (CoA)
- Accounting periods
- Journal entries + journal lines (immutable once posted)
- Accounts Receivable / Accounts Payable
- Cash & Bank (bank accounts, transactions, reconciliations)
- Finance payments + payment allocations
- Trial balance + financial statements (P&L, Balance Sheet, Cash Flow)
- Period close / reopen

It **never** owns invoices, invoice lines, VAT ledgers, or VAT returns. Those belong to the Invoice and VAT engines.

---

## 2. What already exists (migration 027 + `src/lib/accounting/actions.ts`)

| Piece | Location | Status |
|---|---|---|
| `chart_of_accounts` (5 types, normal balance, parent_id, ~28 seeded accounts) | 027 | exists |
| `accounting_periods` (open/closing/closed/reopened, unique tenant+year+month) | 027 | exists |
| `journal_entries` + `journal_entry_lines` (single-side line constraint, immutability triggers JRN001–003) | 027 | exists |
| `journal_entry_ref_seq`, `finance_doc_ref_seq` | 027 | exists |
| `bank_accounts`, `bank_transactions`, `bank_reconciliations` | 027 | exists |
| `customers`, `suppliers` | 027 | exists |
| `receivables`, `payables` (AR/AP) | 027 | exists |
| `finance_payments` + `payment_allocations` | 027 | exists |
| `trial_balance` VIEW (security_invoker, posted only) | 027 | exists |
| Server Actions: `createChartAccount`, `postJournalEntry`, `createReceivable` | `src/lib/accounting/actions.ts` | exists |
| UI page `/accounting` (journal/accounts/trial balance/AR-AP/VAT/payments tabs) | `src/app/(dashboard)/accounting/page.tsx` | exists |

---

## 3. Core accounting rules (from migration 027 + v2.0 master prompt 7.2)

1. **Posted entries are immutable.** Triggers block edits (`JRN001`), reverse-to-draft (`JRN001`), and deletes (`JRN003`). Corrections are reversal entries only.
2. **Entries must balance** — Σ debits = Σ credits (enforced in the Server Action; DB-level balance constraint should be added in a future migration for defense-in-depth).
3. **Output VAT and Input VAT never netted silently** — separate ledgers (VAT Engine owns them).
4. **AR totals never reduced by purchase invoices** — purchases go to payables.
5. Every journal links back to its source (`source_module`, `source_entity_type`, `source_entity_id`) — the audit/traceability chain.
6. Money is `NUMERIC(12,2)` in DB; no floating-point arithmetic in financial code.

---

## 4. Journal posting flow

```
Server Action (requirePermission "accounting" "create")
  ├─ validate lines ≥ 2, each single-sided, non-negative
  ├─ validate Σdebits == Σcredits (within epsilon; prefer exact integer-minor comparison)
  ├─ resolve open accounting period for entry date (create if missing; reject if closed)
  ├─ INSERT journal_entries (status='posted', posted_at, posted_by)
  ├─ INSERT journal_entry_lines (all lines)
  ├─ INSERT financial_events (idempotency key)  ← Phase 9
  ├─ writeAuditLog (immutable)
  └─ revalidatePath("/accounting")
```

**Planned additions (future phases):**
- DB function `post_journal(...)` doing the whole thing in one transaction (atomicity).
- Balance CHECK on `journal_entries` (SUM of lines) via trigger.
- `journal_approvals` (draft → submitted → approved → posted) for the `approve` permission.
- Period-close enforcement: block new postings into `closed` periods at DB level.

---

## 5. Chart of Accounts design

- Account code 3–6 digits (regex `^\d{3,6}$` enforced in `createChartAccount`).
- Types: `asset | liability | equity | income | expense`; normal balance `debit | credit`.
- Hierarchical via `parent_id` (e.g. `1600 Fixed Assets` → `1610 Accumulated Depreciation`).
- Seeded (idempotent) for the default tenant: cash 1000, bank 1100, AR customers 1200, AR platforms 1300, AR drivers COD 1400, prepaid 1500, fixed assets 1600 + accum. dep. 1610, AP suppliers 2000, wages payable 2100, GOSI 2200, advances received 2300, VAT output payable 2500, VAT input receivable 2600, capital 3000, retained earnings 3100, revenue 4000–4200, expenses 5000–5800.
- Future: per-tenant configurable CoA with import/export; account opening balances.

---

## 6. Accounting periods

- One open period per (tenant, year, month); `UNIQUE (tenant_id, period_year, period_month)`.
- Status flow: `open → closing → closed → reopened`.
- Postings resolve their period automatically from `entry_date`; a closed period rejects new entries.
- Future: closing checklist (reconciliations, adjustments, lock), reopen with reason (already has `reopen_reason` column).

---

## 7. AR / AP & payments

- `receivables`/`payables`: net + VAT + total + paid; status `open | partially_paid | paid | overdue | written_off`.
- `finance_payments` (direction in/out; method cash/transfer/cheque/wps/card; bank account optional) → `payment_allocations` (exactly one AR or AP target per allocation; amounts > 0).
- Payment allocation updates receivable/payable `paid_amount` and status. Allocation is a candidate for idempotent event handling (partial allocations, void payments).

---

## 8. Bank

- `bank_accounts` (IBAN, currency SAR default, opening balance).
- `bank_transactions` (positive = deposit, negative = withdrawal; pending/cleared/matched).
- `bank_reconciliations` (statement from/to, opening/closing, matched_count; draft/in_progress/completed).
- Future: auto-match transactions against `finance_payments` via idempotency-safe matching rules.

---

## 9. Financial statements (future views)

- **Trial balance** — exists (posted entries grouped by account).
- **Profit & Loss** — income − expense accounts for a period.
- **Balance Sheet** — asset/liability/equity balances at a date.
- **Cash Flow** — from journal entry_type (`bank`, `invoice`, `expense`, …) classification.
- All as `security_invoker` views over posted entries only, so RLS still applies.

---

## 10. Permissions

Module `accounting`, actions `read | create | update | approve | export | print` (seeded 013). The `accountant` role already receives grants. All mutations call `requirePermission("accounting", ...)` first; all reads via the Supabase client go through tenant RLS.

---

## 11. Sample mock journal postings

Sales invoice (taxable 100,000 SAR, VAT 15,000):
```
Dr AR — Customers 1200                 115,000
   Cr Revenue — Delivery Fees 4000       100,000
   Cr VAT Output Payable 2500             15,000
```
Payment received 115,000:
```
Dr Bank 1100                            115,000
   Cr AR — Customers 1200                115,000
```
Supplier invoice approved (taxable 100,000, VAT 15,000):
```
Dr Fuel/Expense 5000                    100,000
Dr VAT Input Receivable 2600             15,000
   Cr AP — Suppliers 2000                115,000
```
Payroll period (net 2,000, GOSI 300):
```
Dr Salaries & Wages 5200                2,000
Dr GOSI Contributions 5300                300
   Cr Wages Payable 2100                 2,000
   Cr GOSI Payable 2200                    300
```
*(All amounts are mock/test values.)*
