# Production readiness, security and correctness audit

**Date:** 3 November 2026, Asia/Riyadh. **Decision: NO-GO for an unrestricted production launch or promotion of the pending candidate.**

**9 November follow-up:** this audit preserves its original source observations and failures. See [the remediation report](READINESS-REMEDIATION-PROGRESS-20261109.md) for reconciled source, implemented fixes, 2,806 passing unit tests, current browser/build evidence and remaining release gates. The follow-up does not approve promotion.

The app is already deployed and its basic health checks respond successfully. That is different from having a fully verified, reconciled release. There are confirmed release-engineering failures, financial completeness defects in the latest deployed source, a privileged read missing an explicit permission check, and important recovery/provider acceptance gaps. No production exploit, customer data breach or duplicate reimbursement was demonstrated in this audit.

This is a report with concrete remediation and acceptance requirements, not a statement that the listed fixes have been implemented. No application code, production data, permissions, secrets, hosted migrations or deployments were changed during this audit. Read-only cloud queries, repository fetches, dependency checks and local documentation/evidence creation were performed. Earlier implementation and verification results are identified separately.

## 1. Exact scope and evidence

| Surface | Observed source/state |
| --- | --- |
| GitHub repository | `Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash` |
| Current fetched `master` | `235f782e39357741c08ac65159ed3c160d95925c` |
| Local candidate before this report | `aeb40ac1828982d9007d5a526b5b8731a0c2da13`, branch `codex/production-modules-completion` |
| Last application change verified locally | `1197066dd38d06603d579304b18d8b94c789adcd`; subsequent candidate commit changes documentation |
| Working tree | 12 modified tracked infrastructure files and four untracked preview-auth/proposal files, separate from this report |
| Production Supabase | `wwfnsbilmyxeawgzicmv`, 161 migration history entries |
| Staging Supabase | `viowrovartosrkqukjxy`, also 161 entries, with a different history |
| Production Vercel deployment | `dpl_Fe8dU3hQVydKLTv5vJ6dMgGXGrPU`, READY, source `235f782…` |
| Canonical app | https://elite-dashboard-blush.vercel.app |
| Immutable deployment | https://elite-dashboard-jlb2p1a6b-elitesaasc-5643.vercel.app |

Current `master` was fetched and exported into an ignored local source snapshot without merging it into the candidate. Five newer upstream commits, PRs #121–125, add driver upload, offline ZATCA rehearsal and expense/Telegram/receipt extraction functionality. The previously tested candidate therefore does not represent the current live application.

Inventory: candidate **1,607 tracked files, 77 page entries, six layouts, 25 API routes, 168 migration files and 93 SQL suites**. Current `master`: **1,571 tracked files, 82 page entries, six layouts, 26 API routes, 160 migration files and 81 SQL suites**. These counts include redirects and supporting files; they are not counts of completed business modules.

Review covered repository structure, route/API entry points and guards, shared authentication/authorization, privileged database access, financial and operational workflow contracts, migration history differences, Storage configuration, dependencies, CI/release controls, recent upstream expense/Telegram code, rendering/PDF controls, logging and available verification artifacts. Existing whole-app inventories and the 28-helper acceptance map were used. High-risk paths were read in detail; this is not a claim that every line or every possible input has been exhaustively tested. No authenticated production writes, provider submissions, load tests against production, live webhook replays or destructive database tests were performed.

Local raw evidence is retained in ignored `supabase/.temp/readiness-audit-20261103/`. It contains source/metadata summaries, dependency audit output and a pinned source archive, not database business records or credentials.

## 2. Checks and actual results

| Check | Result and limit |
| --- | --- |
| Production `/api/health` | HTTP 200, `healthy`, exact version `235f782…`; database and Auth probes succeeded. These probes do not exercise accounting RPCs or CRUD. |
| Production `/landing` | HTTP 200. Security headers present. |
| Anonymous production `/invoices` | HTTP 307 to `/auth/sign-in`, private/no-store response. No authenticated invoice workflow was exercised in production. |
| Current-master GitHub CI | [Run 41478963856](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/actions/runs/41478963856): `ci` and `pgtap` succeeded; `e2e` and `staging_acceptance` were **skipped**. |
| Candidate unit tests | Latest same-day preserved run: **2,728/2,728 passed**, 548 reported suites. Not rerun against newer master during this audit. |
| Candidate TypeScript / ESLint | Preserved same-day run: passed; lint zero errors, 28 warnings in the combined working tree. |
| Candidate production build / PDF bundle | Preserved same-day run: passed. Fresh comparison in this audit found **zero drift across all 1,475 files** in that build's source freeze. |
| Candidate release guards | Preserved run: six failures in preview-identity/CSP mocks. Additionally, this audit freshly confirmed CI references a **missing** `scripts/verification-access.test.mjs`; invoking it exits 1. |
| API route guards | Fresh scans: candidate 25/25 and current master 26/26 guarded or explicitly allowlisted. A text-based guard scan is not proof that authorization semantics are correct. |
| Deploy configuration / archived history checks | Fresh candidate checks passed. Eight archived staging migration versions verified without a database connection. |
| Candidate dependency audit | Fresh `pnpm audit --json`: zero advisory instances at every severity. |
| Current-master dependency audit | Fresh audit of its exported lockfile: **three moderate affected dependency instances across two advisories**, zero high/critical; command exits 1. |
| Known private-value scan | Fresh exact scan: two known local private values, 1,607 candidate tracked files, zero matches. This is not a full secret scan of master, history or provider accounts. |
| Browser regressions | Preserved same-day exact-build run: eight checks passed, covering dedicated staging login, English/Arabic sidebar first-Escape/focus/unlock, and 390/768px driver controls. Browser signed out and closed; owned server stopped. |
| Broader visual/browser audit | Prior 35 captures: 104 passing checks, four failures, one Taste FAIL, 67 warnings; targeted fixes resolve driver clipping and the two sidebar cases. Accounting/ZATCA read failure and no-JavaScript root locale mismatch remain open. |
| SQL/concurrency evidence | Earlier candidate isolated proof: 93 rollback suites / 4,863 assertions and payment/portal/fine races passed on their recorded SQL hashes. This does not certify today's combined master/candidate/history. |
| Fresh production restore/rehearsal | Earlier receipt has overall **FAIL**, despite the nine candidate migrations applying successfully to the restored production copy. Staging rehearsal and complete suite/recovery acceptance did not finish successfully. |

Branch protection details could not be read with the available GitHub CLI identity. Their presence or absence is **unknown**; nothing was bypassed. A successful Vercel status or core CI job does not establish that skipped end-to-end gates ran.

## 3. Findings and complete remediation requirements

Priorities: **P1** blocks the affected release/workflow until fixed or explicitly excluded from the launch scope. **P2** requires planned hardening or an explicit, documented operational acceptance. No independently demonstrated P0 compromise is claimed.

### R01 — P1: incompatible source and migration histories; duplicate version on merge

**Confirmed.** The candidate contains `20261109090000_guard_payroll_engine_mutations.sql`. Current master contains `20261109090000_expense_claims.sql`: the same migration version identifies different SQL. Production additionally records the expense changes under `20261102094021_expense_claims` and `20261102094151_expense_claims_policy_inline`; neither hosted project currently records version `20261109090000`. Equal history counts do not imply equivalent schemas. The prior nine/19-pending-file manifest predates these latest production changes and cannot authorize today's cutover.

**Impact:** a combined tree can have duplicate versions; a tool may skip needed SQL, reject the push, or attempt already-applied expense DDL. Applying historical aliases as if absent can overwrite newer contracts or grants. Merging only application files leaves live code and database semantics inconsistent.

**Solution:** freeze a combined source tree; compare every hosted record by version, name and normalized SQL hash. Preserve applied records and proven aliases. Allocate a unique fresh version for an unapplied conflicting migration using `supabase migration new`, after checking both environments. Compare the two live expense migrations with canonical expense SQL and retain their actual history; use a new forward reconciliation for differences. Generate a new exact ordered manifest, replay it on both fresh isolated baselines, compare original values and grants, then apply the tested staging plan. Do not use blind `--include-all`, edit applied history, or mark migrations applied merely to silence drift.

**Acceptance:** one unique version per migration file; deterministic clean replay; effective schema/function/ACL parity; expected ledgers; unchanged original business values; full post-upgrade SQL and hosted acceptance on the combined SHA.

### R02 — P1: required ZATCA/accounting read RPC absent in both hosted projects

**Confirmed.** `src/lib/accounting/zatca-management.ts:75–76` calls `read_my_zatca_environment` even when external integration is disabled. Read-only catalog queries show that zero-argument RPC is absent in **both** production and staging. The candidate migration `20261030023958_guard_zatca_environment_switch.sql:42` defines it. The earlier authenticated staging browser showed “Could not load accounting data” and missing ZATCA controls.

**Impact:** deploying this candidate before schema reconciliation reproduces a known read failure. A healthy `/api/health` response cannot detect it. The observed staging failure is consistent with this missing dependency; production was not authenticated to reproduce the UI error. Current master's exact read path differs, so this is not a claim that every existing live accounting screen is broken.

**Solution:** include the compatible read/guard RPC in R01's reviewed forward plan, with caller-bound tenant/MFA/permission checks and exact return shape. Keep the external provider gate closed. Also isolate tab-specific loading so a ZATCA configuration read cannot unnecessarily suppress unrelated accounting content, while still showing a truthful error.

**Acceptance:** RPC present with correct grants and JSON contract; allowed caller succeeds; foreign/inactive/AAL1 caller fails; injected read failure displays Retry; accounting and ZATCA tabs work with the provider intentionally disabled.

### R03 — P1: incomplete preview authentication and end-to-end release gate

**Confirmed.** Local CI/E2E infrastructure is unfinished and uncommitted. Six existing guard tests fail because preview authentication is attempted before mocked CSP validation. The edited workflow also names a test file that does not exist. Current deployed master has green core/pgTAP jobs but skipped E2E and staged acceptance.

**Solution:** finish the shared origin-scoped short-lived OIDC transport, wire every app-network path and response-loss interceptor, and add its missing tests. Inject a mocked transport explicitly into unit tests; do not make production code silently bypass authentication for tests. Verify token expiry/refresh, issuer/audience, exact approved target, redirect handling and foreign-origin isolation. Disable credential-bearing traces; retain safe screenshots and evidence. Enable hosted acceptance as a mandatory PR gate for the actual release scope. Any Trusted Sources rule requires the separately reviewed authorization already described in the proposal; do not disable deployment protection or reuse long-lived bypass values in CI.

**Acceptance:** the workflow's exact command succeeds from a clean checkout; all guard tests pass; same-head CI and all acceptance groups execute rather than skip; an accidental production-bound preview is rejected before fixture creation. Required reviews/protection rules must be verified by an authorized maintainer before merge.

### R04 — P1: fresh recovery and cutover evidence is incomplete and stale

**Confirmed evidence gap.** The approved custom production dump is readable and includes selected business/private schemas, Auth, migration history and Storage metadata. Its discovery logic omitted the bare `private` schema, which has seven fleet routines and no tables/types. The latest rehearsal receipt is FAIL; it also records a failed staging migration. Some production migration/value-preservation steps passed, but the complete run did not. New production expense migrations have landed since that snapshot. Storage file contents were never included in that database archive.

**Solution:** complete a reviewed schema/catalog supplement or capture a fresh full scoped backup, including every application schema and ACL/default-ACL dependency. Validate discovery against the namespace catalog rather than only `*_private`. Back up Storage file contents separately with an object manifest/checksum or document and verify the actual independent recovery service. Protect backup access and retention. Restore into fresh disposable databases, apply today's exact manifests and run all behavior suites on separate synthetic clones. Test the maintenance fence, failure recovery and application rollback compatibility. Document RPO, RTO, backup owner and incident procedure.

**Acceptance:** a complete PASS receipt for today's baseline with archive checksums, schema/object coverage, original-value preservation, recovered files, recorded timing and clean resource/fence cleanup. Never relabel a partial successful substep as a passing overall rehearsal.

### R05 — P1: Telegram intake is not replay-safe and acknowledges transient loss

**Confirmed code defect; impact not exercised on live records.** Current-master `src/app/api/telegram/expenses/route.ts:60` ignores the incoming `update_id`; line 116 calls claim creation without a message/update idempotency key. The SQL function at `20261109090000_expense_claims.sql:639–656` only reuses an album claim within 15 minutes. Non-album retries create another claim, and concurrent first album pages use an unlocked select-then-insert. Production routine metadata confirms no `update_id` or `message_id` handling. Lines 64–65 catch processing failure and still return HTTP 200; missing bot configuration also acknowledges. A failed attachment can leave an already-submitted claim without its intended receipt.

Telegram explicitly provides `update_id` for ignoring repeated deliveries and retries unsuccessful HTTP requests. See the [official Update and webhook contracts](https://core.telegram.org/bots/api#getting-updates).

**Solution:** add a durable inbox keyed by bot identity and `update_id`, storing a body hash, exact owner/link binding, state, lease and result. Reserve each message and album identity atomically with unique constraints; use deterministic attachment keys. Confirm receipt delivery only after durable acceptance. Process asynchronously with bounded retries/dead-letter handling, or return an appropriate retryable non-2xx before durable acceptance. Reject identity/body mismatches. Make claim/attachment finalization an explicit state machine; a failed upload must not look complete. Do not automatically approve, reimburse or interpret OCR/QR as authority acceptance.

**Acceptance:** duplicate and concurrent identical updates yield one claim, one attachment registration and one audit result; album races yield one claim; crash after upload/after commit recovers; configuration/DB/provider outage never silently loses the receipt. Run against synthetic staging and a Telegram stub before an authorized provider test.

### R06 — P1: privileged tenant directory read lacks explicit authorization

**Confirmed boundary omission, not a demonstrated cross-tenant leak.** Current-master `src/lib/expense-claims/actions.ts:61–68`, an exported server action, checks only `getCurrentUser()` then uses the service-role client to read up to 5,000 same-tenant user names and email fallbacks. It does not call `can()`/`requirePermission()`. `getCurrentUser()` is a profile primitive, not the permission/MFA primitive; authorization.ts makes that distinction explicit. Service role bypasses users-table RLS.

**Solution:** remove the general directory action or replace it with a caller-scoped RPC that returns names only for submitters/reviewers on claims the caller can actually see. A broad directory view needs an explicit directory permission, current active tenant/user and required assurance. Do not expose email as a fallback unless independently authorized. Share display-name resolution inside the guarded claim operation rather than accepting arbitrary identity lists from clients.

**Acceptance:** no-session, AAL1 privileged, inactive/locked/deleted, insufficient-permission and foreign-tenant callers receive no directory; an own-claims employee sees only necessary identities; approved reviewers see the documented set. No production account was used to attempt this bypass during the audit.

### R07 — P1: expense claim totals and Excel exports silently truncate

**Confirmed.** Current-master `src/lib/expense-claims/actions.ts:180–189` stops reading at 20,000 rows and returns success without a continuation/completeness check. Ordering is by date and creation time without a unique ID tie-breaker. `exportExpenseClaims` filters that result and builds its export; rows beyond the cap are invisible to the operation. A lower backend response cap can also make `data.length < 1000` stop early. Existing tests/builds do not establish behavior at those boundaries.

**Solution:** move filtering and exact totals into a tenant/permission-bound database read contract. Use deterministic keyset paging with an ID tie-breaker, a stable snapshot or explicit concurrency fence, and expected row counts. For an intentional export budget, fail visibly or offer an asynchronous complete export rather than silently returning the first portion. Keep exported IDs/audit/marking bound to the exact resulting dataset.

**Acceptance:** 20,001+ synthetic records, tied dates, rows matching only beyond the old limit, custom API caps and concurrent inserts/edits either produce a complete consistent result or an explicit incomplete/retry response. Workbook totals must reconcile with database totals.

### R08 — P1: expense evidence/settings failures become apparently valid empty/default data

**Confirmed.** `actions.ts:192–199` ignores attachment query errors and treats missing `data` as no attachments. Those queries also do not page/count each batch; 200 claims can collectively have more attachments than one API page. `getClaimSettings:47–58` ignores the settings read error, attempts a service-role defaults upsert on a read, and can then return defaults after another failed read. The default settings need not represent the tenant's actual approval policy.

**Solution:** use checked, complete evidence reads with counts/paging and explicit loading/error states. Preserve previous successful evidence during retry without labelling it current. Separate intentional tenant settings initialization from normal reads; use an authorized transactional initializer. A policy read error must fail closed for affected review/export operations, not substitute defaults. Surface actual business decisions only after the real policy/evidence is known.

**Acceptance:** initial and later-batch DB failures show Retry, no export/approval is completed from an unknown evidence/policy state, batches exceeding backend limits are complete, and a GET/read path creates no settings rows. Tests must distinguish genuinely empty settings/evidence from inaccessible data.

### R09 — P1 for unrestricted receipt intake: parser timeouts do not bound actual work

**Confirmed control limitation; no malicious file was processed.** Current-master `src/lib/expense-claims/extract.ts:55–56` calculates a three-page limit but invokes whole-document `extractText()` before slicing the text. At lines 112–114 a `Promise.race` returns on timeout but does not cancel the underlying parsing. Synchronous CPU work can also prevent the timer from firing promptly. Ten-megabyte input limits do not bound PDF/image decompression cost.

**Solution:** parse only selected pages, enforce page/object/pixel/text/decompression budgets before large allocation, and run untrusted parsing in a killable worker/process or suitably isolated job with actual CPU/memory/deadline limits. Terminate it on timeout and retire its lease. Validate XML entity/DTD behavior and make suggestions optional; preserve the original receipt even when extraction is unavailable. Add intake body/rate/storage quotas across all entry points, not only Telegram.

**Acceptance:** synthetic oversized-page, many-page, decompression-heavy, malformed, encrypted and timed-out files cannot monopolize the request process, continue work indefinitely or crash concurrent ordinary requests. Measure peak memory and termination; no production stress test is authorized by this report.

### R10 — P1 if advertised at launch: official ZATCA, bank WPS and external providers remain unaccepted

**Confirmed product boundary.** Candidate `src/lib/accounting/zatca-config.ts` explicitly blocks production transport pending independent authority acceptance. `src/lib/release/integrations.ts` returns false for WPS and general webhooks. Offline SDK, dry-run, TLV QR and XML/signature tests are useful engineering evidence, not authority acceptance. The current invoice QR is application-generated or retained from its recorded source; an image of a QR does not prove ZATCA issuance/clearance/reporting.

**Solution:** retain the gates and truthful disclosures. For a launch that includes these capabilities, complete authorized taxpayer/EGS configuration, genuine simulation onboarding, required invoice/note cases, signed/cleared artifact retention, QR provenance, retry/reconciliation and independently reviewed authority evidence; then approve production onboarding separately. Verify actual bank-specific WPS files and provider callback/webhook delivery. For a core-only launch, explicitly remove unsupported capabilities from customer commitments and accept that scope; do not silently substitute a mock.

**Acceptance:** independently reviewable provider acceptance tied to the actual app signer, tenant/EGS and configured environment, plus controlled provider failure/retry cases. Legal/tax compliance certification is not provided by this source audit.

### R11 — P2: current master retains three moderate dependency exposures

**Confirmed fresh lockfile audit.** Two `minimatch` instances (3.1.4 and 10.2.6) and `glob` 13.0.6 are affected. They occur in ESLint/parser and Sentry build tooling paths; this audit did not demonstrate a remotely exploitable application request path. There are no reported high/critical instances in the audited lockfile.

**Solution:** reconcile the already tested candidate overrides and narrow CommonJS compatibility patches into the combined source, regenerate the frozen lockfile and test the result. Do not blindly force a major version into an incompatible consumer. Patched ranges are documented in [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) and [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4).

**Acceptance:** complete dependency audit clean or individually reviewed exceptions, frozen install, lint/type/unit/production build and deployment tracing all pass on the combined lockfile. Current CI's high-only audit threshold will not reject these moderate findings.

### R12 — P2, owner-accepted limitation: leaked-password protection disabled

Both hosted security advisors report it disabled. The owner chose to keep the existing plan. Supabase documents the feature as available on Pro and above in [password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

**Solution:** retain strong database-side password policy, privileged MFA, rate limiting, secure recovery and session controls; record the residual credential-stuffing risk. Enable leaked-password checks after a separately approved eligible plan/configuration change. An app-only form validator does not protect direct Auth API signup/password updates.

**Acceptance:** verify the actual hosted Auth policy, direct-API rejection behavior, required MFA and rate-limit failure handling. Do not claim leaked-password protection is enabled or change billing without authorization.

### R13 — P2: Supabase privileged-object exceptions need a maintained security register

Production advisor: one ERROR (`audit_log_safe` definer view), two anonymous-callable definer functions and 68 authenticated-callable definer functions. There are also 19 informational RLS-with-no-policy tables. All **127 public production tables** have RLS enabled, no public definer routine lacks a pinned search path, and staging likewise has no public table without RLS.

The audit view is a security barrier with explicit caller UID, authenticated role, current tenant, audit permission, active tenant and safe metadata projection. Its SQL143 tests cover key denials. Therefore the advisor ERROR is **not itself proof of a tenant leak**. Private receipt/credential tables with no client policies can intentionally deny all client reads. Anonymous status/document-verification functions can be intentional token capabilities. Conversely, RLS enabled and a pinned path do not prove every policy/function is correct. [Supabase explains views' default definer behavior and grant/RLS interaction](https://supabase.com/docs/guides/database/postgres/row-level-security).

**Solution:** classify every exception, revoke unnecessary execute/table privileges, retain narrow caller-bound definer helpers only where necessary, and prefer invoker access where it preserves the privacy contract. Do not flip the audit view to invoker or add permissive policies just to clear a badge. Verify direct tables, views, RPCs and Storage under real database roles, including service-role attempts to impersonate a caller.

**Acceptance:** an allow/deny test and documented reason per exception, active/inactive/foreign/MFA scenarios, exported schemas/grants reviewed, and advisor results rechecked after the final migration plan.

### R14 — P2: CSP still permits inline scripts and broad image origins

The live landing CSP includes `script-src 'self' 'unsafe-inline'` and `img-src https://*.supabase.co`. This is a defense-depth weakness, not a confirmed XSS exploit. The code has legitimate inline locale/bootstrap and JSON-LD scripts, so removing the directive without adaptation breaks behavior.

**Solution:** follow the installed Next.js version's nonce/hash CSP guidance, account for inline bootstrap/streaming and caching, eliminate avoidable inline scripts, and restrict image origins to the actual needed project/brand sources. Keep OCR WebAssembly permissions scoped to the worker. Preserve signed-private-image rendering and test tenant-supplied text, rich notes, URLs and SVG/HTML output encoding.

**Acceptance:** malicious text/URL/markup fixtures remain inert; EN/AR no-JavaScript fallback, hydration, Sentry, OCR, PDF/logo and dark theme function under the revised policy. Deploy report-only measurements before enforcement when needed.

### R15 — P2: privacy redaction does not cover all nested or URL-carried secrets

The logger redacts named paths; Sentry server/client hooks filter selected top-level keys. Nested payloads, error text, breadcrumb URLs and capability/query tokens are not comprehensively covered by those loops. A newly added Telegram client puts its bot token in the request path; its normal error wrapper avoids returning that URL, but transport errors still deserve sanitization at the logging boundary. No real secret leakage was reproduced in this audit.

**Solution:** adopt a shared bounded recursive allowlist/scrubber for events, exceptions, breadcrumbs, URLs and known secret header names, including Telegram and preview protection headers. Drop unnecessary request bodies and financial/identity values. Scrub before transmission, not only before UI display; align retention and access with actual privacy obligations.

**Acceptance:** synthetic nested secrets, signed Storage URLs, request cookies, webhook headers and provider-token paths never reach captured test logs/Sentry envelopes; ordinary errors retain safe correlation IDs and useful diagnostics. Do not send real credentials to a test collector.

### R16 — P2: performance and operating limits need measured acceptance

Fresh production advisor: **49 unindexed foreign-key findings**, **four RLS initplan warnings**, **241 unused-index notices**. These are not all immediate bugs. An index can be correct yet unused on a small/recent dataset; dropping them indiscriminately is unsafe. One readiness observation measured roughly 1.2s database and 1.0s Auth probe latency, not a statistically meaningful performance test. Local verification deliberately disabled Redis, so its fallback warning is not evidence about production Redis configuration.

**Solution:** benchmark intended tenant/driver/invoice volumes and concurrent users on isolated representative data. Inspect aggregate slow queries and `EXPLAIN` plans; add selective FK indexes and statement-level `(select auth.uid())` patterns only where equivalent and useful. Budget connection pooling, serverless PDF concurrency, file storage, exports and job throughput. Verify cache keys/invalidation are tenant/user scoped and multi-instance correctness does not depend on local memory.

**Acceptance:** documented P50/P95/P99 and error-rate targets met for dashboard, searches, payroll, reports and PDF under expected load; pool exhaustion/cache/DB outage tests recover; resource/cost limits and alerts are defined. No production load test was run.

### R17 — P2 / contractual blocker: exact invoice PDF identity remains unverified

The candidate uses Letter dimensions, private licensed Tahoma, eight columns, retained invoice data and a real PDF route. Earlier comparison showed very small anchor differences and a repaired discount/item layout; it did not establish pixel-identical Arabic/bidirectional typography. Linux/Vercel rendering was not compared against both supplied samples on the final merged source. The original historical post-VAT adjustment remains sample-only as directed.

**Solution:** deploy the tested combined source with the two licensed private font files, verify actual Linux runtime tracing/loading, then render controlled synthetic sample data with the same retained logo/QR. Compare page geometry, all text, glyphs, columns, totals, discount semantics, due date, notes, bank block, multipage rows and browser-header removal. Separate legitimate variable values and required QR disclosures from layout differences; do not delete safety/tax disclosures to claim an exact match.

**Acceptance:** owner-approved visual diff on production-equivalent Linux for both samples and edge cases, actual download/print verification, no external PDF network requests, correct font availability and no private fonts in public assets. Financial values must reconcile independently of appearance.

### R18 — P2: visual/localization and module-scope claims exceed the evidence

Latest candidate fixes for driver toolbar clipping and sidebar Escape passed targeted EN/AR browser checks. The broader audit still records type/alignment warnings, an unhydrated document-root locale mismatch and the accounting/ZATCA read block. Active data states, all modals, screen-reader behavior and the newer master expense pages were not covered by that 35-capture run. `/calendar`, `/chat`, `/mail`, `/tasks`, `/templates`, `/faqs`, `/pricing` and `/dashboard-2` currently redirect; they are not completed standalone CRUD modules. Custom report generation is explicitly rejected.

**Solution:** maintain a truthful feature catalog. Verify every active route and high-value empty/loading/error/permission/large-data state in EN/AR, 390/768/1440px, light/dark, keyboard, reduced motion and assistive technology. Seed a consistent server-side locale at the root; retain readable content without JavaScript. Build a retired module only if it is actually included in the launch contract, with its backend/permission/audit/export lifecycle—not just a decorative page.

**Acceptance:** no clipping, keyboard traps, inaccessible names, false empty results or mixed-language controls in agreed flows; supported routes explicitly listed; unsupported features not advertised as ready. See the [current design report](TASTE-POLISH-20261103.md).

### R19 — P1 operating gate: provider jobs, monitoring and incident response are not fully proven

Code exists for scheduled jobs, notifications, billing and internal audit. This audit did not prove production scheduler authorization/delivery, real callback loss/recovery, exactly-once financial effects, alerts reaching an operator, automated object backup, session revocation operations or intended capacity. Aggregate logs were accessible for the previous UTC day; raw customer logs were deliberately not exported. Log availability is not evidence that alerts or response procedures work.

**Solution:** run synthetic staging fault drills for provider timeout/unknown result, repeated callbacks, lease loss, failed audit writes, retry exhaustion and cron overlap. Bind provider identities/amounts/tenant to the stored attempt and persist stable idempotency keys. Test an actual harmless monitoring alert, dashboard/error correlation, incident ownership, rollback and restore exercises. Set retention and access controls for logs/evidence/backups. Obtain scoped authorization for real provider or production secret/configuration actions.

**Acceptance:** recorded job/alert/retry/reconciliation results and operational runbooks with owners, thresholds and rollback decision criteria. No claim that all email/payment/WPS/ZATCA delivery works based solely on unit tests.

### R20 — P2: CI supply-chain and secret scanning coverage is limited

Workflow actions use version tags rather than immutable SHAs. The custom secret grep scans a narrow set of literal forms under `src/`; it does not cover all providers, history, workflow output, ignored deploy assets or arbitrary encoded credentials. The successful exact-value scan in this audit only checks two known local values in candidate tracked files. The `createAdminClient` module relies on a comment rather than its own `import 'server-only'` marker, although many consumers already enforce a server boundary.

**Solution:** pin reviewed action SHAs, keep locked/frozen dependencies and automated updates, add a maintained secret scanner and sensitive-artifact/package checks, and use narrow job/environment permissions. Add server-only enforcement at privileged module boundaries with import-graph/bundle tests. Keep backup/private assets/credentials excluded from Git and Vercel except the specifically licensed private fonts.

**Acceptance:** synthetic test-secret fixtures are detected without printing values, client bundles contain no service-role material, packaged deployments contain no environment/backup files, and the workflow starts from a reproducible clean checkout. Revoke a real leaked credential only through the already scoped or newly required approval.

## 4. Module readiness matrix

“Implemented” below describes reviewed code/contracts, not complete hosted acceptance. None of these rows overrides R01–R04 or skipped E2E gates.

| Module | Current assessment | Required completion |
| --- | --- | --- |
| Landing, login/session, language | Implemented; same-day staging login/handoff/locale checks exist | Final combined-source route/role/session matrix, recovery/MFA and no-JS locale correction |
| Dashboard | Implemented scoped summaries and visible error handling | Reconcile all totals with source; large-data/permission and stale-cache acceptance |
| Drivers / operational history | Extensive versioned lifecycle/evidence code; recent toolbar/card fixes verified locally | Hosted create/edit/archive/restore, concurrent evidence, permission and upload quota acceptance |
| Public driver upload portal | Implemented; candidate has reservation/revocation/race guards | Apply tested guard migration; signed URL expiry, retry, quota and revoked-link lifecycle on hosted staging |
| Driver card / document upload / OCR | Implemented; newer upstream quick upload unintegrated | Correct selected account/photo, device failures, file budgets and real print physical-size checks |
| Vehicles, assignment, maintenance, handover | Atomic workflow contracts and tests exist | Complete bare-private backup/schema restore; hosted assignment/offboarding races and evidence retention |
| Attendance, leave, violations, HR | Lifecycle/read/review code and SQL suites exist | Role/tenant/version/overlap and current-day transitions; fine conversion migration and retry acceptance |
| Orders and platform accounts | Guarded CRUD/read contracts exist | Duplicate natural key, complete paging/import, archive/restore and reconciliation |
| Applications / approvals | Reviewed version/decision contracts exist | Concurrent review, audit rollback, attachments and full queue acceptance |
| Payroll / preparation | Substantial calculation/approval/accounting/WPS code | Candidate guard absent in production; verify import, epochs, settlement/cancel and bank/provider boundaries |
| Ledger expenses | Atomic correction/approval/posting contracts exist | Hosted completeness and payment/VAT/audit rollback acceptance |
| Employee expense claims / Telegram | Newly live source adds major unintegrated surface | R05–R09; own/reviewer/admin roles, all states, evidence completeness and provider replay tests |
| Accounting master data | Paged atomic customer/supplier/chart/bank contracts exist | Full staging CRUD/import/export, account protection, conflicts and unchanged posted history |
| Journals / AR / AP / payments / periods | Atomic posting/allocation/reversal contracts exist | Posting/reversal/period reopening, source totals, no double settlement and complete exports |
| Invoices / credit / debit notes | Extensive lifecycle and PDF code; contractual comparison open | Complete staging lifecycle and large/multipage reads; Linux sample match; QR provenance |
| VAT / financial statements | Exact-source/recovery/read contracts and tests exist | Ambiguous legacy sources, adjustments, boundary rounding and report-to-ledger reconciliation |
| ZATCA | Offline preparation/rehearsal useful; production deliberately blocked | R02 and R10; genuine independently validated provider acceptance |
| Billing / bank WPS / external webhooks | Implemented portions and guarded/disabled portions | R10/R19; real provider acceptance and lost/repeated callback recovery |
| Reports / exports | Tenant-scoped generation/download with supported collectors | Hosted job lifecycle, complete datasets, bounded export budget, expired URL and failure retry; custom reports unsupported |
| Users / roles / invitations / MFA | Atomic management and shared assurance code exist | Last-owner, archived-role, lock/revoke, invite recovery and live session-revocation matrix |
| Platform administration / company settings | Separate platform authority and versioned settings code exist | AAL2, foreign-tenant boundaries, owner invariants and delivery/config rollback checks |
| Audit / feedback / notifications | Safe audit projection and job/UI code exist | R13/R15/R19; direct-role denial, safe exports, nested PII redaction and delivery monitoring |
| Retired template routes | Redirects, not independent modules | Agree launch catalog; build complete workflows only if part of that scope |

## 5. What is already working well

- Live app is reachable; readiness probes test real database/Auth connectivity and return no-store responses. Anonymous invoice access redirects to authentication.
- Core proxy verifies the user server-side, refreshes cookies through redirects and applies status/password/MFA routing. Shared `can()` delegates to database authorization rather than trusting UI-hidden buttons or editable user metadata. A historical signup marker issue is overridden by a later app-metadata guard; old SQL text alone was not treated as a current exploit.
- Production public tables have RLS; public definer routines have pinned search paths. Tenant-state and permission checks are present in important SQL contracts. Service-role usage is recognized as a bypass boundary requiring explicit review.
- Candidate financial code uses atomic transitions, exact amount contracts, optimistic concurrency and transactional audit for many critical workflows. Earlier real two-session tests cover important payment, portal and fine races.
- Candidate PDF route checks session, print permission, request origin and rate limits; renderer isolates pages and blocks external requests. These are substantive controls beyond visual formatting.
- Candidate dependency hardening and historical archive checks are useful and should be preserved through reconciliation. There is substantial meaningful test coverage; the problem is incomplete/current-environment evidence, not an absence of all engineering work.

## 6. Ordered remediation and release plan

1. **Freeze and reconcile:** designate one release owner; combine current master and candidate intentionally; resolve R01, preserve exact hosted aliases and all security/financial fixes. Record a new source and migration manifest. Do not force-push or merge stale PR trees.
2. **Close current high-risk defects:** implement R05–R09 for the newly live expense scope; add denial, completeness, replay, race and parser-budget tests. Restore the missing read contract through the reviewed forward plan. Keep unvalidated providers gated.
3. **Finish CI:** complete R03, eliminate missing test files and failed guards, then require the complete exact-head acceptance matrix. Reconcile dependency fixes and rerun the fresh audit.
4. **Prove recovery:** fresh complete backup plus Storage recovery, two isolated baseline rehearsals, row/grant preservation and rollback/fence cleanup. Prior receipts are historical evidence, not blanket authorization for a changed manifest.
5. **Verify staged application:** apply only rehearsed staging forwards, create an exact-SHA protected preview bound solely to `viowrovartosrkqukjxy`, verify health/version/CSP before synthetic fixtures, then run all modules and failure/permission paths. Retire synthetic fixtures with independent cleanup proof.
6. **Validate output and operations:** real Linux invoice comparison, EN/AR/device/accessibility sweep, representative load tests, provider stubs/authorized provider acceptance, alert and incident drills. Record explicitly accepted limitations and excluded capabilities.
7. **Review and merge:** push the tested branch, open/attach its PR, review actual combined diff and exact-head CI. Obtain repository-required approvals and any scoped live-data/permission/secret/provider approvals. No bypass of branch protections.
8. **Cut over deliberately:** recheck production history/state against the manifest, use the approved backup and maintenance plan, apply the tested forwards, deploy the exact merged SHA with production domain assignment held, verify read-only and approved key flows, then promote. Verify the canonical URL/version after promotion and publish real evidence/rollback instructions.

**Release completion means:** one reconciled SHA; correct database history and effective permissions; all required checks and hosted acceptance passed; complete tested recovery; no unresolved P1 issue in the agreed scope; exact deployment/alias verification; supported and excluded integrations documented. Until then, “deployed,” “build passed,” “QR exists,” and “CRUD code exists” must not be used as substitutes for production readiness.

## 7. Evidence locations and limitations

- Ignored fresh audit records: `supabase/.temp/readiness-audit-20261103/evidence-summary.json`, `cloud-metadata-summary.json`, both dependency-audit JSON files, `source-and-private-values.json`, and the missing-preview-test receipt.
- Same-day application checks: `supabase/.temp/taste-ui-validation-20261103/` and `supabase/.temp/taste-ui-build-20261103/`. The first correctly remains FAIL overall because guards fail; the latter is explicitly an application-build-only PASS.
- Browser supplement: visualization `taste-refresh/ui-regression-2026-11-03T03-13-51-062Z/diagnostics.json` and screenshots. Broader original failures/warnings remain in `taste-refresh/after-round3/`.
- Rehearsal: `supabase/.temp/fresh-release-rehearsal-20261102-current.json` is FAIL and must remain so. Earlier isolated SQL/concurrency success does not erase it.
- [Source design inventory](TASTE-DESIGN-INVENTORY-20261103.md), [UI evidence and open design issues](TASTE-POLISH-20261103.md), [module acceptance map](PRODUCTION-MODULES-RELEASE-CHECKLIST.md), [cutover runbook](MODULES-CUTOVER-RUNBOOK.md), [PR67/68 reconciliation](PR67-68-RECONCILIATION.md).

This assessment is bounded to observed source, metadata and recorded tests. Cloud state can change; authenticated production workflows, full penetration testing, compliance certification, hardware/device printing and every third-party/provider path were not independently exercised. Those limits are part of the release decision, not a claim that those paths are known safe or known broken.
