# SaaS implementation — first reviewable slice (2026-10-11)

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

Migration: `20261011084611_accounting_atomic_drafts.sql` (forward-only new RPC,
explicit execute grants/revokes, grant postcondition and PostgREST reload).
The RPC is deliberately SECURITY DEFINER for guarded line replacement and
append-only audit insertion, with empty search path and schema-qualified objects.

## Accounting status and outstanding controls

| Resource | Repository workflow evidence | Status / work still required |
| --- | --- | --- |
| Customers/suppliers | `accounting/parties.ts`, `parties-manager.tsx`, validation migration 037 | CRUD/toggle/soft-delete/export implemented; full browser/role/error/pagination acceptance still required. |
| Chart of accounts | `accounting/actions.ts`, `chart-of-accounts-manager.tsx`, migrations 027/033 | Create/update/hierarchy/toggle and usage checks exist; deletion semantics/financial owner acceptance still required. |
| Invoices | `accounting/invoices.ts`, `invoices-manager.tsx`, migrations 038/048 and new RPC | Real draft/issue/finalize/cancel/note workflows; transactional draft save fixed. Draft update action exists but editor wiring is missing; draft archive/delete and true server pagination still needed. List and party lookups cap at 200; client filtering is not complete tenant-wide search. |
| Credit/debit notes | `invoices.ts`, manager dialogs, immutable-note triggers | Issuance exists; not editable/deletable finalized documents. Validate legal note categories/reasons, partial-credit limits and ledger/event atomicity before acceptance. |
| Payments | `payments.ts`, Accounting/payment pages, migrations 048–050 | Record/allocate/void exists; record path uses separate payment/allocation/event writes. Transactional save and concurrent over-allocation tests remain necessary. |
| Expenses | `expenses/actions.ts`, expense page, migrations 040/063 | Create/approval workflow and race guard exist; verify complete edit/delete/posted-reversal controls and journal/event outcomes. |
| Journals/periods/statements | `accounting/actions.ts`, `statements-manager.tsx`, migrations 031–036/052 | Draft/submit/approve/reject/reverse/close/reopen and statements exist; balanced/posted triggers retained. Complete behavioral acceptance and failed-event recovery remain. |

Confirmed remaining integrity gaps: `invoices.ts::emitEvent` logs/ignores failed
financial event persistence after document changes, and payment creation uses
multiple writes. Direct Data API financial mutations also need lifecycle
acceptance beyond RBAC alone. Do not call the financial lifecycle fully atomic.

Numbering uses database sequences, not `count + 1`; the existing sequence can
have transaction-rollback gaps and is global across tenants. EGS invoice counters
and per-EGS previous-hash ordering are a **separate, unimplemented ZATCA control**.
The finance/tax owner must confirm legal numbering, currencies/FX treatment,
credit/debit-note semantics, tax categories/exemption reasons, and fiscal-period
controls before broader financial changes. Stored currency labels alone do not
establish correct multi-currency ledger or FX handling.

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

Final database result: **18 files / 2,283 assertions PASS**, including
`079_accounting_draft_atomic_tests.sql` **31/31**. Tests prove exact half-cent
math, actual line-insert fault rollback of creation and replacement, unchanged
original lines/header/audit after failure, foreign invoice/customer rejection,
read-only/locked/inactive/deleted/JWT-less/anonymous rejection, and immutable
issued drafts. All earlier 2,252 assertions pass unchanged. Initial failures in
this new slice (incorrect helper signature and fixture enum, plus a disposable
config schema reference) were corrected, not skipped.

Unit verification: `pnpm test --maxWorkers=1` **55 files / 592 tests PASS**.
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

Final local checks: `pnpm exec tsc --noEmit` PASS; `pnpm lint` PASS with
0 errors / 86 warnings; `pnpm build` PASS (79 static-page generation entries);
`git diff --check` PASS. `node scripts/verify-deploy-config.mjs` PASS and
`node scripts/verify-api-guards.mjs` PASS (19/19 guarded/allowlisted routes).
After adding HTTP redirect/timeout assertions, the two transport/onboarding
test files passed again (20/20). No unrelated warning cleanup was included.

A build alone does not test live financial workflows,
hosted RLS/Storage or the official ZATCA sandbox. No production migration,
production configuration change, production data mutation or deployment was run.
