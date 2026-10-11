# SaaS implementation — Accounting delivery slices (2026-10-11)

This is **partial delivery**, not a completed Accounting/ZATCA/localization
product or a launch approval. The remaining work below is explicit.

## Baseline and plan

`feat/saas-accounting` starts at PR #66 commit `23411e6`, stacked on its
`fix/rbac-completion` branch. The other checkout (`feat/reports-module`) has
uncommitted changes and was not modified or incorporated. Those changes must
be reviewed/integrated separately, not silently replaced.

Inspection covered the Next 16 App Router/React/TypeScript/shadcn architecture,
Supabase SSR sessions, server-action authorization, financial migrations
027–056, the #65/#66 tenant/RBAC migrations, the Accounting/invoice/expense/payment
callers and tests, deployment-role routing, and CI/deployment workflows. The
existing architecture is retained. There is substantial real accounting code;
older financial architecture documents are not evidence of the current state.

Implementation order:

1. Exact monetary calculations and transactional draft saves (this slice).
2. Finish invoice editor/delete controls, pagination and permission-aware UI;
   then transactional document/event/ledger/payment lifecycles and fault tests.
3. Implement official ZATCA XML/security/EGS sequencing and sandbox integration.
4. Complete catalog-driven AR/EN for all modules, errors and templates, plus
   the remaining authenticated E2E matrix. Build other modules separately.

## Implemented

- `decimal.ts`: base-10 BigInt operations for multiplication, VAT and minor-unit
  accumulation. Numeric boundary values match PostgreSQL half-away-from-zero
  rounding. Existing numeric return types are retained for display/serialization;
  calculations do not use floating-point multiplication or accumulation.
- Shared invoice computation normalizes quantity/unit price/rate to the actual
  database scales and rejects negative net lines and out-of-range totals.
- AR VAT and debit-note calculations use the same exact arithmetic. VAT net
  position uses minor units. Invoice and debit editor previews reuse the shared
  computation rather than a separate EPSILON-based formula. Invalid/incomplete
  previews show no plausible totals. This does **not** assert that all older
  financial/payroll/display calculations have been converted.
- `save_invoice_draft_atomic(jsonb,jsonb,uuid)` commits header, line replacement
  and audit history together. It derives tenant/actor from the active caller,
  checks `user_has_permission('invoices', create|update)`, verifies party tenant,
  validates payload/dates/currency/amounts, computes numeric totals in SQL, and
  locks an existing draft. Issued/finalized/foreign/deleted invoices cannot be
  overwritten through it. No production RLS policy is loosened. Existing
  finalized/posted protections and invoice-number sequence triggers remain.
- Create/update draft actions call this RPC with the cookie-bound user client,
  retain server permission/preflight validation, and never report a failed or
  identifier-less save as success.
- Full ZATCA credential lookup moved out of a `"use server"` action file into
  `zatca-credentials.ts` with `server-only`, permission and tenant checks. The
  former exported action could return full credentials for a supplied tenant.
  No credential prefix is returned in masked summaries or audit records now.
- Explicit mock/sandbox/simulation environment boundary shared by invoice
  transport and onboarding, strict non-production gateway validation, no HTTP
  redirects, request timeout, and no raw gateway error bodies in logs/client
  errors. A URL/credentials alone cannot enable production networking.
- Production remains blocked **even if** `ZATCA_PRODUCTION_ENABLED=true` until
  the missing official integration/validation work is completed. This extra
  block is deliberate; an operator flag is not a substitute for working signing.
- One landing sign-in link, visible on mobile and desktop, enters `/platform`.
  Removed the separate hero/footer/mobile sign-in links. Canonical platform
  entry uses the configured landing origin in the existing multi-host topology.
  The supported `/auth/sign-in` session host is unchanged.
- Sign-in labels and validation descriptions now target the actual email and
  password inputs rather than their wrappers, restoring accessible names.
- Header/footer use existing bilingual catalogs; platform entry has its own
  complete AR/EN catalog. Language preference initializes before hydration,
  persists in localStorage plus a same-site cookie, survives blocked storage,
  and is carried across platform/auth hosts as a validated `lang` query.
  Shared switches no longer reload or overwrite the saved English preference.
  Invoice dates/numbers are localized; financial dates stay Gregorian.
- PR CI/preview branch filters now include `fix/rbac-completion` so this stacked
  PR is validated. No production deployment trigger was enabled or run.
- `record_finance_payment_atomic(jsonb,jsonb,uuid)` commits payment, allocations,
  durable posting event and audit together. Active caller/tenant and
  `accounting:create` checks are in SQL. Stable same-tenant request IDs serialize
  retries; a different payload cannot reuse an ID. Target locks and pending
  reservations prevent simultaneous payments from over-allocating a balance.
- Managed payment details/allocations are immutable. Posting remains an explicit
  outbox lifecycle, not part of payment recording; create-only users receive a
  saved/pending result, never a false posted result. The dialog retains its
  request ID for retries until closed/reopened.
- `void_finance_payment_atomic(uuid)` checks `accounting:approve`, locks payment
  and targets, and reverses actual posted effects together with status, event
  and audit. Repeated voids are idempotent. A journal/reversal failure rolls back
  everything. Existing reversal-date semantics are retained: a closed original
  period can prevent reversal; finance-owner approval is needed for any change.
- `dispatch_my_financial_events(integer)` uses the cookie-bound caller's active
  tenant and `accounting:approve`; the supported server action no longer invokes
  a global service-role queue dispatcher. Internal engines retain service-only
  grants. Payment posting/reversal consumers lock shared targets, and legacy
  invoker engines pin `public, pg_temp` below this guarded definer boundary.
- Product owner confirmed **SAR only**. Database constraints cover new/updated
  invoices, credit/debit notes, bank accounts and expenses. Server draft/bank
  actions reject other currencies. Payment guards reject explicit foreign
  currency, foreign-currency bank funding, and invoice-linked FX AR/AP (including
  the actual `purchase_invoice` source type). Notes require a SAR invoice in the
  same tenant. Legacy rows are not converted or relabeled.

Migration: `20261011084611_accounting_atomic_drafts.sql` (forward-only new RPC,
explicit execute grants/revokes, grant postcondition and PostgREST reload).
The RPC is deliberately SECURITY DEFINER for guarded line replacement and
append-only audit insertion, with empty search path and schema-qualified objects.
Additional migrations: `20261011101411_accounting_atomic_payments.sql` and
`20261011103905_accounting_sar_only.sql`. Both are forward-only/idempotent, have
postconditions and schema reload notifications. Review legacy currency exposure
before accepting the SAR migration; no hosted migration was executed.

## Accounting status and outstanding controls

| Resource | Repository workflow evidence | Status / work still required |
| --- | --- | --- |
| Customers/suppliers | `accounting/parties.ts`, `parties-manager.tsx`, validation migration 037 | CRUD/toggle/soft-delete/export implemented; full browser/role/error/pagination acceptance still required. |
| Chart of accounts | `accounting/actions.ts`, `chart-of-accounts-manager.tsx`, migrations 027/033 | Create/update/hierarchy/toggle and usage checks exist; deletion semantics/financial owner acceptance still required. |
| Invoices | `accounting/invoices.ts`, `invoices-manager.tsx`, migrations 038/048 and new RPC | Real draft/issue/finalize/cancel/note workflows; transactional draft save fixed. Draft update action exists but editor wiring is missing; draft archive/delete and true server pagination still needed. List and party lookups cap at 200; client filtering is not complete tenant-wide search. |
| Credit/debit notes | `invoices.ts`, manager dialogs, immutable-note triggers | Issuance exists; not editable/deletable finalized documents. Validate legal note categories/reasons, partial-credit limits and ledger/event atomicity before acceptance. |
| Payments | `payments.ts`, Accounting/payment pages, migrations 048–050 and new payment RPC migration | Record/allocate/outbox/audit and posted reversal now transactional/retry-safe; real concurrent retry/over-allocation checks pass. Authenticated UI acceptance, legacy pending-record recovery and overall lifecycle review remain. |
| Expenses | `expenses/actions.ts`, expense page, migrations 040/063 | Create/approval workflow and race guard exist; verify complete edit/delete/posted-reversal controls and journal/event outcomes. |
| Journals/periods/statements | `accounting/actions.ts`, `statements-manager.tsx`, migrations 031–036/052 | Draft/submit/approve/reject/reverse/close/reopen and statements exist; balanced/posted triggers retained. Complete behavioral acceptance and failed-event recovery remain. |

Confirmed remaining integrity gaps: `invoices.ts::emitEvent` logs/ignores failed
financial event persistence after document changes. Direct Data API financial
mutations also need lifecycle
acceptance beyond RBAC alone. Do not call the financial lifecycle fully atomic.

Numbering uses database sequences, not `count + 1`; the existing sequence can
have transaction-rollback gaps and is global across tenants. EGS invoice counters
and per-EGS previous-hash ordering are a **separate, unimplemented ZATCA control**.
SAR-only was approved by the product owner. The finance/tax owner must confirm
legal numbering, legacy FX disposition,
credit/debit-note semantics, tax categories/exemption reasons, and fiscal-period
controls before broader financial changes. Stored currency labels alone do not
establish correct multi-currency ledger or FX handling.

### SAR migration preflight (human-owned)

The five constraints are `NOT VALID` deliberately: existing foreign-currency
history stays readable and unchanged, while every subsequent insert/update must
be SAR. A trigger also prevents converting a legacy label to SAR through a draft
save/default or direct update. Existing FX records cannot be edited/archived by
ordinary writes under this constraint. There is no automatic FX conversion.

An authorized DBA must run these read-only counts in the intended environment
and give the results to the finance owner **before migration approval**:

```sql
SELECT 'invoices' AS resource, currency, count(*) FROM public.invoices WHERE currency <> 'SAR' GROUP BY currency
UNION ALL SELECT 'bank_accounts', currency, count(*) FROM public.bank_accounts WHERE currency <> 'SAR' GROUP BY currency
UNION ALL SELECT 'credit_notes', currency, count(*) FROM public.credit_notes WHERE currency <> 'SAR' GROUP BY currency
UNION ALL SELECT 'debit_notes', currency, count(*) FROM public.debit_notes WHERE currency <> 'SAR' GROUP BY currency
UNION ALL SELECT 'expenses', currency, count(*) FROM public.expenses WHERE currency <> 'SAR' GROUP BY currency;
```

For any nonzero count, the finance owner must approve a history-preserving
disposition/migration plan; do not relabel monetary values or change finalized
documents. Once history is resolved, an authorized operator may validate the
constraints in a separately reviewed migration. This gate does not certify
unchanged payroll/platform-subscription currency behavior.

## ZATCA: official evidence, not certification

Official sources inspected on 2026-10-11:

- [ZATCA XML specifications page](https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/Pages/E-Invoice-specifications.aspx).
  It links the 19 May 2023 XML implementation standard/data dictionary. The PDF
  fetch failed in this session; its full current rules were not verified.
- [Official security requirements](https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/Pages/Security-Requirements.aspx)
  and its [security standard v1.2](https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf)
  were accessible. They establish XML-signature/stamp requirements, SHA-256,
  ECDSA, previous-invoice hashing, QR security data and certificate/secret auth.
- [Developer Portal manual](https://www.zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/ComplianceEnablementToolbox/Documents/Developer%20Portal%20User%20Manual.pdf)
  was available through search excerpts, not a complete current API contract.
- [Official SDK download](https://www.zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/ComplianceEnablementToolbox/Pages/DownloadSDK.aspx)
  and [developer sandbox](https://sandbox.zatca.gov.sa/). No SDK validation,
  onboarding, sandbox submission or production submission was performed.

Current builder/transport are **not** a completed Phase 2 integration: UUID,
EGS invoice counter/previous hash persistence and concurrency control, correct
standard/simplified flags and pipeline choice, Saudi address/tax-category
validation, full XAdES/digest references and certificate verification, Phase 2
QR data, official JSON API envelope and authoritative response interpretation,
durable identical retry payloads, submission claims/reconciliation, and safe
auditable validation/rejection records remain to be implemented/tested. Mock
`NOT_VALIDATED` responses test plumbing only; a PDF or mocked reported/cleared
status is not compliance evidence. The current adapter still chooses reporting
for its sales documents; that is not correct for every invoice type.

Development configuration (server-only, never `NEXT_PUBLIC_*`): default
`ZATCA_MODE=mock` with no API base. Explicit `sandbox` uses
`https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal`; `simulation` uses
the same host's `/e-invoicing/simulation`. Verify the current gateway/API contract
in the authorized official portal before use. Store environment-matched tenant
CSIDs through the existing server setup. Older implicit URL activation now
fails closed. Environment fallback credentials and plaintext DB credential
storage still require key-management, tenant-binding, encryption/rotation and
backup-access review. Never configure production to test this slice.

A Saudi tax/accounting specialist must validate applicable invoice types,
taxpayer/branch/EGS registration, VAT categories, required Arabic invoice content,
clearance vs reporting timing, note reasons and retention. Security engineering
must validate certificate lifecycle, signing, secrets storage and SDK/sandbox
fixtures. No legal/regulatory certification is claimed.

## Localization and other modules

Shared context and entry-shell changes do not make the entire app translated.
Many accounting/dialog/status/error strings are still inline bilingual text;
company registration is Arabic-only; email/template language selection and
non-financial formatting require completion. Catalog key parity tests cover
catalogs, not every rendered string. Perform keyboard/screen-reader, responsive
and RTL visual QA across all modules before claiming app-wide coverage.

Remaining dashboard modules are not declared complete by this slice:

| Modules / routes | Inspection evidence and current classification |
| --- | --- |
| Drivers, vehicles, users, roles, approvals, audit log, security, applications | Real schema/RPC/RLS/action and existing test surfaces in this baseline. Functional/acceptance completion not re-certified here; unchanged. |
| Payroll | Real rule/calculation/approval/cancellation code and tests; unchanged, accounting integration acceptance pending. |
| Attendance, HR | Pages read `driver_attendance` / `performance_reviews`; wider CRUD coverage and UX remain unverified. |
| Platforms, orders | Pages read `delivery_platforms` / `daily_order_entries`; full workflows remain unverified on this branch. Other unmerged branches are not silently included. |
| Maintenance, violations | Pages read `vehicle_maintenance_events` / `violations`; full CRUD/approval integration not established by this slice. |
| Reports | Reads `report_generation_log` and `generated-reports` Storage; full generation/access/export acceptance remains unverified. |
| Templates | `/templates` redirects to `/dashboard`; it is not a complete template-management module. |
| Dashboard, settings, company/language/MFA/payroll-default settings | Existing surfaces; shared locale improved but business behavior/permission acceptance still required. |
| Dashboard-2, calendar, chat, mail, tasks, FAQs, pricing | Routes exist; not audited/implemented as business modules here. Do not present them as completed SaaS features. |

## Release safety / manual checks

- Company registration in this base still creates Auth/tenant/profile/membership
  separately and returns anti-enumeration success on Auth errors. Registration
  consistency remains a confirmed blocker; reconcile the other checkout's
  pending registration work before accepting this flow. This slice does not
  submit a registration, recovery email or test invoice to production.
- Successful sign-in/MFA/registration/confirmation/recovery, Accounting CRUD,
  tenant A/B, low-privilege and disabled users need authenticated browser
  acceptance on an authorized local/staging environment, with disposable test
  accounts. Operators provision these through the existing secret setup; no
  credential values are requested in chat.
- DevOps reviews migration/deployment-role configuration, Supabase redirect
  allowlists, secrets presence, preview builds, backup restore, rollback and
  alert tests. This PR must not be merged/deployed before those approvals.
- Stacked PR CI triggers are enabled here. The prior #66 E2E environment lacked
  `STAGING_URL`, `TEST_USER_EMAIL`, `TEST_USER_PASSWORD`; do not infer green E2E
  or two green Vercel deployments from local build results.
- `pnpm audit --audit-level=high` exits 0 **with one ignored high advisory**, not
  zero high vulnerabilities. Existing `ignoreGhsas` includes
  [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), a
  `braces` deeply nested pattern DoS with no published patched version at this
  inspection. `pnpm audit --json` exits 1 and reports one high/zero critical.
  Security owner must review reachability/exception and track a patch; until
  then restrict tooling to trusted glob patterns and treat dependency gate as
  qualified, not clean. No exception was added or expanded here.

## Local verification

Disposable project `saas-accounting`, API 57321/DB 57322, separate from existing
local stacks and the hosted project `wwfnsbilmyxeawgzicmv`. Migrations/tests/seed
were copied unchanged into `.artifacts/accounting-local/supabase` with a local
CLI config; that disposable directory is not part of the PR.

Exact database commands:

```powershell
supabase start --workdir .artifacts/accounting-local --exclude studio,imgproxy,edge-runtime,logflare,vector,postgres-meta
supabase db reset --local --workdir .artifacts/accounting-local
docker exec supabase_db_saas-accounting psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;"
supabase test db --local --workdir .artifacts/accounting-local
```

First-slice database result: **18 files / 2,283 assertions PASS**, including
`079_accounting_draft_atomic_tests.sql` **31/31**. Tests prove exact half-cent
math, actual line-insert fault rollback of creation and replacement, unchanged
original lines/header/audit after failure, foreign invoice/customer rejection,
read-only/locked/inactive/deleted/JWT-less/anonymous rejection, and immutable
issued drafts. All earlier 2,252 assertions pass unchanged. Initial failures in
this new slice (incorrect helper signature and fixture enum, plus a disposable
config schema reference) were corrected, not skipped.

First-slice unit verification: `pnpm test --maxWorkers=1` **55 files / 592 tests PASS**.
The default parallel run hit the existing font-policy filesystem-scan 5s
timeout; the single-worker run executes all the same assertions. No assertion
or timeout was weakened. Focused tests include `decimal.test.ts`,
`invoice-math.test.ts`, `invoices.test.ts`, `zatca-config.test.ts`, credential/
adapter/transport tests, `landing-auth.test.ts`, locale initialization/catalog/
format tests and platform sign-in handoff tests.

Public Chromium checks: `BASE_URL=http://localhost:57400 pnpm exec playwright
test e2e/public-entry.spec.ts --project=chromium` **5/5 PASS**, using the disposable
local database/server. Covers desktop/mobile single entry, persisted RTL, platform
handoff, accessible auth fields, recovery/registration forms and anonymous
Accounting redirect. Initial runs exposed cold compilation and the real input
label defect; the final unchanged assertions pass after correcting that defect.
No successful registration/login or recovery-email submission is claimed.

First-slice local checks: `pnpm exec tsc --noEmit` PASS; `pnpm lint` PASS with
0 errors / 86 warnings; `pnpm build` PASS (79 static-page generation entries);
`git diff --check` PASS. `node scripts/verify-deploy-config.mjs` PASS and
`node scripts/verify-api-guards.mjs` PASS (19/19 guarded/allowlisted routes).
After adding HTTP redirect/timeout assertions, the two transport/onboarding
test files passed again (20/20). No unrelated warning cleanup was included.

A build alone does not test live financial workflows,
hosted RLS/Storage or the official ZATCA sandbox. No production migration,
production configuration change, production data mutation or deployment was run.

## Payment/SAR continuation — verified locally

Final clean reset applied all migrations, followed by the **complete** collection:
**20 files / 2,363 assertions PASS**. New suites:
`080_accounting_payment_atomic_tests.sql` **51/51** and
`081_accounting_sar_only_tests.sql` **29/29**; previous 2,283 assertions remain
green. The first SAR run failed because a new EUR invoice fixture omitted the
required customer and never reached its currency assertion; the fixture was
corrected, not the assertion. No legacy suite was skipped/weakened.

Named output captured from real local SQL execution:

```text
ok 12 - Foreign party rejected
ok 13 - Foreign target rejected
ok 17 - Allocation failure aborts header
ok 19 - Outbox failure aborts header and allocations
ok 28 - Receipt ledger balances
ok 29 - Foreign queue untouched
ok 31 - Reversal failure aborts void
ok 43 - Actual foreign payment inaccessible
ok 44 - Read-only cannot record
ok 47 - Locked JWT cannot record
ok 51 - Anonymous dispatch denied
```

SAR suite output includes:

```text
ok 10 - Draft defaults cannot silently relabel a legacy invoice
ok 13 - Direct invoice insert cannot bypass currency check
ok 16 - Foreign-currency expense rejected
ok 25 - Legacy FX bank cannot fund a SAR payment
ok 26 - Legacy FX receivable cannot be paid as SAR
ok 27 - Legacy FX payable cannot be paid as SAR
ok 28 - Rejected FX operations leave no payments
ok 29 - Rejected FX operations leave no allocations
```

The separate two-connection test also passed, twice:

```powershell
node scripts/verify-payment-concurrency.mjs --local-disposable
```

```text
Replay race: two successful requests, one payment and one audit; same identifier.
Allocation race: one committed payment; one PMT001 rejection; reserved total 80.00, balance 100.00.
PASS. Reset the disposable saas-accounting DB to remove these fixtures.
```

The final reset was **after** this command, removing its committed fixtures.
The script is restricted to the named disposable Docker container and accepts
no hosted URL/key. Both SQL suites use rolled-back transactions.

Additional actual commands/results:

```powershell
supabase db advisors --local --workdir .artifacts/accounting-local --type security --level error --fail-on error
supabase migration list --local --workdir .artifacts/accounting-local
pnpm test --maxWorkers=1
pnpm exec vitest run src/lib/accounting/payments.test.ts src/lib/accounting/dispatcher.test.ts src/lib/accounting/invoices.test.ts
pnpm exec tsc --noEmit
pnpm lint
pnpm build
node scripts/verify-api-guards.mjs
node scripts/verify-deploy-config.mjs
git diff --check
pnpm audit --audit-level=high
```

Security advisors: no error-level issues (not a claim about warnings or complete
security). Local migration history matches all files. Full units: **57 files /
615 tests PASS**. Focused payment/dispatcher/invoice actions: **30/30 PASS**.
TypeScript, lint (**0 errors / 85 warnings**), production build (**79 page entries**),
API guard script (**19/19**), deployment config script and diff check pass on the
final source. Audit still reports **one ignored high**; unfiltered audit reports **1 high /
0 critical**, not a clean dependency gate. A staged-diff credential-pattern check
passed; no environment/config credential file was staged.

Every file changed by this continuation (earlier PR files are listed by Git):

- `src/app/(dashboard)/accounting/page.tsx`
- `src/lib/accounting/payments.ts`
- `src/lib/accounting/payments.test.ts`
- `src/lib/accounting/dispatcher.ts`
- `src/lib/accounting/dispatcher.test.ts`
- `src/lib/accounting/invoices.ts`
- `src/lib/accounting/invoices.test.ts`
- `supabase/migrations/20261011101411_accounting_atomic_payments.sql`
- `supabase/migrations/20261011103905_accounting_sar_only.sql`
- `supabase/tests/080_accounting_payment_atomic_tests.sql`
- `supabase/tests/081_accounting_sar_only_tests.sql`
- `scripts/verify-payment-concurrency.mjs`
- `docs/saas-accounting-delivery.md`

External evidence inspected for prior PR #67 head `eb68166`: CI, pgTAP, preview
workflow and `elite-dashboard` Vercel preview passed. E2E **failed configuration**:
`BASE_URL`, `TEST_USER_EMAIL`, `TEST_USER_PASSWORD` were missing. DevOps must
configure the workflow's existing `STAGING_URL`, `TEST_USER_EMAIL`,
`TEST_USER_PASSWORD` secrets through GitHub secret management, with an authorized
staging account, then rerun authenticated acceptance. Staging Supabase variables
were also empty and must be checked against the test setup's needs. The
`elite-dashboard-b2b` preview reported **Deployment was blocked**; its Vercel
operator must investigate access/project configuration. Production was skipped.
New commit checks must be evaluated independently; those earlier passes are not
evidence that the updated head has passed CI. No protection was bypassed.

Remaining launch gates are unchanged: invoice/note event consistency and other
Accounting CRUD/pagination work, company registration recovery, full app/email
localization, official ZATCA SDK/sandbox validation, credential key-management,
authenticated tenant/role/disabled-user browser acceptance, dependency exception
review, staging migration/RLS/Storage verification, backup restore, rollback and
monitoring tests. SAR-only approval does not resolve those gates. The product
is still partial delivery and the PR stays draft.
