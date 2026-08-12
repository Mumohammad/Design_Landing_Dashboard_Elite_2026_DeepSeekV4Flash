# Financial Event Model

> **Status:** Design only. No production code changed.

---

## 1. Why events

The Invoice, Accounting, and VAT engines must stay **separate** while still staying consistent. Events decouple them:

- Invoice Engine emits events; it never writes GL or VAT rows.
- Accounting and VAT engines consume events idempotently; they never read the UI or recompute from scratch.
- The future ZATCA Adapter consumes the same events without touching the engines.

---

## 2. Event table (`financial_events`) — proposed

```
id                  UUID PRIMARY KEY
tenant_id           UUID NOT NULL REFERENCES tenants(id)
event_id            UUID NOT NULL UNIQUE            -- generated once, replayed safely
idempotency_key     TEXT NOT NULL UNIQUE            -- source_type:source_id:event_type
source_type         TEXT NOT NULL                   -- 'invoice' | 'credit_note' | 'debit_note'
                                                    -- | 'payment' | 'purchase_invoice'
                                                    -- | 'expense' | 'vat_adjustment'
source_id           UUID NOT NULL
event_type          TEXT NOT NULL
event_date          DATE NOT NULL
payload             JSONB NOT NULL
processing_status   TEXT NOT NULL DEFAULT 'pending'
                    -- 'pending' | 'processed' | 'failed' | 'skipped_duplicate'
created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
processed_at        TIMESTAMPTZ
error_message       TEXT
```

**Idempotency:** the consuming engine `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` (or checks before insert). A replay therefore never double-posts.

---

## 3. Event definitions

### 3.1 `InvoiceFinalizedEvent`
| Field | Value |
|---|---|
| idempotency_key | `invoice:{invoiceId}:finalized` |
| source_type / source_id | `invoice` / invoice id |
| event_date | invoice issue date |
| payload | `{ invoice_number, customer_id, lines[], subtotal, discount, vat_amount, total, currency, period_year, period_month }` |
| Consumers | Accounting (journal: Dr AR / Cr Revenue / Cr VAT Output), VAT (output ledger row) |

### 3.2 `InvoiceCancelledEvent`
| Field | Value |
|---|---|
| idempotency_key | `invoice:{invoiceId}:cancelled` |
| payload | `{ invoice_number, cancel_reason }` |
| Consumers | Accounting (only if unpaid → reversal entry), VAT (output VAT removal/adjustment) |

### 3.3 `CreditNoteIssuedEvent`
| Field | Value |
|---|---|
| idempotency_key | `credit_note:{creditNoteId}:issued` |
| payload | `{ credit_note_number, reference_invoice_id, subtotal, vat_amount, total, reason }` |
| Consumers | Accounting (reversal journal), VAT (output VAT reduction adjustment) |

### 3.4 `DebitNoteIssuedEvent`
| Field | Value |
|---|---|
| idempotency_key | `debit_note:{debitNoteId}:issued` |
| payload | `{ debit_note_number, reference_invoice_id, subtotal, vat_amount, total, reason }` |
| Consumers | Accounting (additional AR journal), VAT (output VAT adjustment) |

### 3.5 `PaymentReceivedEvent`
| Field | Value |
|---|---|
| idempotency_key | `payment:{paymentId}:allocated` |
| payload | `{ payment_ref, direction, amount, method, allocations[] (receivable_id/payable_id, amount) }` |
| Consumers | Accounting (Dr Bank / Cr AR or Dr AP / Cr Bank; update receivable/payable paid_amount + status) |

### 3.6 `PurchaseInvoiceApprovedEvent`
| Field | Value |
|---|---|
| idempotency_key | `purchase_invoice:{purchaseInvoiceId}:approved` |
| payload | `{ supplier_id, invoice_ref, subtotal, vat_amount, total, period_year, period_month }` |
| Consumers | Accounting (Dr Expense/Inventory + Dr VAT Input / Cr AP), VAT (input ledger row, recoverable by default) |

### 3.7 `ExpenseApprovedEvent`
| Field | Value |
|---|---|
| idempotency_key | `expense:{expenseId}:approved` |
| payload | `{ expense_id, expense_type, category, amount, vat_amount, driver_id?, vehicle_id? }` |
| Consumers | Accounting (Dr Expense / Cr AP or Bank), VAT (input row, classification per category) |

### 3.8 `AccountingEvent` (internal umbrella)
Posted journal wrapper: `{ journal_entry_id, entry_ref, entry_date, type, lines[] }` — used by financial reporting and the audit trail; idempotency_key `journal:{journalId}:posted`.

### 3.9 `TaxEvent` (internal umbrella)
VAT ledger write wrapper: `{ ledger, period, base, rate, vat, source }` — idempotency_key `tax:{sourceType}:{sourceId}:{kind}` where kind ∈ `output | input | adjustment`.

### 3.10 `VATAdjustmentEvent`
| Field | Value |
|---|---|
| idempotency_key | `vat_adjustment:{adjustmentId}:recorded` |
| payload | `{ adjustment_type, amount, period_year, period_month, reason, source }` |
| Consumers | VAT (vat_adjustments row → period net position) |

---

## 4. Processing contract

1. Producer inserts an event row **in the same transaction** as the source document mutation (best effort; document the limitation if PostgREST multi-statement transactions are used instead of a DB function).
2. Consumer polls or is triggered (Phase 9 decision: DB trigger → notify, or a scheduled Server Action) — selects `processing_status='pending'`, processes, marks `processed` or `failed` with error.
3. On failure, the event is retried; idempotency prevents double-effects.
4. `skipped_duplicate` is set when the consumer finds the effect already present (e.g. re-consumption after a crash between effect and status update).

---

## 5. Ordering & timing

- Events carry `event_date` (the business date, e.g. invoice issue date) so period mapping is deterministic.
- Consumers map to accounting/VAT periods by `event_date`, not by processing time.
- Within one source document, emit in dependency order: finalized invoice → its tax event; payment → allocation → journal.

---

## 6. Mock walkthrough (test data only)

Invoice `INV-2026-000001` (100,000 + 15,000 VAT) finalized:
```
financial_events rows:
  invoice:{id}:finalized          → Accounting: Dr AR 115,000 / Cr Revenue 100,000 / Cr VAT Out 15,000
  tax:invoice:{id}:output         → vat_output_ledger: (2026, 01, base 100,000, 15%, 15,000)
```
Payment of 115,000 allocated:
```
  payment:{id}:allocated          → Accounting: Dr Bank 115,000 / Cr AR 115,000; AR paid
```
Credit note 5,000 VAT 750 against the invoice:
```
  credit_note:{id}:issued         → Accounting: Cr AR 5,750 / Dr Revenue 5,000 / Dr VAT Out 750
  tax:credit_note:{id}:output_adj → vat_adjustments: −750 output
```
Net VAT for the period: output 15,000 − 750 = **14,250** (vs input, e.g. 10,000 → net **4,250 payable**). All mock numbers.
