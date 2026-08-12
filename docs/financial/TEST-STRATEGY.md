# Financial Test Strategy

> **Status:** Strategy only. No test framework exists in the repo today — Phase 14 introduces one after the engines are built. This document defines what to test and how.

---

## 1. Current state

- **No test files or framework found** (`*.test.*` / `*.spec.*` — none).
- Financial logic already exists that *should* be tested: `src/lib/payroll/calculation-engine.ts`, `wps-generator.ts`, `deduction-rollback.ts`, `src/lib/reports/generator.ts` (CSV), `src/lib/templates/document-html.ts` (pure functions — ideal unit-test targets).
- Proposed framework (Phase 14): **Vitest** for unit/integration + existing `puppeteer-core` (already a devDependency) for E2E/browser verification. Confirm before installing — no dependencies are added in this stage.

---

## 2. Testing principles

1. **Money never floats.** All money assertions use exact decimal/integer-minor representations — never `toBe(0.1 + 0.2)`.
2. **Mock data only.** Synthetic tenants, customers, invoices, VAT numbers (e.g. `VAT-000000000000001`-style placeholders). Never real company/IBAN/VAT/CR/employee data — enforced by review.
3. **Immutability is tested at the DB layer** — attempt UPDATE/DELETE on posted/finalized rows and expect the trigger exception codes.
4. **Idempotency is tested** — replaying the same event must not double-post.
5. **Frontend is display-only** — tests assert the server returns correct values, not that the client computes them.

---

## 3. Test layers

### 3.1 Unit tests (pure functions)
| Target | Cases |
|---|---|
| Invoice calculation module | subtotal/VAT/total for standard, zero-VAT, discount, multi-line; rounding at 2dp |
| `calculateDriverPayrollFormula` | 3 contract categories, prorated targets, minimum wage advisory (existing engine) |
| `generateWPSSIF` | header/detail/trailer layout, pipe escaping, SAR currency 682, bank code map |
| `buildCsv` | RFC-4180-ish quoting, CRLF, UTF-8 |
| `buildDocumentHtml` / `buildInvoiceHtml` | escaping (XSS: `& < > "`), bilingual field rows, RTL root |
| VAT net position | the three mock scenarios (0 / 5,000 payable / 5,000 receivable) + adjustment case |

### 3.2 Integration tests (Server Actions + Supabase test tenant)
| Flow | Asserts |
|---|---|
| `postJournalEntry` | balancing rule, single-sided lines, period resolution, closed-period rejection, audit row written |
| `createReceivable` | VAT math, due-date validation, audit row |
| Invoice finalize | status→finalized, journal + VAT rows created via events, number sequence increments |
| Credit note | reversal journal + VAT adjustment, original invoice unchanged (immutable) |
| Payment allocation | bank/AR posting, receivable status transition, allocation target constraint |
| VAT period finalize | immutable snapshot; subsequent inserts rejected |
| Report generation | rate limit (10/hour), CSV upload, status transitions, audit row |

### 3.3 RLS / security tests
- Cross-tenant SELECT returns nothing (user A cannot see tenant B rows).
- INSERT with a forged `tenant_id` is rejected (`WITH CHECK`).
- UPDATE/DELETE on posted journal / finalized invoice / finalized VAT period → trigger error.
- `audit_log` UPDATE/DELETE → trigger error; INSERT only via service role.
- Service-role key never importable by client code (module graph check).

### 3.4 E2E / browser (puppeteer)
- Invoice list → open invoice → print preview (A4) → QR renders.
- Bilingual toggle: AR RTL and EN LTR invoice detail render correctly.
- Permission matrix: accountant can post, payroll_officer cannot (UI hides + server rejects).
- Verify-document page for an invoice doc.

---

## 4. Decimal strategy (implement in Phase 5)

- Store `NUMERIC(12,2)` (DB) — already the pattern.
- App layer: avoid `Math.round(x * rate) / 100` float patterns (the current `createReceivable` uses one — **flagged for replacement**). Prefer integer-minor arithmetic (`Math.round(amount * 100)`) or a decimal library (e.g. `decimal.js` — evaluate before adding).
- Canonical rule to lock once in Phase 5: per-line VAT rounded then summed **or** total VAT rounded once — pick one, document it, test it.

---

## 5. Mock test dataset

| Entity | Mock values (synthetic) |
|---|---|
| Tenant | `VAT-000000000000001`, CR `CR-0000000000` |
| Customer | "Demo Retail Co." / «شركة التجزئة التجريبية», tax `VAT-000000000000002` |
| Supplier | "Demo Supplies" / «الإمدادات التجريبية», tax `VAT-000000000000003` |
| Invoice A | taxable 100,000, VAT 15,000, total 115,000 |
| Invoice B | taxable 133,333.33, VAT 20,000, total 153,333.33 |
| Purchase | taxable 100,000, VAT 15,000 (fully recoverable) |
| Scenario matrix | (output, input) → (0 / 5,000 payable / 5,000 receivable) |

---

## 6. Validation commands (once framework exists)

- `pnpm test` — unit + integration
- `pnpm test:e2e` — puppeteer flows
- `pnpm lint` + `pnpm exec tsc --noEmit` — static gates (existing project commands)
- SQL-level checks via `supabase db test` or a `scripts/` verification script that runs the trigger/RLS assertions against a test database

---

## 7. Definition of done (per phase)

- Unit tests for all new pure functions (calculation, serialization, HTML).
- Integration tests for every new Server Action (happy path + rejection path + audit).
- RLS/immutability checks for every new table.
- Lint + typecheck clean.
- Worklog entry updated with verified results only.
