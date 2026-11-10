# Financial Architecture — Master Document

> **Status:** Architecture (documentation only). No production code, migrations, tables, or UI were changed to produce this document.
> **Scope:** Three independent financial domains — **Accounting Engine**, **Invoice Engine**, **VAT Engine** — plus a future **ZATCA Adapter** boundary. All data in this document is mock/test data only.

---

## 1. Existing architecture (as discovered)

| Area | Finding |
|---|---|
| Framework | Next.js **16.1.1** (App Router + Turbopack), React 19.2.3, TypeScript 5.9.3, Tailwind CSS 4 |
| Frontend architecture | Server Components + client components; `shadcn/ui` component library; `EnterpriseModulePage` reusable pattern for module list pages |
| Backend architecture | **Server Actions** (`"use server"` files under `src/lib/*/actions.ts`) as the mutation layer; no separate REST API for business logic; `src/proxy.ts` (Next 16 middleware) guards dashboard routes |
| Database | **Supabase (PostgreSQL)** via `@supabase/ssr` + `@supabase/supabase-js`; 30 migrations (`supabase/migrations/001…030`) |
| Authentication | Supabase Auth + custom `users` table; invite flow (`src/lib/auth/invites.ts`); sessions in `src/lib/auth/sessions.ts` |
| Authorization | RBAC: `roles`, `permissions`, `role_permissions`, `user_role_assignments`, `tenant_memberships`; app-level `requirePermission(module, action)` |
| Middleware | `src/proxy.ts` — narrowed matcher on dashboard/module routes, session refresh, account-status checks, `/settings/*` role guards, `x-tenant-id`/`x-user-role` headers |
| RLS | Deny-by-default 4-policy pattern (SELECT + INSERT WITH CHECK + UPDATE; **no DELETE** — soft-delete only) on every tenant-owned table; `get_my_tenant_id()` SECURITY DEFINER helper |
| Existing migrations | 001 extensions · 002 enums · 003 sequences · 004 tenants · 005 users · 006 system_settings · 007 audit_log · 008 rbac · 009 triggers · 010 rls · 011 storage · 012 indexes · 013 seed · 014–023 modules · 024 reports · 025 templates · 026 platform_payments · **027 accounting** · 028 templates seed · 029/030 driver applications |
| Existing financial functionality | **Substantial Module 9 (Accounting) foundation already exists in migration 027** — see §2 |
| Bilingual | `LocaleProvider` + `useTranslation`; AR (RTL, Cairo) / EN (LTR, Inter); per-module i18n catalogs |
| Tests | **No test framework / no test files found** |
| Env config | `.env.example` documents `NEXT_PUBLIC_APP_URL`, Supabase URL/anon/service-role, Resend keys; `.env.local` present |

---

## 2. Existing financial modules (discovery result)

### 2.1 Accounting (Module 9) — ALREADY EXISTS in `supabase/migrations/027_accounting.sql`

Already created (migration written but must be applied in Supabase before use):

- `chart_of_accounts` (asset/liability/equity/income/expense, debit/credit normal balance, parent hierarchy, seeded ~28 accounts)
- `accounting_periods` (open/closing/closed/reopened, unique per tenant+year+month)
- `journal_entries` + `journal_entry_lines` — **immutable once posted** (triggers `JRN001/002/003`); source-linked (`source_module`, `source_entity_type`, `source_entity_id`); reversal chain
- `bank_accounts`, `bank_transactions`, `bank_reconciliations`
- `customers`, `suppliers` (finance references with `tax_number` for future ZATCA)
- `receivables`, `payables` (AR/AP with net + VAT + total, `ar_ap_status`)
- `finance_payments` (in/out, cash/transfer/cheque/wps/card) + `payment_allocations`
- `vat_output_ledger`, `vat_input_ledger` — **kept separate, never netted silently**
- `trial_balance` VIEW (security_invoker, posted entries only)
- RLS 4-policy pattern on every table; `journal_entry_ref_seq`, `finance_doc_ref_seq` sequences

App layer: `src/lib/accounting/actions.ts` — `createChartAccount`, `postJournalEntry` (validates Σdebits = Σcredits), `createReceivable` (net + VAT + total). UI: `src/app/(dashboard)/accounting/page.tsx` (tabs: journal, accounts, trial balance, AR/AP, VAT, payments).

> ⚠️ **Important:** migration 027 is **NOT yet applied** (like all migrations — the app runs on demo/static data until Supabase setup completes). The accounting UI page currently renders demo data.

### 2.2 Invoice functionality

- `/invoices` page currently renders **platform payment reconciliation** (`platform_payments` from migration 026), not customer invoices.
- `receivables` in 027 acts as a lightweight AR "invoice" (ref, date, due date, net, VAT, total, paid) created manually via `createReceivable`.
- **No dedicated `invoices` / `invoice_lines` / credit notes / debit notes / invoice lifecycle / invoice numbering tables exist yet.**

### 2.3 Purchase / Expense functionality

- `expenses` (fuel/advance/operational/platform_commission/maintenance/other) + `payroll_advances` in migration 021; UI `/expenses`.
- No purchase-order or supplier-invoice approval flow yet (payables in 027 are the intended destination).

### 2.4 VAT functionality

- `vat_output_ledger` + `vat_input_ledger` (separate; 15% default rate; period year/month; source-linked). UI: VAT tab in `/accounting`.
- **No VAT periods, VAT adjustments, recoverability flag, reconciliation, or VAT-return preparation yet.**

### 2.5 Customer / Supplier

- `customers` and `suppliers` tables exist in 027 with bilingual names, `tax_number`, credit limit. UI not yet built for CRUD.

### 2.6 PDF / print / QR

- `src/lib/templates/document-html.ts` — pure A4 HTML builder (bilingual, RTL), used by `generateDocumentAction`.
- `generated_documents` table (025) with `qr_code_url`, `verify_url`, `doc_number`; `/verify-document/[docNumber]` public verification page.
- QR: `qrcode` package is a dependency; used in driver-registration success screen (`QRCode.toDataURL`). Document QR is currently a **placeholder box** in the A4 HTML (documented follow-up).
- PDF: no true PDF generator — "PDF" is achieved via browser print dialog (`window.print()`) on the A4 HTML.

### 2.7 Reporting / export

- `report_generation_log` async job queue (024); `src/lib/reports/actions.ts` + `generator.ts` — CSV serialization (RFC-4180-ish), upload to `generated-reports` storage bucket, rate-limited (10/hour), audit-logged.
- `src/lib/payroll/wps-generator.ts` — SAMA WPS SIF file (pipe-delimited) generation.
- i18n labels for CSV/Excel/PDF export exist; **Excel/PDF export not yet implemented**.

### 2.8 Audit logging

- Immutable `audit_log` table (007) — UPDATE/DELETE blocked by trigger (009); SELECT-only RLS; writes go through service-role via `writeAuditLog()` (`src/lib/auth/sessions.ts`). Every module action writes an audit row.

### 2.9 Notifications / email

- Resend via global `fetch` in `src/lib/auth/invites.ts` (invite emails). No general notification module.

### 2.10 File / storage

- 9 storage buckets (011); tenant-folder isolation policies; signed URL download for private documents (`src/lib/applications/actions.ts`).

### 2.11 Design system / i18n / RTL

- AIDesigner token system in `globals.css` (elite-blue / elite-orange scales, glass utilities, shadows, keyframes); Cairo for Arabic RTL, Inter for English LTR; `dir` set client-side via `LocaleProvider` with no-flash inline script.

---

## 3. Gaps / missing functionality (what the three engines must add)

| Engine | Already exists | Missing |
|---|---|---|
| **Invoice** | `receivables`, `finance_payments`, `payment_allocations`, `platform_payments`, customers/suppliers | Dedicated `invoices` + `invoice_lines`, invoice numbering/lifecycle, credit notes, debit notes, invoice PDF/print/QR, invoice↔accounting↔VAT event wiring |
| **Accounting** | CoA, periods, journal engine (immutable), AR/AP, payments, bank, trial balance | Financial statements (P&L, Balance Sheet, Cash Flow) as views, period-close enforcement in app actions, journal approval workflow, source-document idempotency keys |
| **VAT** | Output/input ledgers (separate) | VAT periods, recoverability classification, VAT adjustments, VAT reconciliation, VAT-return preparation, net-position view |
| **ZATCA** | `tax_number` fields on tenants/customers/suppliers; source linkage on journals; separate VAT ledgers | Nothing yet (intentionally — see ZATCA-BOUNDARY.md) |

---

## 4. Proposed financial architecture

```
                        ┌──────────────────────────────┐
                        │        ZATCA ADAPTER          │
                        │  (future — Phase 15 only)     │
                        └──────────┬───────────────────┘
                                   │ structured e-invoice payloads / responses
┌───────────────┐    events    ┌───▼─────────────┐   post    ┌───────────────────┐
│ INVOICE ENGINE│ ───────────► │ ACCOUNTING EVENT│ ────────► │  ACCOUNTING ENGINE │
│ customers     │              │  (idempotent)   │           │  CoA / GL / journal │
│ invoices      │              └─────────────────┘           │  AR / AP / cash/bank│
│ lines         │                                            │  periods / reports  │
│ credit/debit  │              ┌─────────────────┐           └───────────────────┘
│ notes         │   events     │   TAX EVENT     │   post
│ PDF/QR        │ ───────────► │  (idempotent)   │ ────────► ┌───────────────────┐
└───────────────┘              └─────────────────┘           │    VAT ENGINE       │
                                                             │ output/input ledgers│
                                                             │ adjustments / return│
                                                             └───────────────────┘
```

### Non-negotiable boundaries

1. **Invoice Engine ≠ General Ledger.** An invoice creates a journal *event*; the Accounting Engine owns the GL. The Invoice Engine never writes journal lines directly.
2. **Invoice Engine ≠ VAT ledger.** An invoice creates a tax *event*; the VAT Engine owns the VAT ledgers.
3. **VAT Engine ≠ invoice generator.** VAT never renders invoice PDFs.
4. **Accounting Engine ≠ invoice generator.** Accounting never renders invoice PDFs.
5. All engines communicate through **idempotent events**, not direct table writes across domains.

---

## 5. Module boundaries & dependencies

| Module | Owns | Reads from | Never writes to |
|---|---|---|---|
| Invoice Engine | customers, invoices, invoice_lines, credit/debit notes, numbering, invoice status | drivers, vehicles, delivery_platforms, orders (for line data) | journal_entries, vat ledgers |
| Accounting Engine | CoA, periods, journal entries/lines, AR/AP, payments, allocations, bank, trial balance, statements | invoices (via events), expenses, payroll | invoice tables, vat ledgers (writes only via its own journal entries) |
| VAT Engine | vat output/input ledgers, vat periods, adjustments, reconciliation, return | invoice events, purchase events, expense events | invoice tables, journal tables |

**Dependency rule:** Invoice → Accounting and Invoice → VAT are one-way, event-driven. Accounting and VAT do not call back into Invoice.

---

## 6. Database entities (proposed; see DATABASE-DESIGN.md)

Reused: `customers`, `suppliers`, `receivables`, `payables`, `finance_payments`, `payment_allocations`, `bank_*`, `vat_output_ledger`, `vat_input_ledger`, `chart_of_accounts`, `accounting_periods`, `journal_entries`, `journal_entry_lines`, `trial_balance`, `audit_log`, `platform_payments`, `expenses`, `payroll_advances`.

New (evaluate before creating): `invoices`, `invoice_lines`, `credit_notes`, `debit_notes`, `vat_periods`, `vat_adjustments`, `vat_reconciliation`, `financial_events` (idempotency ledger).

---

## 7. Lifecycles

### Invoice lifecycle
`draft → issued → finalized → (paid / partially_paid / overdue) → (cancelled | credit_note → closed)`
- `finalized` is **immutable** (corrections only via credit/debit note).

### Accounting lifecycle
`draft journal → posted (immutable) → reversed (reversal entry)`
- Period: `open → closing → closed → (reopened)`. Posted entries block edits; reversal entries are the only correction path.

### VAT lifecycle
`tax event → ledger row (output/input) → classified (recoverable / non-recoverable / pending review) → adjustment → period review → reconciliation → return preparation`

---

## 8. Cross-cutting architecture

### 8.1 Audit architecture
Every financial mutation writes an immutable `audit_log` row via `writeAuditLog()` (service-role). Financial events additionally carry their own event rows. Audit records: actor, tenant, module, action, entity, before/after values, timestamp.

### 8.2 Permission architecture
`requirePermission(module, action)` at the top of every Server Action. Modules: `accounting`, `invoices`, `expenses`, `reports` (already seeded in 013). Actions: `read / create / update / approve / export / print` (already in `PermissionAction`). The `accountant` role already receives payroll/invoices/expenses/accounting/reports grants.

### 8.3 Idempotency architecture
A `financial_events` table stores every integration event with an **idempotency key** = `source_type + ":" + source_id + ":" + event_type`. Replays are detected by unique index and skipped. Every engine consumes events exactly once.

### 8.4 Error handling
Existing taxonomy pattern (`src/lib/errors/error-codes.ts`, e.g. `JRN001–003`) extended with financial codes: `INV001–005` (invoice), `ACC001–006` (accounting), `VAT001–005` (VAT), `PAY001–006` (existing). Server Actions return `{ success, error }`; DB triggers raise `ENGINE_CODE` exceptions.

### 8.5 Transaction boundaries
- Multi-table writes inside one Server Action run inside a **single Supabase transaction** where the client supports it (or via a Postgres function with `BEGIN/COMMIT` for cross-table integrity — journal + lines + event must be atomic).
- Posted journal entries, finalized invoices, and finalized VAT periods are immutable at the DB layer (triggers), not just the UI.

### 8.6 Future ZATCA boundary
See ZATCA-BOUNDARY.md. Keep `tax_number` populated on tenants/customers/suppliers; keep VAT ledgers separate; keep source linkage; **do not** implement ZATCA transmission, cryptographic signing, or claim compliance now.

---

## 9. Financial rules (global)

1. **Never float-point money.** Use `NUMERIC(12,2)` in DB (already the pattern) and integer-minor-units or `decimal`-safe libraries in app code. Frontend never computes financial totals for persistence — it displays server/DB-computed values.
2. Posted journals, finalized invoices, finalized VAT periods are immutable; corrections use reversal/credit/debit/adjustment.
3. Every financial amount traces to a source document (`source_module`/`source_entity_type`/`source_entity_id`).
4. Every integration event is idempotent.
5. Frontend is never the source of truth for financial calculations.
6. Output VAT and Input VAT are never netted silently.
7. Single-tenant today; all financial tables carry `tenant_id` and obey tenant RLS so multi-tenancy can be enabled safely later.

---

## 10. Working examples (mock data only)

### Sales invoice flow
```
Invoice (taxable 100,000 SAR, VAT 15,000 SAR)
  → AccountingEvent(idem=inv:{id}:finalized) → Accounting Engine
       Dr AR — Customers          115,000
          Cr Revenue — Delivery      100,000
          Cr VAT Output Payable       15,000
  → TaxEvent(idem=inv:{id}:finalized) → VAT Engine
       vat_output_ledger += (base 100,000, rate 15%, vat 15,000, period YYYY-MM)
```

### Payment flow
```
Payment (115,000 SAR received)
  → AccountingEvent(idem=payment:{id}:allocated) → Accounting Engine
       Dr Bank — 1100               115,000
          Cr AR — Customers          115,000
  → payment_allocations links payment → receivable; receivable.status = paid
```

### Purchase flow
```
Supplier invoice approved (taxable 100,000 SAR, VAT 15,000 SAR)
  → AccountingEvent(idem=purchase:{id}:approved) → Accounting Engine
       Dr Expense / Inventory       100,000
       Dr VAT Input Receivable       15,000
          Cr AP — Suppliers           115,000
  → TaxEvent → VAT Engine
       vat_input_ledger += (base 100,000, rate 15%, vat 15,000)
```

### VAT net position (mock)
| Scenario | Output VAT | Recoverable Input VAT | Net VAT |
|---|---|---|---|
| A | 15,000 | 15,000 | **0** (payable) |
| B | 20,000 | 15,000 | **5,000 payable** |
| C | 15,000 | 20,000 | **5,000 receivable/refund** |

Non-recoverable input VAT is expensed, never carried to the net position.
