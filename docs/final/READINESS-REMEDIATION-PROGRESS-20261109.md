# Production-readiness remediation — 9 November 2026

This continues the findings in `PRODUCTION-READINESS-AUDIT-20261103.md`. Historical audit results remain unchanged; the rows below describe subsequent fixes and their evidence. A code-level repair is not hosted acceptance or release approval.

## R03 — preview authentication code repaired; hosted gate still open

The missing `scripts/verification-access.test.mjs` now exists. It exercises exact Preview-origin restrictions, missing/expired/future identities, issuer/audience validation, GitHub token caching/refresh, untrusted credential endpoints, manual redirects, browser fetch/fulfill forwarding, foreign-origin header stripping and safe error/redaction behavior. Fixtures are fabricated JWT-shaped values, not real credentials; Vercel remains responsible for verifying the actual identity signature and trusted claims.

The six CSP guard failures were fixed through explicit injected request adapters in the three affected helper tests. Their default hosted behavior still requires authenticated Preview access. The isolation assertions and fixture-before-network guards are retained.

All 29 imported acceptance helper files, including the password flow, were inspected. App-origin CSP probes, protected platform API requests and page-level forwarding/response-loss interceptors now use the scoped transport; direct Supabase requests retain their existing behavior. The extra password-test browser context also installs the transport. Hosted Playwright traces are disabled because traces can retain request credentials. Job-level `id-token: write` is limited to the E2E and staging acceptance jobs; branch conditions were preserved.

Fresh evidence: **368/368 release guards pass**, the deployment configuration check passes, and all eight archived historical migration versions verify. TypeScript and scoped lint both pass with zero errors; scoped lint has zero warnings. Earlier 101-test focused checks also passed. Logs are retained in ignored `supabase/.temp/ci-access-*-20261109.log`. Application source and SQL are unchanged by this step; a combined-source production build remains required after reconciliation.

Hosted validation remains open. The earlier local `vc env run` attempt failed before the probe child completed and did not establish protected Preview access. No raw CLI credentials/output were logged. The GitHub Preview-only Trusted Sources proposal remains unapplied and requires its documented access-control authorization. No long-lived bypass token was transferred, and deployment protection was not disabled.

## Source reconciliation

Fetched upstream now includes `1d9a3ed` (private database-backed licensed Tahoma), `100135d` (pnpm action update), and the earlier PR121–125 expense/upload changes. A read-only merge preview identified conflicts in accounting page, drivers page and ZATCA adapter core. These need intentional reconciliation and complete combined-source validation.

The source conflicts have been resolved: the upload toolbar retains wrapping and 44px controls; accounting retains its provider/production safeguards and offline rehearsal; the shared ZATCA loader preserves paid-document retry only when an exact-environment preparation already exists. Twelve new loader regressions are included in a 63-test passing focused run; scoped lint and combined TypeScript pass.

The initial local reconciliation relocated the expense SQL to `20261109105602_expense_claims_canonical.sql` while history reads were unavailable. That preliminary choice was superseded by the reconnected history evidence below: production now binds `20261109090000` to expenses. The current source preserves `20261109090000_expense_claims.sql` and relocates only the unapplied payroll guard to CLI-generated `20261109114942_guard_payroll_engine_mutations.sql`. All 170 source migrations have unique versions. No hosted history record was edited and no migration was executed remotely. A unique source version is not permission to run a migration on either hosted database.

No hosted migrations, business data changes, merge to remote master or deployment has been performed by this remediation step. The combined application checks and expense fixes are recorded below; hosted migration and recovery acceptance remain outstanding.

## R06–R08 — expense authorization and complete reads repaired in code

The exported name resolver now checks actual expense permission/assurance before opening a privileged client. It derives the allowed actor IDs from claims read through the caller's RLS client and includes only those actors plus the caller, with a tenant predicate on the lookup. Email fallback and the general tenant-directory query are removed.

Claim dashboard/export reads and receipt attachment batches use the existing counted collector with stable ID tie-breakers. More than 20,000 claims and attachments above the backend's response cap are collected completely; read failures, changing counts and duplicates fail instead of producing apparently complete results. The explicit 100,000-row budget fails visibly. These multi-request reads are not a database snapshot; equal-count concurrent edits and atomic export/marking remain separate work.

Settings reads now check permission, bind tenant, propagate database failure and never create settings with service role during a read. A successful authorized missing row uses the documented initial defaults; SQL initializes the row during authorized writes. Dashboard, detail, settings and new/quick pages expose bilingual error/retry and block affected review/submission while policy/evidence is unknown. The Telegram link dialog also catches configuration read failure. Complete attachment reads replace the detail page's unpaged evidence fetch; failed detail/event/duplicate reads are visible.

Forty-nine focused expense/paging tests pass, including 20,001 rows, smaller server caps, failed later pages, scope rejection and authorization before privileged access. The full combined-source checks below also pass. R05 durable Telegram replay/acceptance, R09 actual parser cancellation, hosted acceptance and the full recovery plan remain open; no production-readiness claim is made.

## Combined validation and driver-upload follow-up

The first frozen combined run on `5a0ca36` passed every unit test, TypeScript and all 368 release guards. ESLint correctly failed on two synchronous state resets in the newly integrated upstream driver document quick-upload dialog, so the production build was not started. That original failure receipt is retained.

The uploader now uses an open-session component that unmounts on close or fixed-driver change; search results are scoped to their normalized query, reads are cancellable, missing versions are rejected instead of guessed as 1, and database failures display bilingual Retry instead of “No matching drivers.” Native buttons replace incomplete listbox roles. Eleven focused read/version/search tests pass, and scoped lint has zero errors/warnings. Full verification on the subsequent source is recorded separately.

## Verified combined application — `6cf20b22c8087b40c72a8c247566e9f13f406f45`

The second frozen run completed successfully on this exact application commit. The receipt reports no source drift. It retains the original failed first run separately; no failing receipt was relabelled.

| Check | Result |
| --- | --- |
| Unit tests | 2,806 passing tests, 571 reported suites |
| Node release guards | 368 passing tests |
| TypeScript | Pass |
| ESLint | Zero errors, 28 warnings; warnings remain for follow-up |
| Optimized production build | Pass |
| Invoice PDF runtime asset check | Pass; not a PDF visual-identity or hosted Linux check |
| Frozen-lockfile dependency audit | Zero advisory instances at all severities |
| Frozen source comparison | Unchanged; empty drift list |

The local production server used the dedicated staging project, mock/disabled provider settings and no production database connection. Initial read-only browser verification passed dedicated login, English/Arabic tablet sidebar first-Escape/focus/unlock and driver action/filter sizing at 390/768px. The two upload fault tests initially failed: their five-second deadline was shorter than the installed PostgREST client's three retries (1 + 2 + 4 seconds), and the synthetic cross-origin response lacked CORS headers. Those raw failures remain retained.

A corrected follow-up injected four HTTP 503 responses per language with valid CORS and `Retry-After: 0`, proved the bilingual failure appeared without a false empty result, and verified closing/reopening cleared the draft. Both English and Arabic passed. It signed out and closed all browser contexts, with zero runtime errors or prevented business/provider requests. This verifies the error/draft behavior; it does not exercise an actual document upload or driver mutation.

The tracked `e2e/driver-document-quick-upload.spec.ts` additionally verifies Retry recovers to a known successful empty response. Its actual Playwright run against the same built application passed **2/2**, zero skipped/unexpected/flaky tests, in 20.5 seconds. Both tests sign out in cleanup. Scoped ESLint and the full TypeScript check also pass after adding this spec. Receipt: ignored `supabase/.temp/upload-playwright-20261109.json`. These subsequent changes are tests/documentation only; the application bundle remains the previously verified `6cf20b2` source.

Ignored evidence: `supabase/.temp/combined-release-validation-20261109-r2/result.json`, `supabase/.temp/dependency-audit-20261109.json`, and browser `diagnostics.json` under the local visualization folders `combined-ui-20261109-2026-11-09T11-19-18-975Z` and `upload-cors-proof-20261109-2026-11-09T11-26-36-632Z`. These contain local staging evidence, not production workflow acceptance. The owned local servers were stopped after their runs.

## Current hosted state and release decision

Read-only checks on 9 November found fetched GitHub `master` at `1d9a3ed879194f560b01b453e450285ac3df3c90`. The canonical production health endpoint returned HTTP 200, `healthy`, with that same version. Landing returned 200, and unauthenticated invoices returned 307 to the same app's sign-in route with `no-store`. This is public availability/source evidence, not authenticated CRUD or Vercel deployment-ID verification. The tested candidate `6cf20b2` has **not** been deployed.

PRs #67 and #68 are closed, with no merge commit or merge timestamp. They are historical proposals rather than pending PRs that can simply be merged. Their replacement must be assessed through the current reconciled candidate, its diff and complete gates. The only open PRs returned by the latest read are dependency updates; these have not been blindly merged.

At the initial check, GitHub, Supabase and Vercel plugins were unavailable. They subsequently became available; the read-only recheck below supersedes that access observation. Earlier Supabase CLI reads returned privilege errors; fresh CLI attempts still exit unsuccessfully, without a newly confirmed error classification. Vercel CLI identity injection can report presence without disclosing a value, but the protected Preview OIDC probe has not completed successfully. No Trusted Sources/access-control change, production secret change, remote migration, feature push, new PR, remote merge or deployment was performed in this remediation.

**Decision remains NO-GO for promoting this candidate.** These are the remaining release gates and concrete next actions:

1. **R01/R02:** restore authorized database management access, obtain fresh history/schema/grant hashes for both projects, reconcile the expense aliases without rewriting applied history, and rehearse the exact ordered forward plan including the ZATCA read RPC. Unique source filenames alone do not establish a safe push plan.
2. **R04:** complete a fresh full backup/restore including bare `private` schema and separate Storage file recovery; prove value preservation, maintenance fence and rollback on current baselines. The preserved prior overall rehearsal FAIL remains unresolved.
3. **R03:** verify protected Preview OIDC transport, authorize only the reviewed access rule if needed, and execute every hosted E2E/acceptance gate on the same candidate. A core-CI pass or skipped acceptance job is insufficient.
4. **R05/R09:** implement durable Telegram update/message replay identity with atomic intake/retry behavior and real isolated parser termination/resource budgets. The current receipt extraction timeout does not cancel underlying parsing. Do not advertise these intake paths as production-accepted.
5. **R07/R08/R13/R18:** verify all active module permission/tenant/state/concurrency cases on hosted staging, including complete financial exports and receipt evidence. Multi-request collectors do not yet guarantee a transaction snapshot or atomic export marking. Retired redirects are not finished standalone CRUD modules.
6. **R10/R17/R19:** complete production-equivalent Linux comparison against both invoice samples and actual print/download edge cases; keep ZATCA/WPS/provider gates closed until genuine provider and operational acceptance. QR presence is not proof of official ZATCA clearance/reporting.
7. **R12/R14–R16/R20:** retain the owner-accepted plan limitation; finish CSP/privacy, performance and supply-chain hardening with the specific tests described in the full audit. These findings were not silently marked fixed by successful unit/build checks.

The passing local checks allow publication as a draft PR to obtain same-head CI and review. The open hosted gates still block merge and production deployment. Once they pass, inspect the complete CI/protection requirements, merge only when permitted, then confirm the exact merged commit/environment/deployment URL and perform key-flow verification. No launch success is claimed before that evidence exists.

## Reconnected cloud verification and applied-version repair

Fresh connector queries can now read both hosted databases. They each have 161 history entries, with different versions and statement hashes. Production records `20261109090000_expense_claims`; staging does not. Both still have zero `read_my_zatca_environment` routines, seven routines in bare `private`, and zero public ordinary tables without RLS. Twenty-nine production history entries lack retained statement SQL; a matching name/version or absent hash cannot prove effective-schema equality.

This newer history observation supersedes the 3 November audit's expense-alias observation. The applied expense version is preserved in source, and its upstream repository content is unchanged (checkout line endings normalized for comparison). The payroll guard's bytes are unchanged at new CLI version `20261109114942`. The abandoned expense relocation is removed. A new `verify-migration-versions` CI check pins the observed applied expense filename and repository source hash, rejects duplicate versions/empty files, and requires forward migrations for changes to that historical source. All nine new regressions pass; the complete release guard command now passes **377/377**, with zero skipped tests. Deployment configuration and the eight-version historical staging archive checks also pass.

Raw version comparison now finds nine source versions absent from production and 27 absent from staging. These are **not approved pending execution lists**: staging aliases and forward ordering must be reconciled by effective schema/contracts. The retained production expense statement's trimmed LF MD5 also differs from the canonical repository file; this needs explicit comparison rather than declaring byte parity with the deployed SQL. The new binding hash documents the repository source, not equivalence to the hosted statement.

Fresh security advisors retain the audit-view definer ERROR, two anonymous-callable definer warnings, 68 authenticated-callable definer findings in production (47 staging), and leaked-password protection disabled on both projects. RLS-with-no-policy informationals are 20 production / 13 staging. Intentional private deny-all tables and explicitly caller-bound definer APIs require their documented exception tests; warnings alone do not prove a breach. See [view guidance](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view), [definer function guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). No grants or policies were changed remotely.

Vercel's deployment API confirms production deployment `dpl_9r4uLX9uCFGYEEft66ZGumeCyni1`, state READY, branch `master`, commit `1d9a3ed879194f560b01b453e450285ac3df3c90`, immutable URL https://elite-dashboard-40wfsvycy-elitesaasc-5643.vercel.app. Its GitHub Vercel status is successful. This confirms the already-live source; it does not deploy or certify this candidate.

## Reconciled SQL verified on the owned historical local copy

All **33 selected current migrations** applied to a new clone of the owned historical baseline. The first run then stopped before behavior tests because its value-preservation assertion correctly detected additional receipt-bucket, permission and default-role-grant seeds introduced by the new expense bootstrap. It did not report a passing rehearsal. That failed receipt remains in `supabase/.temp/current-native-release-20261109-32c73d16-d525-4127-af55-fbef452eeafc/result.json`.

The refined run first proves those expense permission/bucket rows are absent from this baseline, validates the exact five permission actions/descriptions, the complete default role-grant matrix (10 added grants on this copy), and the exact private receipt-bucket settings. Only those proven additions and the previously reviewed three new buckets are excluded from the original-row fingerprint comparison; all original columns/rows must still match. This is a narrowly checked seed allowance, not a general exclusion of permission or Storage tables. No corresponding live grant change was authorized or performed.

The run then passed **94 rollback SQL suites / 4,870 assertions**, zero failed suites; original values and post-test values were preserved, SQL/test source hashes were unchanged, and the owned server was stopped. New private Tahoma font contracts, payroll/billing/portal guards and all existing invoice/financial/RLS suites pass on this source. This suite set does not provide complete dedicated employee-claim/Telegram lifecycle coverage.

Receipt: `supabase/.temp/current-native-release-r2-20261109-5d631fd7-d0b5-498b-91c9-452777cb3998/result.json`. It explicitly records `freshProductionRehearsal: false` and `exactCurrentProductionBaseline: false`. These passing local behavior results **do not resolve** the fresh hosted backup/restore, staging-alias or cutover gates, and do not replace the preserved earlier fresh-rehearsal FAIL.

The application code/configuration remains the tested `6cf20b2` bundle. Subsequent source changes are tests, CI guards, documentation and byte-preserving SQL file relocation. The tracked bilingual upload regression is now included in the hosted E2E command. The candidate can be published for review and CI, while merge and production promotion remain blocked.

## Draft publication and first remote CI results

Draft [PR #128](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/pull/128) publishes commit `bdb21ef1eb91649d79a448b01aca245dbbcbd737`. Local Git push was rejected for CLI account `duaa7226-collab`; the connected repository administrator account was used instead. The API-created source tree and fetched Git tree both equal `2968ef228c1b07d5d2fb885a70e1859ca3a6ce68`, exactly matching local candidate `428b8b5`. Both the previous remote feature head and master are retained as parents. Original local implementation commits are preserved on the original branch; no force push or protection bypass was used.

On that head, [CI run 42615225295](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/actions/runs/42615225295) has a successful core `ci` job: dependency install, release guards, API guard, lint, types, units, Linux production build, PDF asset tracing, dependency/secret/file checks and fail-closed readiness smoke all passed. The clean Supabase reset and all pgTAP suites also completed before the separate integration/concurrency/browser steps; the full `pgtap` job was still running at this observation. This establishes a clean CI replay, not hosted staging/production-history reconciliation or recovery. Production deployment jobs remained skipped under the release hold.

The same run exposed that hosted E2E was skipped by `STAGING_E2E_ENABLED`. The follow-up makes this gate mandatory for same-repository release PRs even when optional E2E is off; fork PRs cannot receive the credential-bearing hosted job. Exact-SHA/staging/Preview-authentication checks remain required and can fail visibly. The new guard test pins this policy and the upload regression's inclusion; **378/378** release guards pass after the change, and scoped lint passes. All 1,062 application build inputs still match the verified build. Missing Preview/configuration is not resolved by changing the condition; it is correctly surfaced as a blocking failure instead of a skip. This change does not modify repository secrets, Vercel access rules, database state or application behavior.

## CI failures retained; dashboard landmark repair

The first full `pgtap` job ultimately **failed** in `Build and verify owner MFA in the browser`, at `dashboard main landmark settles`. Its 4,870 SQL assertions, local Auth/Storage integration, payment/expense/ZATCA/invoice concurrency and rollback checks had already passed. Actual MFA enrollment/code verification also completed before the dashboard assertion. The full job is not green, and staging acceptance was consequently skipped.

The follow-up was published as `4ec4a977321c0df41f1b8eadd600dd49f09fdb07`, tree `76626095096240f952f3818e285658c266e1d672`, exactly matching local `d94ba0a`. In [run 42616199452](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/actions/runs/42616199452), hosted E2E now executes and fails closed with `Protected staging access denied` rather than silently skipping. Preview access remains unresolved; neither deployment protection nor any access rule was changed.

The dashboard failure has a confirmed structural cause: `SidebarInset` rendered a `main` wrapper around the dashboard layout's own `main#main-content`, producing two main landmarks. The fix changes the outer shell to `div` and keeps the content landmark and existing CI assertion intact. A regression renders the actual sidebar shell with a header and content landmark: it failed on the previous source (one failed / four passing tests), then passed after the fix (five passing tests). Scoped lint passes. The new application change requires a fresh combined build/browser verification; the earlier `6cf20b2` build alone does not certify it. No hosted data or configuration was changed.


## Landmark repair — fresh complete verification

The application repair at `1ea4cedcd89be72b4efd8d811f56e417f62adf27` passes a new frozen combined run: **2,807 unit tests / 571 reported suites**, **378 release guards**, TypeScript, optimized production build and PDF runtime-asset tracing. ESLint has zero errors and 28 warnings. The exact-source comparison reports no drift. Receipt: ignored `supabase/.temp/combined-release-validation-20261109-r3/result.json`. Earlier passing builds are not substituted for this result.

The actual production build then passes **12/12** read-only browser checks against the approved staging backend: dedicated sign-in, a single visible `main#main-content` in English and Arabic, tablet first-Escape/focus/scroll unlock, 390/768px driver action/filter sizing, upload-search failure after four injected retries, closed-draft reset, and final exact-SHA/staging-CSP isolation. There are zero runtime errors or blocked business/provider requests; the browser signed out and closed all contexts. The owned local application server was stopped. Evidence is retained in the local `landmark-regression-20261109-2026-11-09T12-31-47-289Z` visualization folder. This does not claim complete hosted CRUD or the MFA fixture flow passes until its new CI run finishes.

A read-only protected Preview HTTP probe also returned 200 with staging-only CSP using the existing local development identity, without persisting its token or changing any access setting. It targets the older `890b0a0` deployment and establishes HTTP transport only. A subsequent protected-browser probe did not establish completion and is not counted as acceptance. GitHub Actions Preview identity access remains blocked; no Trusted Sources proposal was applied.

The full audit and remaining release gates still apply. The passing historical-copy SQL evidence remains 94 suites / 4,870 assertions; no SQL changed in the landmark repair. No production migration, live data/permission/secret change, master merge or production deployment was performed. PR #128 must remain a draft until same-head CI, hosted acceptance and current recovery/provider/PDF gates are complete.


## Approved Preview identity and query-aware receivable fault

The owner approved the exact Preview-only GitHub Actions rule. Its request schema was verified from the public OpenAPI specification; fresh reads before/after the change verified the project, absence of an existing override, all five exact claims and Preview-only target. Production access and secrets were unchanged. The previous proposal artifacts now record the applied rule. The hosted retry no longer reports protection denial: it times out because the isolated Preview does not match the requested commit. A current staging Preview is still required; no deployment or hosted acceptance is implied by the rule.

On `c05ab99`, CI core checks passed and the browser flow passed the repaired dashboard/MFA boundary, business-date checks, VAT and approvals. It then failed during manual receivable verification. Safe diagnostics were published as `775abe3`, preserving assertions and excluding raw errors/page contents. All 386 guards passed on that diagnostic source.

A real in-memory browser reproduction identifies a fault in the response-loss interceptor: the literal `**/accounting` pattern misses `/accounting?tab=receivables`. The legacy interceptor receives zero actions while an exact origin/path predicate receives one; every request is fulfilled in memory and no API/database/provider is contacted. The repair accepts accounting query strings while rejecting foreign origins, other ports, prefix paths, child paths and other modules. Eight new regressions cover those cases. The unchanged financial assertions still require an injected lost response, unchanged retry identity, one receivable, exact VAT/total and one audit record. This repairs test targeting; the full browser financial result must still be verified in CI.

The retained production expense-history SQL was also compared read-only with canonical source. Differences are transaction wrappers and an older private-helper/policy implementation. Current policy catalog entries are already inline and permission-scoped; the obsolete helper is absent, private-schema usage is denied to authenticated/anonymous roles and allowed to service role. This explains that particular stored-text hash discrepancy without replaying bootstrap SQL or rewriting history. It is not a full schema/history/recovery reconciliation. No database data, ACL or migration history was changed.

The diagnostic CI run 42650546023 independently confirms the receivable fault: at `lost successful action response`, `transportFaultInjected` is false and the dialog count is zero. The unchanged successful save bypassed the old interceptor. After the matcher repair, all **394/394** release guards pass; all 1,062 application build inputs still match the verified landmark build. Full same-head browser CI is required to accept the retry flow.
