# Production module review — 18 October 2026

## Decision

The app is not yet ready to advertise every business capability as production complete. Core internal workflows have release-test coverage, but tax-invoice company setup, external provider acceptance, and a few explicitly limited screens remain. A loaded page is not evidence that its CRUD works.

This review covers the repository's shipped business routes, language selection and landing-to-dashboard authentication. It does not certify Saudi tax compliance, bank acceptance, third-party settlements, or production capacity under a representative customer load.

## Language and authentication changes

- One locale context now controls marketing, company registration, authentication and dashboard interface copy. Switching updates `lang` and `dir`, persists without a forced reload and synchronizes existing tabs. Blocked browser storage does not prevent the current switch. A non-sensitive `lang` parameter carries preference between configured deployment hosts.
- Static labels, forms, status badges, table headings, loading/error states, help and legal text use the selected interface language. Names, notes, document contents and other customer-entered business data retain their original content. The reference invoice intentionally remains the requested bilingual document.
- Authenticated users arriving at the sign-in entry point reuse a server-verified session. Refreshed cookies reach both Server Components and the final response, including redirects. Successful sign-in performs a fresh navigation so stale unauthenticated router data cannot prompt a second login.
- Return paths retain their query parameters and reject external targets, backslashes, control characters and authentication loops. Account restrictions, MFA enrollment/challenge, tenant authorization and role guards remain enforced.
- Fresh sign-in and subsequent MFA/password redirects explicitly carry the selected locale, so the current authentication journey stays in English or Arabic even when preference storage is blocked.
- The unfinished custom-report choice is disabled. Spreadsheet-facing accounting/report CSV cells neutralize formula-like text while preserving numeric balances.
- The module review also found hardcoded day 31 in the orders list and reconciliation report. Both now reuse the existing calendar-correct month-boundary helper, including February/leap years and 30-day months.

## Module assessment

“Core implemented” describes source and release-test evidence; it does not promise that every permutation has been manually exercised. Delete operations may intentionally mean archive, cancellation or reversal for audit integrity. Financial documents become immutable after finalization/posting.

| Module | Assessment | Evidence and remaining condition |
| --- | --- | --- |
| Dashboard | Core implemented | Tenant summaries and navigation; bilingual route/data-read checks required for this candidate. Representative production-load acceptance is separate. |
| Drivers | Core implemented | Profile create/edit/archive and driver-level operational records exist; permission-dependent controls must remain restricted. |
| Vehicles | Core implemented | Fleet create/edit/archive and assignments exist; operational fixtures and real tenant setup remain necessary. |
| Attendance | Implemented with workflow limitation | Global list is an overview. Attendance mutations are available from the driver profile, not a separate complete global editor. |
| Orders | Core implemented | Authorized order/settlement workflows exist. External platform reconciliation requires provider-specific acceptance. |
| Platforms | Core CRUD tested | Prior isolated hosted tests covered create, edit-field initialization and deactivate. No claim of automatic third-party synchronization. |
| Payroll | Internal workflow implemented | Database integrity and authorization have regression coverage. Bank-specific WPS acceptance and live banking submission are not certified. |
| Expenses | Core implemented | Authorized expense workflows and accounting controls exist; company tax configuration and finance-owner acceptance are required. |
| Invoices | Conditional production use | Isolated hosted create/edit/delete, audit, mobile, print/PDF and pagination checks passed in the preceding release. All seven invoicing production tenants lacked valid VAT configuration at that review. Genuine company details must be entered before tax printing; values must not be invented. ZATCA production submission is unvalidated. |
| Accounting | Core draft workflows tested | Isolated hosted journal draft CRUD, bank lifecycle and payment-bank pagination passed. Posted entries use controlled reversal rather than unrestricted edit/delete. Accountant sign-off on opening balances, mappings and reporting is still required. |
| Payments | Core transactional workflow tested | Database payment-race checks, recording/reversal and SAR safeguards passed in the preceding release. External payment-provider acceptance is separate. |
| Maintenance | Core lifecycle tested | Isolated hosted create/edit/start/complete passed. Production mutations were not used as smoke tests. |
| Violations | Implemented with workflow limitation | Global overview; driver-profile mutations and review actions. Not a standalone complete global CRUD workspace. |
| HR | Implemented with workflow limitation | Reviews/training/leave are managed through driver profiles. The HR route is an overview, not a full HR/payroll regulatory suite. |
| Applications | Core implemented | Application intake and authorized review exist. Email/delivery and real onboarding acceptance depend on configured services. |
| Reports | Partially complete | Named report collectors and exports exist; the custom collector only echoes parameters, so its UI choice is disabled. Do not advertise arbitrary custom reports. |
| Users | Core implemented | Tenant user management and role assignment exist; invitations/reset mail require verified delivery configuration. |
| Roles | Read-only catalog | Displays system/custom roles. No full role/permission editor is provided. Standard assignment/permissions are enforced elsewhere. |
| Approvals | Core implemented | Authorized review decisions and audit evidence exist; actual company approval policy needs business-owner acceptance. |
| Audit log | Read-only by design | Audit records are intended for viewing, not editable CRUD. Verify retention/export requirements for each customer. |
| Security | Core controls implemented; setup outstanding | MFA, account restrictions, RLS and authorization are covered by regression tests. Supabase leaked-password protection was disabled at the preceding review. |
| Settings | Core implemented; tenant setup outstanding | Company/security/user configuration exists. Genuine VAT, legal/company identity and finance settings must be completed before related workflows are enabled. |

The platform administrator console is a separate allowlisted, MFA-protected surface. Tenant credentials must not grant access. Legacy template demonstrations redirect to shipped functionality and are not additional production modules.

## Verification evidence and limits

Baseline release: PRs [74](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/pull/74) and [75](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/pull/75), production commit `2fbca4fb7881a05a264a41443e716fd3930d91ca`. [Release CI](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/actions/runs/38930605475) passed 660 unit tests, 2,468 database assertions, eight Auth/Storage tests, payment concurrency checks, 17 hosted smoke tests, lint, types and production build. Hosted mutation/PDF/MFA checks used synthetic staging data.

This candidate adds dedicated tests for landing/auth language switching, persistence, existing-tab synchronization, unavailable storage, single-login continuity and all 22 business module routes in both languages, including failed data-read detection. New unit tests cover refreshed/cleared proxy cookies, MFA redirects, safe return paths, static translations and CSV formula protection. Candidate results and deployment identity must be recorded after execution; until then this document is a review of a release candidate, not a statement that these changes are live.

Candidate validation recorded locally: 689 unit tests passed, including reconciliation date boundaries and locale preservation through MFA/password gates; lint passed with no errors and 86 warnings; TypeScript, the production build, API route guards and deployment configuration checks passed. On the Git-linked staging preview, invoice CRUD/VAT/mobile/print/PDF/audit, journal CRUD, bank lifecycle, payment-bank pagination/search, platform CRUD, maintenance lifecycle, and owner MFA enrollment/sign-out/returning challenge all passed without browser runtime errors. These mutations used synthetic staging workspaces. Desktop/mobile review in both languages found an overflowing English landing navigation, which was corrected with a responsive menu and covered by an overflow/navigation regression check. Confirmation captures at 1440px and 390px showed no horizontal viewport overflow in either language.

The latest CI, hosted locale sweep and release/deployment outcome are recorded on [PR #76](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/pull/76). Test workflows reject a production-bound preview before sending staging credentials.

No production business records, production secrets, or database schema are changed by the locale/session release. Production verification should remain read-only; mutation tests belong in isolated staging.

## Outstanding before unrestricted launch claims

1. Complete genuine VAT/company configuration for each invoicing tenant and verify its tax document using authorized business data.
2. Obtain provider acceptance for ZATCA production, WPS bank files and external payment/platform webhook delivery, replay and reconciliation. Keep unsupported integrations disabled.
3. Enable and verify Supabase leaked-password protection through the project's approved configuration process.
4. Decide whether the read-only role catalog, overview-only HR/attendance/violations entry points and disabled custom reports match the advertised product scope. Build missing workflows before promising them.
5. Run representative capacity, restore/incident response and operational delivery acceptance for the intended launch volume. Earlier backup/restore evidence is useful but is not an ongoing operations guarantee.
6. Complete server-side pagination and full-dataset search for capped overview lists. Examples include drivers/vehicles/attendance/expenses/HR/violations (100 rows), orders/applications (200), and several accounting journal/receivable/payable views (100–200). The platform-payments overview is also capped at 100. These screens must not be interpreted as exhaustive totals or full-ledger searches. The paginated invoice manager and payment-bank picker do not resolve every other module's limits.
7. Harden report collectors and overview loading errors: several existing callers discard query errors and can show an empty result instead of an explicit failure. The bilingual route sweep checks failed HTTP reads, but it cannot prove every server-side export/query failure is surfaced correctly. Financial/report completeness needs additional acceptance before unrestricted launch.

CSV mitigation follows the spreadsheet-viewing trade-off described by [OWASP](https://community.owasp.org/attacks/CSV_Injection): dangerous text receives a tab inside a quoted field. This changes that exported cell's underlying text; downstream machine importers should use a defined data interchange format rather than treating a human-facing spreadsheet export as lossless input.
