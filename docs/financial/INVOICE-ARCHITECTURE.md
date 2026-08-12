# Invoice Engine — Architecture

> **Status:** Architecture (documentation only). No production code changed.
> **Finding:** a dedicated invoice engine does **not** exist yet. `receivables` (migration 027) is a lightweight AR record; `/invoices` currently shows platform-payment reconciliation. This document defines the dedicated engine to build in later phases.

---

## 1. Ownership

The Invoice Engine owns **everything invoice-shaped**:

- Customers (CRUD already defined in 027; needs UI + actions)
- Invoices (header) + invoice lines
- Invoice numbering
- Invoice lifecycle & status
- Invoice calculations (net, discounts, VAT, totals)
- Credit notes, debit notes
- Invoice payments/status (reconciled to `finance_payments` in the Accounting Engine)
- Invoice PDF, print, QR

It **never** owns journal entries, VAT ledgers, or VAT returns. It emits events for the Accounting and VAT engines.

---

## 2. Existing pieces to reuse

| Asset | Where | Reuse for |
|---|---|---|
| `customers`, `suppliers` tables | 027 | invoice parties (have `tax_number` for ZATCA) |
| `receivables` | 027 | AR postings created **from** finalized invoices |
| `finance_payments` + `payment_allocations` | 027 | payment application to invoices |
| `delivery_platforms`, `drivers`, `vehicles`, `orders` | 014–020 | invoice line sources |
| `generated_documents` + `verify_url` + `/verify-document/[docNumber]` | 025 | invoice PDF record + QR verification |
| `document-html.ts` A4 builder | src/lib/templates | invoice HTML/PDF foundation |
| `qrcode` package | dependency | QR generation (already used in driver registration) |
| `audit_log` immutability + `writeAuditLog()` | 007 + sessions.ts | invoice event audit |

---

## 3. Proposed entities (see DATABASE-DESIGN.md for full evaluation)

- **`invoices`** — header: tenant, customer_id, invoice_number (sequence), invoice_type (sales | purchase), issue_date, due_date, currency (SAR), status, subtotal, discount, vat_rate, vat_amount, total, source links, timestamps, soft-delete.
- **`invoice_lines`** — invoice_id, line_no, description, quantity, unit_price, discount, amount, vat_rate, vat_amount, source (order/driver/vehicle/platform), account mapping hint.
- **`credit_notes`** — like invoices but `kind='credit'`; references the original invoice; immutability same as invoices; may carry its own VAT (VAT Engine event).
- **`debit_notes`** — like invoices but `kind='debit'`; increases what customer owes.
- Invoice number sequencing via a **sequence** (never COUNT+1 — pattern already established: `journal_entry_ref_seq`, `finance_doc_ref_seq`).

> **Reuse decision:** `receivables` remains the **AR ledger** in the Accounting Engine. The Invoice Engine writes `invoices`; on finalize it emits an event the Accounting Engine uses to create/update the `receivable`. The Invoice Engine does **not** write `receivables` directly.

---

## 4. Invoice numbering & lifecycle

### Numbering
- Per-tenant sequence: `INV-YYYY-000001` (sales), `CN-…`, `DN-…`, purchase `PINV-…`.
- Sequence values come from Postgres sequences; unique partial index `(tenant_id, invoice_number) WHERE deleted_at IS NULL`.

### Lifecycle
```
draft → issued → finalized  (immutable)
                    ├─ paid / partially_paid / overdue  (via payments)
                    ├─ cancelled  (reversal: emits cancellation event; only if unpaid)
                    └─ credited → closed  (credit note issued)
```
- `finalized` invoices are **immutable**: edits blocked by trigger (mirror JRN001–003 pattern). Corrections use credit/debit notes only.
- A credit note can be issued against a finalized invoice; it emits `CreditNoteIssuedEvent` → Accounting (reversal journal) + VAT (output VAT reduction/adjustment).

---

## 5. Calculations

- Computed in the **server layer** (Server Action), stored as `NUMERIC(12,2)` in DB; frontend only displays.
- `line_amount = quantity × unit_price − discount`
- `subtotal = Σ line_amount`
- `vat_amount = subtotal × vat_rate` (rounded to 2 dp at the total, or per-line then summed — decide once in Phase 5 and document as the canonical rule)
- `total = subtotal + vat_amount`
- **No floating-point anywhere in the pipeline.**

---

## 6. Invoice → events → engines

```
finalizeInvoice(invoiceId)
  ├─ requirePermission("invoices", "create")
  ├─ DB transaction: update invoices.status = 'finalized'
  ├─ INSERT financial_events:
  │     { key: inv:{id}:finalized, type: InvoiceFinalizedEvent,
  │       payload: { customer, lines, subtotal, vat, total } }
  ├─ Accounting Engine consumes → posts journal (AR/Revenue/VAT output)
  │     Dr AR Customers      total
  │        Cr Revenue          subtotal
  │        Cr VAT Output Pay.  vat
  ├─ VAT Engine consumes → vat_output_ledger row (period YYYY-MM)
  └─ writeAuditLog
```

---

## 7. Credit / debit notes

| Note | Effect on Accounting | Effect on VAT |
|---|---|---|
| Credit note | Reversal journal (Cr AR, Dr Revenue, Dr VAT output) | Output VAT reduction/adjustment row |
| Debit note | Additional AR journal (Dr AR, Cr Revenue/VAT) | Output VAT adjustment row |

Both are separate documents with their own numbering and immutability.

---

## 8. Invoice PDF / print / QR (Phase 6)

- Build on `src/lib/templates/document-html.ts` → new `buildInvoiceHtml(invoice, lines, company, qrPayload)`.
- **QR payload** (future ZATCA-compatible): the standard TLV structure (seller VAT number, timestamp, invoice total, VAT amount) can be generated client-free in the server layer with the `qrcode` package (`toBuffer` → data URL or storage). Keep payload fields documented so the ZATCA Adapter can reuse the same data.
- Print via browser `window.print()` on the A4 HTML (existing pattern).
- Record in `generated_documents` with `verify_url` (existing public verification page).
- Store PDF bytes in the tenant storage bucket (`invoices` bucket) with signed URLs.

---

## 9. Permissions

Module `invoices`, actions `read | create | update | approve | export | print` (mirrors seeded accounting module; add `invoices` grants for `accountant` role in a future seed update). All mutations call `requirePermission("invoices", …)`.

---

## 10. Mock example (Phase 5 test data)

Invoice `INV-2026-000001` to customer "Demo Retail Co." (mock):
```
Line 1: Delivery service, 800 orders × 100 SAR      = 80,000
Line 2: COD handling fee, 800 × 25 SAR              = 20,000
Subtotal                                            = 100,000
VAT 15%                                             =  15,000
Total                                               = 115,000
```
*(All values are synthetic test data.)*
