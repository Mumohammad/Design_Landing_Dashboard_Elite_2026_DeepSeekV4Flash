# Financial Database Design

> **Status:** Design only. **No migrations created.** This document evaluates which entities already exist (reuse) versus which must be added.

---

## 1. Reuse-first principle

Equivalent entities that already exist in `supabase/migrations/` are **reused**, not duplicated. Proposed new tables are created only where no equivalent exists. All tables follow existing conventions:

- `tenant_id UUID NOT NULL REFERENCES tenants(id)` on every tenant-owned table
- 4-policy RLS (SELECT + INSERT WITH CHECK + UPDATE; **no DELETE**, soft-delete via `deleted_at`)
- `created_by`/`updated_by` → `auth.users(id)`, `created_at`/`updated_at` with trigger
- `NUMERIC(12,2)` for money
- Sequences (never `COUNT(*)+1`) for document/ref numbers
- Immutability triggers for posted/finalized rows

---

## 2. Entity evaluation

| Entity | Status | Decision |
|---|---|---|
| **Customer** | ✅ `customers` (027) — bilingual names, phone, email, `tax_number`, credit_limit, soft-delete | **Reuse.** Add UI + actions in Phase 4. |
| **Supplier** | ✅ `suppliers` (027) — same shape | **Reuse.** |
| **Invoice** | ❌ none dedicated (`receivables` is AR-only) | **New** `invoices` (Phase 5) |
| **InvoiceLine** | ❌ none | **New** `invoice_lines` (Phase 5) |
| **CreditNote** | ❌ none | **New** `credit_notes` (Phase 5) |
| **DebitNote** | ❌ none | **New** `debit_notes` (Phase 5) |
| **Payment** | ✅ `finance_payments` + `payment_allocations` (027) | **Reuse.** Wire invoice payments to allocations. |
| **ChartOfAccount** | ✅ `chart_of_accounts` (027) | **Reuse.** |
| **JournalEntry** | ✅ `journal_entries` (027, immutable) | **Reuse.** |
| **JournalLine** | ✅ `journal_entry_lines` (027) | **Reuse.** |
| **AccountingPeriod** | ✅ `accounting_periods` (027) | **Reuse.** |
| **TaxEvent** | ❌ no event ledger | **New** `financial_events` (EVENT-MODEL.md) — includes tax events |
| **VATPeriod** | ❌ none | **New** `vat_periods` (Phase 8) |
| **VATAdjustment** | ❌ none | **New** `vat_adjustments` (Phase 8) |
| **AuditLog** | ✅ `audit_log` (007, immutable) | **Reuse.** |
| AR / AP | ✅ `receivables`, `payables` (027) | **Reuse.** |
| Bank | ✅ `bank_accounts`, `bank_transactions`, `bank_reconciliations` (027) | **Reuse.** |
| Expenses / advances | ✅ `expenses`, `payroll_advances` (021) | **Reuse** as purchase/expense sources. |
| Platform payments | ✅ `platform_payments` (026) | **Reuse** as AR source for platform reconciliation. |
| Trial balance | ✅ `trial_balance` VIEW (027) | **Reuse**; add statements in Phase 12. |

---

## 3. Proposed new tables (sketch — do NOT create yet)

### 3.1 `invoices`
```
id, tenant_id, invoice_number (seq INV-YYYY-N), invoice_type (sales|purchase),
customer_id FK, supplier_id FK, issue_date, due_date, currency DEFAULT 'SAR',
status (draft|issued|finalized|paid|partially_paid|overdue|cancelled|credited),
subtotal NUMERIC(12,2), discount NUMERIC(12,2), vat_amount NUMERIC(12,2),
total NUMERIC(12,2), notes, source_entity_type/id, timestamps, deleted_at
```
Unique partial index `(tenant_id, invoice_number) WHERE deleted_at IS NULL`.
Immutability trigger on `status='finalized'`.

### 3.2 `invoice_lines`
```
id, tenant_id, invoice_id FK CASCADE, line_no, description,
quantity NUMERIC(12,3), unit_price NUMERIC(12,2), discount NUMERIC(12,2),
amount NUMERIC(12,2), vat_rate NUMERIC(5,2), vat_amount NUMERIC(12,2),
source_entity_type/id (order|driver|vehicle|platform)
```

### 3.3 `credit_notes` / `debit_notes`
Same shape as `invoices` + `reference_invoice_id FK`, `kind`, `reason`. Immutable once finalized.

### 3.4 `financial_events` (idempotency ledger)
```
id, tenant_id, event_id UUID UNIQUE, idempotency_key TEXT UNIQUE
  (format: source_type:source_id:event_type),
source_type, source_id, event_type, event_date, payload JSONB,
processing_status (pending|processed|failed|skipped_duplicate),
created_at, processed_at, error_message
```

### 3.5 `vat_periods`
```
id, tenant_id, period_year, period_month, status (open|finalizing|finalized),
output_vat, recoverable_input_vat, non_recoverable_vat, adjustments, net_position,
finalized_at, finalized_by, timestamps, deleted_at
UNIQUE (tenant_id, period_year, period_month)
```
Immutability trigger on `finalized`.

### 3.6 `vat_adjustments`
```
id, tenant_id, period_id FK, adjustment_type (credit_note|debit_note|correction|bad_debt|other),
amount, reason, source_entity_type/id, created_by, created_at
```

### 3.7 Optional: `journal_approvals` (Phase 3)
```
id, tenant_id, journal_entry_id FK, status (submitted|approved|rejected),
approved_by, approved_at, comment
```

---

## 4. Key relationships

```
invoices ─┬─< invoice_lines
          ├─1─ customers / suppliers
          ├─1─ receivables / payables   (created by Accounting on finalize)
          ├─< credit_notes / debit_notes (reference_invoice_id)
          └─1─ financial_events (idempotency)

financial_events ─► Accounting Engine (journal) ─► chart_of_accounts / journal_entry_lines
financial_events ─► VAT Engine (vat_output/input_ledger, vat_periods, vat_adjustments)

finance_payments ─< payment_allocations ─> receivables | payables
```

---

## 5. Indexing plan (with new tables)

- `invoices(tenant_id, issue_date DESC) WHERE deleted_at IS NULL`
- `invoices(tenant_id, status) WHERE deleted_at IS NULL`
- `invoice_lines(invoice_id)`
- `financial_events(tenant_id, processing_status, created_at)`
- `financial_events(idempotency_key)` UNIQUE
- `vat_periods(tenant_id, status)` partial
- `vat_adjustments(period_id)`

---

## 6. Data migration & seeding

- CoA + current accounting period already seeded idempotently (027).
- New seeds (idempotent, mock data only): default VAT period row, `invoices` module permissions for `accountant`, sample demo customers/suppliers in demo mode only.
- No backfill of real data — everything is synthetic during development.
