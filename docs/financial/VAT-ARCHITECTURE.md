# VAT Engine — Architecture

> **Status:** Architecture (documentation only). No production code changed.
> **Country:** Saudi Arabia. Standard rate 15% (SAR). VAT Number from the tenant profile (`tenants.vat_number`, `customers.tax_number`, `suppliers.tax_number`).

---

## 1. Ownership

The VAT Engine owns **all VAT-specific state and logic**:

- Output VAT ledger (from sales invoices / receivables)
- Input VAT ledger (from purchases / expenses / payables)
- Recoverability classification (recoverable / non-recoverable / pending review)
- VAT adjustments (credit/debit notes, corrections, bad-debt relief)
- VAT periods & period finalization (immutable once finalized)
- VAT reconciliation (output − recoverable input ± adjustments)
- VAT return preparation (export for submission; **not** submission)

It **never** owns invoices, invoice PDFs, or journal entries.

---

## 2. What already exists

| Piece | Location | Notes |
|---|---|---|
| `vat_output_ledger` | migration 027 | period year/month, invoice_ref/date, base, rate (default 15.00), vat, customer_id, source links |
| `vat_input_ledger` | migration 027 | same shape with supplier_id |
| Separate-ledger rule (never net silently) | 027 header + v2.0 7.2 | already enforced by design |
| VAT tab in `/accounting` UI | `src/app/(dashboard)/accounting/page.tsx` | read-only lists of both ledgers |
| `createReceivable` writes VAT fields on the receivable | `src/lib/accounting/actions.ts` | manual AR; does **not** write VAT ledgers |
| Tenant/customer/supplier `tax_number` columns | 004/027 | populated via settings/company page |

---

## 3. Gaps (to build in Phases 8–11)

1. Recoverability classification — the input ledger needs `recoverability` state (`recoverable | non_recoverable | pending_review`) with a reason.
2. VAT adjustments table (credit/debit note VAT, corrections).
3. VAT periods table with finalization (immutability triggers).
4. Reconciliation view: `output − recoverable input ± adjustments = net position`.
5. VAT return preparation: aggregate by period, produce a structured summary (SAR, bilingual) ready for the return form / future ZATCA.
6. Event consumption: sales invoices → output rows; approved purchases/expenses → input rows.

---

## 4. Core VAT formula

```
Net VAT position = Output VAT
                 − Recoverable Input VAT
                 ± VAT adjustments
```

### Mock examples (test data only)

| Scenario | Output VAT | Recoverable Input VAT | Adjustments | Net VAT position |
|---|---|---|---|---|
| A — balanced | 15,000 | 15,000 | 0 | **0** payable |
| B — net payable | 20,000 | 15,000 | 0 | **5,000 payable** |
| C — net receivable | 15,000 | 20,000 | 0 | **5,000 receivable** |
| D — with adjustment | 20,000 | 15,000 | +500 (debit note) | **5,500 payable** |

Non-recoverable input VAT is **expensed** (goes to an expense account via an Accounting event) and never enters the net position.

---

## 5. VAT periods & finalization

- `vat_periods`: tenant, period_year, period_month, status (`open | finalizing | finalized`), totals snapshot (output, recoverable input, non-recoverable, adjustments, net), finalized_at/by, immutable trigger on `finalized`.
- Opening a VAT period auto-creates from the accounting period calendar; each month one period.
- Once `finalized`, rows are read-only (trigger raises `VAT00x`), mirroring the journal immutability pattern.

---

## 6. Ledger row lifecycle

```
TaxEvent (idempotent) → classify (recoverable | non_recoverable | pending_review)
  → vat_output_ledger / vat_input_ledger row
  → adjustment events (credit note, debit note, correction) modify period totals only via
    vat_adjustments (never UPDATE the original ledger row)
  → period review: all rows reviewed/pending resolved
  → period finalize (snapshot immutable)
  → reconciliation report
  → return preparation
```

---

## 7. Events consumed

| Event | Effect on VAT Engine |
|---|---|
| `InvoiceFinalizedEvent` | output VAT row (base, rate, vat) for period of invoice date |
| `CreditNoteIssuedEvent` | VAT adjustment (negative output) |
| `DebitNoteIssuedEvent` | VAT adjustment (positive output) |
| `PurchaseInvoiceApprovedEvent` | input VAT row (recoverable by default; flag for review if tax_number missing) |
| `ExpenseApprovedEvent` | input VAT row if expense carries VAT; non-recoverable by default for categories like payroll |
| `VATAdjustmentEvent` | explicit adjustment row |

---

## 8. Recoverability rules (draft — to confirm in Phase 8)

- Input VAT is **recoverable** when the supplier invoice is a valid tax invoice (supplier has `tax_number`, VAT shown separately, period aligned).
- **Non-recoverable** when: payroll/GOSI (no VAT), exempt categories, missing supplier tax number, entertainment (per Saudi rules — confirm with a finance owner).
- **Pending review** when the source lacks enough data (e.g. no supplier tax number) — resolved during period review.

---

## 9. VAT return preparation (Phase 11)

- Per VAT period, produce a structured, bilingual (AR/EN) summary:
  - Output VAT (sales)
  - Recoverable input VAT (purchases)
  - Non-recoverable input VAT (expensed)
  - Adjustments
  - Net VAT payable/receivable
- Output as a printable A4 HTML (reuse `document-html.ts` pattern) + CSV export.
- **No submission API.** Submission is out of scope until the ZATCA Adapter phase.

---

## 10. Permissions

Module `vat` (new) or reuse `accounting` module with `vat` sub-permissions — decide in Phase 8. Actions: `read | create | update | approve | export | print`. The `accountant` role is the primary user.

---

## 11. SAR formatting & bilingual

- Amounts stored `NUMERIC(12,2)`; displayed with Arabic-Indic or Latin digits per locale (existing `formatNum`/i18n patterns).
- All VAT labels bilingual: e.g. `ضريبة القيمة المضافة` / `VAT`, `المخرجات` / `Output`, `المدخلات` / `Input`, `صافي المركز الضريبي` / `Net VAT position`.
