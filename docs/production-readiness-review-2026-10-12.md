# Production launch readiness review — Elite Dashboard

**Verdict: NOT READY for production launch.**
**Review date:** 12 October 2026, Asia/Riyadh
**Reviewed release:** `3362ab17b8da7240cd44ef15a6c8cd47c59bae21` on GitHub `master`
**Decision basis:** two critical database authorization defects, additional security and financial integrity defects, unfinished integrations, and a release path that deployed while required checks failed.

A successful Vercel deployment and passing unit tests show that the application builds and serves pages. They do not establish that tenant data is isolated, financial workflows are correct, or external integrations are reliable. The confirmed database defects are enough to reject a launch with real customer data.

This is a review report. No application fixes, database migrations, production writes, deployments, or credential changes were made.

## 1. Scope and source of truth

| Item | Reviewed scope |
|---|---|
| GitHub | [Repository](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash); clean snapshot of the default branch at the SHA above |
| Supabase | [Project wwfnsbilmyxeawgzicmv](https://supabase.com/dashboard/project/wwfnsbilmyxeawgzicmv), read-only inspection |
| Vercel | [Deployment BQivroCHVCr6To9zARPX5fQCjboC](https://vercel.com/elitesaasc-5643/elite-dashboard/BQivroCHVCr6To9zARPX5fQCjboC), deployment details and public HTTP checks |
| Source inventory | 886 tracked files, including 543 under src, 83 SQL migrations, 14 database test files, and 12 Playwright spec files |
| Application | Next.js App Router, React, authentication, tenant/RBAC controls, driver intake and files, operational modules, payroll, accounting, integrations, monitoring, and deployment configuration |
| Local audit checkout | C:/Users/Zbook/.codex/audits/elite-production-2026-10-12 |

The existing working directory contains substantial uncommitted changes and newer local security work. Those files were preserved and excluded from the verdict. The clean GitHub snapshot, not local unpublished improvements or historical “ready” documents, defines the release reviewed here.

The review combined a repository-wide inventory and static searches with detailed inspection of important trust boundaries and business workflows. It is not a claim that every line was formally verified or that every possible vulnerability was found.

## 2. Deployment and database observations

- Vercel showed the supplied deployment as **Ready**, **Production**, built from **3362ab1**, matching the audited GitHub SHA. Build duration shown there was 47 seconds.
- The observed production domain was **elite-dashboard-blush.vercel.app**. The checks below were performed against that domain; all aliases and the separate B2B project were not exhaustively tested.
- Supabase reported **ACTIVE_HEALTHY**, PostgreSQL **17.6.1.155**, region **ap-northeast-1 (Tokyo)**.
- Read-only catalog queries found **89 public base tables** and **24 tenant rows**. All public base tables inspected had RLS enabled.
- The remote migration history contained the same **83 version identifiers** as the reviewed repository. This does not prove identical function definitions or grants: F01 demonstrates a live permission discrepancy.
- The financial reporting views inspected use `security_invoker=true`, a good control.
- The live webhook tables expected by the application are absent.
- No Supabase Edge Functions were listed. That is not itself a defect; the application uses Next.js for its backend.

### Public runtime checks

| Request | Observed result |
|---|---|
| GET / | 308 redirect to /landing |
| GET /auth/sign-in | 200 |
| GET /dashboard, anonymous | 307 redirect to sign-in |
| GET /api/platform/admin/me, anonymous | 401 |
| GET /api/webhooks/cron, unauthorized | 401 |
| GET /api/health | 200, reported healthy |

The single health response reported database latency of **1,182 ms** and auth latency of **0 ms**. This is one observation, not a latency benchmark or availability guarantee. The auth check has a measurement defect described in F17.

### Actual GitHub checks for the deployed commit

| Check | Result | Evidence |
|---|---|---|
| CI — EliteDev | **Failed at Dependency audit** | [Run 37132615247](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/actions/runs/37132615247) |
| CI lint, type check, unit tests, build | Passed within that run | Same run, job ci |
| CI secret scan and health smoke | Skipped after the audit failed | Same run |
| CI pgTAP | Skipped | Same run |
| CI E2E | Skipped | Same run; also only configured for PR smoke coverage |
| Supabase DB Push — migrations | **Failed at Verify secrets are configured** | [Run 37132615280](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/actions/runs/37132615280) |
| Vercel — elite-dashboard | Success / Ready | Supplied deployment |
| Vercel — elite-dashboard-b2b | Failure commit status | [B2B deployment](https://vercel.com/elitesaasc-5643/elite-dashboard-b2b/ChQituVsNA8WNJrrKryzvWvdATBX) |

The database job log explicitly reported missing `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, and `SUPABASE_PROJECT_ID`. These are setting names only. No credential values were collected into this report.

## 3. Validation performed

| Verification | Result | Practical limit |
|---|---|---|
| Frozen dependency installation | Passed | Audit checkout; lifecycle scripts disabled during installation |
| Production build | Passed | Dummy local Supabase settings; does not validate production credentials or integration behavior |
| TypeScript, tsc --noEmit | Passed | Static type correctness |
| Lint | Passed: 0 errors, 67 warnings | Warnings remain; no automated edits made |
| Vitest | **44 files, 541 tests passed** | Primarily unit and mocked-boundary evidence |
| Deploy configuration verifier | Passed | Checks source configuration, including a disabled deployment job |
| API guard verifier | Passed, 20 routes | Static guard detection; does not test authorization semantics, RPCs, or Server Actions |
| Full dependency audit | **Failed: 1 critical, 10 high, 13 moderate, 2 low advisories** | Package advisories, not 26 demonstrated exploit paths |
| Production dependency audit | **1 critical, 7 high, 7 moderate, 2 low advisories** | See F13 for applicability |
| Live database policies, ACLs, functions, triggers, storage metadata | Inspected read-only | No live mutation exploit attempted |
| Live cross-tenant audit RPC check | **Failed isolation test** | Count-only, read-only transaction under authenticated role |
| Fresh migrations and pgTAP | **Not completed** | Local Docker port conflict, then isolated startup connection failure |
| Authenticated Playwright business flows | **Not run** | No dedicated audit fixture accounts/environment established |
| Load, failover, restore, external provider certification | **Not performed** | Remain release requirements |

Local validation used Node **24.12.0** and pnpm **10.27.0**. Local Supabase configuration specifies PostgreSQL 15 while production is 17; a successful local test would still need a production-version-compatible staging check.

The failed local database startup is an environment limitation, not proof that the migrations are broken. Existing user Docker stacks were left untouched. The temporary audit configuration was restored.

## 4. Findings index

**P0:** critical launch blocker. **P1:** must fix, or explicitly remove the affected feature from launch. **P2:** hardening, operational correction, or a verification gap with lower direct impact.

| ID | Priority | Finding | Evidence level |
|---|---|---|---|
| F01 | P0 | Anonymous, unscoped driver-status mutation RPC | Live grants, body, and triggers |
| F02 | P0 | Cross-tenant audit/approval reads through privileged RPCs | Live behavioral proof for audit; approval body confirmed |
| F03 | P1 | Database writes bypass RBAC, inactive-user and MFA controls | Live RLS/grants plus application controls |
| F04 | P1 | Anonymous application inserts bypass server intake controls | Live grant and policy |
| F05 | P1 | Intake files are unbound; tenant selection and partial saves are unsafe | Source plus storage policies |
| F06 | P1 | Payroll recalculation can overwrite approved/paid/locked results | Source plus live triggers |
| F07 | P1 | Payroll cancellation skips or partially applies deduction rollback | Source and active UI wiring |
| F08 | P1 | Payroll input failures and rule dates can produce incorrect results | Source |
| F09 | P1 | Webhook infrastructure is missing and processing is incomplete | Live schema plus source |
| F10 | P1 | Company registration can leave incomplete workspaces | Source plus live tenant triggers |
| F11 | P1 | Invite-only signup gate trusts client-controlled metadata | Live trigger; exposure conditional on signup settings |
| F12 | P1 | Consent helper and editable consent ledger weaken privacy controls | Live function/policy plus test |
| F13 | P1 | Unpatched dependencies fail the security gate | Fresh audit and CI evidence |
| F14 | P1 | Production deploys bypass failed CI and database release checks | Workflows plus observed deployment |
| F15 | P1 | ZATCA and bank export readiness are not demonstrated | Repository boundary document and source; scope-dependent |
| F16 | P2 | Exposed legacy login endpoint is incomplete and lacks app throttling | Source; UI uses another login path |
| F17 | P2 | Health checks can report success through dependency failure | Source and live response |
| F18 | P2 | Secret-returning helper is incorrectly structured as an action export | Source; absent from compiled action manifest |
| F19 | P2 | Recovery documentation is inaccurate; restore evidence is missing | Source and official backup documentation |
| F20 | P2 | Regional latency and database performance need measurement | Config, live region, advisor |
| F21 | P2 | Privacy implementation and published promises need reconciliation | Source and unverified operations |

## 5. Detailed findings

### F01 — P0: an anonymous caller can execute an unscoped driver-status function

**Evidence:** [supabase/migrations/20260923120000_reconcile_drivers_module_drift.sql:78](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/supabase/migrations/20260923120000_reconcile_drivers_module_drift.sql#L78); live `set_driver_status(uuid, driver_status, text, uuid)` is SECURITY DEFINER, and `has_function_privilege('anon', ..., 'execute')` returned **true**.

The function looks up a driver by ID, locks it, then updates its status and the caller-supplied actor field. It does not validate `auth.uid()`, tenant ownership, role, permission, or an allowed transition. The only live non-internal driver trigger inspected updates the timestamp; it does not add an authorization boundary.

**Impact:** possession of a driver UUID permits an unauthorized status change across tenants through the database RPC surface. This conclusion is based on the grant and executable body; no driver status was changed during review.

The migration revokes PUBLIC execution but does not revoke a separate direct `anon` grant. Even after removing anonymous access, authenticated execution remains unsafe unless the function checks authorization.

**Required correction:** explicitly revoke unwanted direct grants; keep this function service-only behind a guarded action, or make it derive tenant and actor from the authenticated context and enforce the correct permission internally. Reconcile the live ACL with migration-managed expectations.

**Release test:** anonymous execution denied; unauthorized same-tenant role denied; foreign-tenant driver denied; permitted action succeeds and records the real actor. [Supabase function privilege guidance](https://supabase.com/docs/guides/database/functions) and [anonymous SECURITY DEFINER advisory](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

### F02 — P0: privileged read helpers accept an arbitrary tenant

**Evidence:** [supabase/migrations/20260924140000_audit_trail_surface.sql:66](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/supabase/migrations/20260924140000_audit_trail_surface.sql#L66) and [supabase/migrations/20260926120000_approvals_module.sql:96](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/supabase/migrations/20260926120000_approvals_module.sql#L96).

`fetch_audit_trail_page` and `fetch_pending_approvals` run as SECURITY DEFINER and are executable by authenticated users. Their SQL filters on the supplied `p_tenant_id` without binding it to the caller's tenant or checking the caller's read permission. A server wrapper supplying the correct tenant does not protect the directly callable RPC.

**Live, read-only proof:** under the authenticated database role with a synthetic subject that has no profile:

```json
{
  "caller_has_no_tenant": true,
  "foreign_tenant_audit_rows_visible": 50,
  "can_execute_unscoped_status_change": true
}
```

Only counts and permission booleans were returned. No audit contents or personal data were extracted. This was a database-role simulation through the management connection, not a forged JWT accepted over HTTP.

**Impact:** an authenticated account with a target tenant UUID can read that tenant's audit history; the approval helper has the same authorization defect and projects expense, leave, and application information.

**Required correction:** derive tenant from verified caller context, enforce active-user and module permission checks, or revoke authenticated execution and use a service-only function behind the guarded server layer.

**Release test:** no-profile, foreign-tenant, inactive, and insufficient-role callers receive no data. Verify both RPCs using actual staging JWTs. [Authenticated SECURITY DEFINER advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

The atomic application and leave decision helpers inspected are service-only in the live database; they are not being alleged to have this public mutation exposure.

### F03 — P1: tenant-only RLS does not enforce application RBAC or account gates

**Evidence:** [src/lib/auth/authorization.ts:88](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/lib/auth/authorization.ts#L88), [src/proxy.ts:128](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/proxy.ts#L128), [src/lib/platform/admin-guard.ts:7](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/lib/platform/admin-guard.ts#L7), and live policies/grants.

For drivers, expenses, payroll periods, consent records and other inspected business tables, authenticated writes are allowed when `tenant_id = get_my_tenant_id()`. The tenant resolver checks profile existence and soft deletion, but not active status. These write policies do not check module permission, role, or AAL2.

The application has useful `requirePermission` checks, but a caller can use Supabase directly. An existing JWT for an inactive profile can still resolve its tenant unless a separate revocation mechanism invalidates it. MFA is enforced principally at dashboard routing, fails open on assurance-check errors, and does not cover direct database access. The platform-admin API guard checks an allowlist and JWT validity but does not require AAL2.

**Impact:** lower-privilege same-tenant users can bypass intended action restrictions through direct table access; routing controls do not provide a complete security boundary.

**Required correction:** choose and enforce one consistent database write model: service-only guarded mutations, or RLS/RPC checks that include current user status, permissions and necessary MFA assurance. Restrict sensitive columns and cross-table tenant relationships too.

**Release test:** direct REST/RPC attempts must follow the same role matrix as the UI, including inactive accounts and AAL1 sessions. Journal tables with correctly restricted write policies are not included in this blanket write claim.

### F04 — P1: public application insertion bypasses the guarded submission action

**Evidence:** [supabase/migrations/029_driver_applications.sql:189](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/supabase/migrations/029_driver_applications.sql#L189) and live `anon` INSERT grant.

The anonymous INSERT policy only requires `status='submitted'` and true terms/privacy flags. It does not force the submission through the server action's 3/hour rate limit, full schema validation, tenant resolution, or document checks.

**Impact:** direct Supabase requests can bypass intake protections and submit application records for a chosen tenant, subject only to database constraints. This creates abuse, junk-data and tenant-routing risk.

**Required correction:** revoke anonymous table insertion; accept submissions through a guarded server endpoint or narrowly controlled RPC with equivalent validation and abuse protection.

**Release test:** direct anonymous table insertion denied; legitimate server intake succeeds; concurrent rate-limit enforcement holds.

### F05 — P1: application documents are not bound to the submitting draft

**Evidence:** [src/lib/driver-registration/schema.ts:130](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/lib/driver-registration/schema.ts#L130), [src/lib/driver-registration/actions.ts:117](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/lib/driver-registration/actions.ts#L117), [src/lib/applications/actions.ts:103](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/lib/applications/actions.ts#L103), and [supabase/migrations/059_document_verification_tokens.sql:113](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/supabase/migrations/059_document_verification_tokens.sql#L113).

Uploaded file paths are accepted as nonempty strings. The server does not establish that a path belongs to this applicant's draft, exists in storage, has an allowed type, or is authorized for attachment. Review downloads later sign the stored path using privileged storage access.

The default tenant is selected as the oldest active tenant. That may be a deliberate single-company intake rule, but it is unsafe as a generic multi-company registration design; the live project contains 24 tenant rows.

Application and document metadata are inserted separately. A document insert error is logged while the action still returns success. Anonymous storage upload access is constrained by folder shape and the bucket's per-file limits, but not a per-draft authorization capability or a submission-bound upload quota.

**Impact:** invalid or unrelated document references, incomplete accepted applications, incorrect tenant routing, and unlimited aggregate upload abuse. Direct theft of another applicant's document was not demonstrated.

**Required correction:** bind draft, upload capability, tenant, applicant and object together; validate object existence and metadata server-side; make the application/metadata commit atomic; add expiry/cleanup and upload quotas. Configure the intake tenant explicitly by trusted host or server settings.

**Release test:** forged and foreign draft paths rejected; missing object rejected; metadata failure cannot report complete success; uploads expire and cannot grow unbounded.

### F06 — P1: recalculation overwrites terminal payroll states

**Evidence:** [src/lib/payroll/calculate.ts:168](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/lib/payroll/calculate.ts#L168).

The calculation persists through an upsert keyed by tenant, driver and month, always writing `status: "calculated"` and fresh amounts. It does not reject an existing approved, paid, or locked period. The live payroll triggers inspected only update timestamps and require a cancellation reason; they do not prevent this overwrite.

**Impact:** a payroll-create action can reset previously approved or paid results and change amounts after disbursement. Keeping the separate UI transition graph correct does not protect this calculation path.

**Required correction:** lock and validate the existing period inside an atomic database operation; reject terminal states; define an explicit controlled amendment/reversal process.

**Release test:** recalculation of approved, paid and locked periods cannot alter their original result or status; simultaneous calculation/approval is deterministic.

### F07 — P1: cancellation has two inconsistent implementations

**Evidence:** [src/lib/payroll/status-actions.ts:117](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/lib/payroll/status-actions.ts#L117), [src/lib/payroll/deduction-rollback.ts:111](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/lib/payroll/deduction-rollback.ts#L111), and [src/app/(dashboard)/payroll/page.tsx](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/app/(dashboard)/payroll/page.tsx).

The active payroll UI cancels through `transitionPayrollStatus`. That path changes status but does not invoke the deduction rollback routine. The legacy cancellation action does invoke rollback, but does so through several independent database requests before its final status update.

The legacy path logs advance rollback errors and continues. Its final update is not conditioned on the status originally validated. Another request can mark the period paid while cancellation is running, after which cancellation can overwrite it. Locked states are not rejected there as they are in the transition graph.

**Impact:** deductions, advances, period status and audit events can disagree; concurrent payment/cancellation can corrupt a paid period.

**Required correction:** one atomic cancellation implementation with row locking, lifecycle validation, all deduction/advance updates and audit persistence in the same transaction.

**Release test:** cancellation restores every applied deduction exactly once; injected failures roll back all changes; concurrent payment cannot be overwritten; both UI and API use the same routine.

### F08 — P1: payroll inputs can silently produce the wrong amount

**Evidence:** [src/lib/payroll/calculate.ts:44](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/lib/payroll/calculate.ts#L44) and [src/lib/payroll/actions.ts:99](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/lib/payroll/actions.ts#L99).

The calculation chooses the latest active rule without an as-of cutoff for the payroll month. Attendance summary, orders, violation deductions, advances and COD query errors are largely ignored and default to empty or zero data. The run action can return `success: true` even when every driver calculation failed.

The month-boundary helper constructs local-time dates before converting to UTC, which shifts dates under positive-offset timezones. This is a deterministic portability defect; it is not evidence that Vercel's runtime currently uses Riyadh timezone.

**Impact:** historical payroll can use a future rule; data outages can become plausible but wrong payroll; operators can see a successful run with no successful calculations.

**Required correction:** effective-date selection, checked input queries, validated period arguments, explicit complete/partial/failed results, source snapshots, and UTC-safe date boundaries.

**Release test:** future rules do not affect earlier months; every input query failure stops or explicitly marks the driver failed; all-failed run is unsuccessful; identical fixtures calculate identically in UTC and Asia/Riyadh.

### F09 — P1: webhooks are not ready to carry real events

**Evidence:** [src/lib/webhooks/store.ts:305](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/lib/webhooks/store.ts#L305), [src/lib/webhooks/dispatcher.ts](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/lib/webhooks/dispatcher.ts), [src/lib/webhooks/events.ts:63](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/lib/webhooks/events.ts#L63), [src/app/api/webhooks/incoming/route.ts:117](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/app/api/webhooks/incoming/route.ts#L117), and [vercel.json](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/vercel.json).

Confirmed problems:

- `webhook_registrations` and `webhook_deliveries` are absent in the live database and have no migration in the reviewed snapshot.
- Read errors in subscription/retry lookup return empty lists, making missing infrastructure appear as “nothing to process.”
- Delivery updates spread camelCase fields into database writes, while readers expect snake_case columns.
- Retry registration rows are cast directly to a camelCase type; `isActive` is absent on the snake_case row, so valid registrations can be treated as inactive.
- Incoming delivery, payment and ZATCA handlers contain TODOs and return “processed” without the promised business processing. The unknown-source branch says “stored” but does not persist the payload.
- Domain emission is fire-and-forget without a durable outbox or request-lifetime guarantee.
- Vercel schedules retries once daily, despite the code's short backoff intervals. The alternate SQL scheduler was not confirmed installed; pg_cron/pg_net were absent in the inspected project.

**Impact:** lost events, false acknowledgments and missing retries.

**Required correction:** implement migration-managed tables and explicit mappings, persist before acknowledging, make processing idempotent, add durable delivery/worker scheduling, and fail visibly on infrastructure errors. Alternatively remove these integrations from the launch promise and disable their active endpoints.

**Release test:** provider event persists and changes the intended record once; duplicate/replayed events are safe; failure schedules a timely retry; process termination does not lose the event.

### F10 — P1: new company provisioning is incomplete and not recoverable

**Evidence:** [src/app/api/platform/register/route.ts:134](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/app/api/platform/register/route.ts#L134).

Auth account, tenant, public profile and membership are created through separate requests without a recovery/compensation path. Membership errors are ignored. There is no per-new-tenant initialization of the role matrix and essential defaults in this registration path; live tenant triggers inspected do not supply that initialization.

The general-manager bypass can hide missing role rows until the company invites other roles. All auth creation errors are returned as a successful generic registration response, so infrastructure failures can be indistinguishable from successful onboarding.

**Impact:** orphaned auth users, half-created companies, missing memberships, and unusable roles after signup.

**Required correction:** an idempotent provisioning workflow with observable state and cleanup/retry; transactionally initialize database workspace defaults; distinguish duplicate-account anti-enumeration from operational failures.

**Release test:** fresh tenant can complete confirmation, sign in, invite every launch role, and use the expected modules; failure at each step leaves a recoverable state.

### F11 — P1, conditional exposure: invite-only enforcement trusts user metadata

**Evidence:** [supabase/migrations/060_auth_trigger_harden.sql](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/supabase/migrations/060_auth_trigger_harden.sql) and the live `sync_auth_user_to_custom_users` trigger.

The trigger accepts an auth INSERT when `raw_user_meta_data._invite_provisioned` is true. User metadata is controlled by the signup caller and is not a trusted provisioning signal.

**Impact:** if direct email signup is enabled, a caller can bypass this trigger's invite-only gate by supplying the marker. The marker alone does not grant a company profile or general-manager privileges. Its combination with F02 is more serious because a no-profile authenticated role can already read foreign audit rows.

**Required correction:** use server-controlled app metadata or a database-backed provisioning authorization mechanism, and explicitly verify the production signup configuration.

**Release test:** direct signup with forged metadata cannot produce an authorized account. Production signup enablement was not independently verified, so public exploitation is conditional rather than claimed proven.

### F12 — P1: consent presence and ledger integrity are insufficient

**Evidence:** [supabase/migrations/20260923120000_reconcile_drivers_module_drift.sql:243](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/supabase/migrations/20260923120000_reconcile_drivers_module_drift.sql#L243) and [supabase/tests/013_sensitive_tables_rls_tests.sql:261](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/supabase/tests/013_sensitive_tables_rls_tests.sql#L261).

`has_pdpl_consent` applies `bool_and` to the latest rows that exist for photo and sensitive-document consent. It does not require both types to exist. One accepted photo row can therefore produce true. The database test explicitly expects this photo-only result.

The live consent UPDATE policy allows any authenticated user in the tenant to edit consent records. That weakens the ledger as evidence of the actual subject's decision.

**Impact:** the broad helper cannot safely mean “both required consents obtained,” and historical consent can be changed by a tenant user.

**Required correction:** define granular consent requirements by operation; require every necessary latest consent explicitly; use append-only events with authenticated subject/authorized actor provenance.

**Release test:** missing required type, withdrawal, older accepted consent followed by rejection, and unauthorized ledger edits are all denied. This is an engineering control assessment, not a legal compliance opinion.

### F13 — P1: dependency advisories remain unresolved

The fresh audit found **26 advisories overall** and **17 in the production dependency graph**. The actual GitHub security gate failed too.

| Package | Installed version of concern | Patch floor indicated by the audit |
|---|---|---|
| Next.js | 16.3.3 | 16.3.8 covers the reported patch floors; critical next/og issue alone is fixed in 16.3.6 |
| sharp | 0.35.4 | 0.35.5 |
| source-map-js | 1.2.1 | 1.2.2 |
| fast-uri | 3.1.6 | 3.1.8 covers the reported issues |
| brace-expansion | Affected 2.x / 5.x instances | 2.1.7 / 5.0.12 for the reported issues |
| postcss | 8.5.18 | 8.5.23 |

Some overrides pin versions that now have advisories. Development-only issues also affect packages such as Vitest and AJV.

**Applicability matters:** the critical [next/og advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j) requires an affected ImageResponse path handling attacker-controlled input. No `next/og` or `ImageResponse` use was found in the application source, so this review does **not** claim a demonstrated RCE. The [image optimization SSRF advisory](https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4) also has conditions; exploitability was not demonstrated with this app's restricted remote image hosts. Dev-server, self-hosted Pages Router and cache-feature advisories may not apply to this production architecture.

**Required correction:** update the affected dependencies/overrides and lockfile, rerun build/tests/audit, and document any remaining exception with its actual deployment applicability and owner.

**Release test:** the high/critical gate passes, or each justified exception is formally tracked with evidence. Do not suppress the complete audit without analysis.

### F14 — P1: the release path deploys despite failed required checks

**Evidence:** [.github/workflows/deploy.yml:9](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/.github/workflows/deploy.yml#L9), [.github/workflows/ci.yml:81](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/.github/workflows/ci.yml#L81), [.github/workflows/supabase-deploy.yml:39](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/.github/workflows/supabase-deploy.yml#L39), and the runs in section 2.

Vercel native Git integration deployed the reviewed release while CI failed and the database deployment job failed. The production workflow job is disabled. The preview step named “Verify CI passed” only prints a message; it does not check another workflow's conclusion.

Migration pushing is a separate workflow, with no enforced ordering that makes a production application release wait for the database it requires. Matching current migration version IDs does not make this future release path safe.

E2E CI runs only `e2e/smoke.spec.ts` on PRs and skips the test command when BASE_URL is absent. The other business specs are not required by this gate.

**Required correction:** enforce protected release checks and a concrete promotion gate; apply compatible migrations before dependent application promotion; validate actual target project identity and environment; require business-flow and database tests. Supply the three missing migration settings through the existing secret configuration.

**Release test:** intentionally failed CI or migration validation prevents promotion; exact release SHA has passing database, application and critical-flow checks. Do not merely re-enable the disabled workflow without resolving its configuration.

### F15 — P1 if included at launch: tax transmission and bank exports need external validation

**Evidence:** [docs/financial/ZATCA-BOUNDARY.md](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/docs/financial/ZATCA-BOUNDARY.md), [src/lib/accounting/zatca-csid.ts:251](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/lib/accounting/zatca-csid.ts#L251), and [src/lib/payroll/actions.ts:224](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/lib/payroll/actions.ts#L224).

The repository expressly documents cryptographic and onboarding seams that have not been validated against the live ZATCA API or official SDK. Sandbox mocks are defaults. Onboarding can fall back to a synthetic VAT number and test-style identity values if tenant data is absent.

WPS export substitutes a dummy identity number or blank IBAN when driver data is missing. The generator also permits an unknown-bank fallback. Generating a string is not evidence that the target bank accepts it.

**Required correction:** keep these features explicitly outside the live launch until validated; reject missing production identity/bank data and mock configuration in live mode; obtain target-provider acceptance evidence.

**Release test:** official/provider sandbox acceptance, negative fixtures for missing/invalid identity and account details, signed payload validation, and operational reconciliation. The app can launch a narrower scope without claiming tax-transmission or bank-file readiness, after the other blockers are fixed.

### F16 — P2: legacy platform login is incomplete

**Evidence:** [src/app/api/platform/login/route.ts:11](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/app/api/platform/login/route.ts#L11).

This public POST handler lacks the application's rate-limit wrapper, signs in without setting the app's session cookies, and looks up membership by auth-user ID while registration stores the public-user ID. It returns a user/tenant envelope rather than establishing the app session. The platform login UI redirects to the unified sign-in path, reducing its current user-facing impact.

**Required correction:** remove the unused endpoint or route it through the shared validated, throttled login/session implementation.

**Release test:** one supported login path creates the correct session and tenant context; unused authentication endpoints cannot be abused.

### F17 — P2: health is not a reliable readiness signal

**Evidence:** [src/app/api/health/route.ts:82](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/app/api/health/route.ts#L82) and [.github/workflows/ci.yml:138](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/.github/workflows/ci.yml#L138).

Dependency failures mark the body degraded but still return HTTP 200. The code never assigns unhealthy. CI accepts degraded responses. Auth is checked using `getSession()` on a new client without an existing session; that does not prove an auth-network request succeeded.

**Required correction:** separate liveness and dependency readiness; use bounded real dependency probes; return 503 for critical dependency failure; make release verification reject failed readiness.

**Release test:** simulated database/auth outage produces the intended failed readiness signal; the deployment gate blocks it.

### F18 — P2, latent: a plaintext credential reader is exported from a use-server module

**Evidence:** [src/lib/accounting/zatca-csid.ts:164](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/lib/accounting/zatca-csid.ts#L164).

`getZatcaCsidCredential` accepts a supplied tenant ID, reads certificate/secret/private-key fields with an admin client and returns them without authentication. It is in a file marked `"use server"`.

**Important qualification:** the completed audit build's Server Action manifest included only `listZatcaCsids` and `onboardZatcaCsids` from that file. The credential helper was **absent**. It is therefore **not reported as a confirmed callable action or deployed secret leak**.

**Required correction:** move internal credential access into a normal module protected with `import "server-only"`; keep public action exports limited to guarded operations and masked outputs. [Next.js Server Action security guidance](https://nextjs.org/docs/app/guides/data-security) explains why callable actions need their own authorization.

**Release test:** build manifest and client bundles never expose a credential-returning action; unauthorized secret access is denied in any externally callable path.

### F19 — P2: recovery documentation and evidence need correction

**Evidence:** [docs/DISASTER_RECOVERY.md:25](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/docs/DISASTER_RECOVERY.md#L25).

The recovery document describes seven daily backup days for Free and 30 for Pro, and describes PITR as simply a Pro feature. Those are not reliable descriptions of current plan entitlement. Supabase documents seven days of daily backups for Pro, recommends independent exports for Free, and treats PITR separately. Database backups also do not restore actual Storage objects. [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups).

The project plan, actual backup retention/PITR entitlement, object backup execution, and a recent restore drill were not verified. The tracked “backup” artifact found was a dashboard patch, not evidence of an operating database/object backup job.

**Required correction:** correct the runbook to the actual project configuration; verify off-site database and object recovery; record owners, recovery objectives and a staging restore drill.

**Release test:** restore a representative database and private documents into an isolated environment and measure the agreed recovery time/data loss. This is missing assurance, not a claim that Supabase has no backups.

### F20 — P2: production latency and capacity are not established

**Evidence:** [vercel.json](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/vercel.json), live Supabase region, one health timing, performance advisor.

The repository requests Vercel `iad1` while Supabase is in Tokyo. Actual function placement was not independently confirmed. Repeated database round trips and sequential per-driver payroll processing can amplify regional latency.

The performance advisor identifies uncovered foreign keys and unused indexes. Those are tuning leads, not proof that all indexes should be removed or that a specific throughput limit has been reached.

**Required correction:** align compute/data placement where practical; measure critical queries, pagination and batch actions using realistic staging data; set latency, concurrency and cost targets.

**Release test:** recorded p50/p95 and failure rates at expected peak usage, payroll batch completion within runtime limits, and no unbounded result sets. [Foreign-key index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys); [unused-index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

### F21 — P2: privacy promises are ahead of verified implementation

**Evidence:** [src/lib/driver-registration/actions.ts:180](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/lib/driver-registration/actions.ts#L180) and [src/app/privacy/page.tsx](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/blob/3362ab17b8da7240cd44ef15a6c8cd47c59bae21/src/app/privacy/page.tsx).

The application writes the raw client IP into a column called `ip_hash`. The privacy page promises full tenant isolation and deletion/anonymization within 90 days after termination. Tenant isolation currently fails in F02. An operating retention/deletion workflow supporting the 90-day promise was not found or verified.

Data is processed across the observed Tokyo database region, the configured US compute region, and external mail/monitoring providers. Appropriate policy, contracts and transfer handling need owner review; this report does not determine legal compliance.

**Required correction:** hash/minimize security identifiers where promised, implement and verify retention workflows, inventory processors and locations, and bring public policy claims into agreement with the actual controls.

## 6. Supabase advisor interpretation

Do not treat every advisor warning as an exploit or fix “RLS with no policy” by opening access.

| Advisor | Interpretation and action |
|---|---|
| Anonymous SECURITY DEFINER execution | F01 is a real blocker. Public token lookup helpers may be intentional; trigger-returning helpers are not ordinary RPC entry points. Review functions individually. [Remediation](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) |
| Authenticated SECURITY DEFINER execution | F02 is confirmed. Other helpers need explicit caller binding or service-only grants. [Remediation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) |
| RLS enabled with no policies | Service-only secrets, counters and public-lookup limiter tables intentionally fail closed. Preserve that boundary. [Explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) |
| Extension in public | pgTAP is installed in public. Move test tooling out of the exposed business schema where supported; its helper views are not evidence of a financial-view data leak. [Remediation](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) |
| Leaked-password protection disabled | Enable and validate the supported control for the project's plan. [Guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) |
| Unindexed foreign keys / unused indexes | Measure workload before adding/removing indexes; prioritize hot joins and delete/update paths. Links in F20. |

The last-24-hour aggregate log snapshot showed predominantly successful requests: edge logs had four 400 and two 404 responses, auth logs had four 400 responses, and sampled PostgreSQL logs were LOG-level. This limited sample does not prove absence of outages, breaches, or data corruption. No individual user identities, IPs or log payloads are included here.

## 7. Controls that are already useful

- A real production build, strict TypeScript validation, and a substantial passing unit suite.
- Authentication guards and tenant-scoped predicates in many server actions.
- App-level RBAC backed by role/permission tables.
- Shared, atomic rate limiting with a fail-closed backend design.
- Private application-document storage and expiring signed download URLs.
- Cryptographically random status/document tokens with hashed storage.
- Security headers and centrally defined CSP.
- Webhook HMAC verification, timeout handling and redirect/SSRF checks.
- Atomic approval decision helpers with service-only live grants.
- Financial reporting views that respect invoker security.
- Accounting migrations containing transaction, balance and immutability controls.
- Environment-variable conventions; the only tracked environment file is .env.example.

These are foundations to keep. None negates a conflicting direct database permission or an unfinished production path. No actual production secret was intentionally retrieved, and this review does not certify the complete Git history as secret-free.

## 8. Release gates and remediation order

### Gate A — contain unauthorized access first

1. Correct F01 and F02 with explicit live-grant reconciliation and migration-managed protections.
2. Close direct-write RBAC/status/MFA bypasses in F03.
3. Close anonymous table intake and forged upload capabilities in F04–F05.
4. Verify signup gating and consent integrity in F11–F12.
5. Run negative authorization tests with real staging JWTs for anonymous, no-profile, foreign-tenant, inactive, low-permission and AAL1 callers.

**Owner:** backend/security engineer. **Exit:** all negative cases fail safely through direct API/RPC/table access as well as UI actions.

### Gate B — make financial results and provisioning reliable

1. Correct payroll terminal-state protection, cancellation atomicity and input/error behavior, F06–F08.
2. Make onboarding recoverable and initialize each tenant completely, F10.
3. Validate private document save/review flows end to end.
4. Obtain accounting/finance owner sign-off on payroll examples and WPS output.
5. Exclude tax transmission and unfinished webhooks from launch unless F09/F15 acceptance tests pass.

**Owner:** domain/backend engineer and finance/product owner. **Exit:** representative workflows, concurrency and injected-failure cases pass on a production-version-compatible staging database.

### Gate C — make a release reproducible

1. Patch dependencies and rerun the security gate, F13.
2. Fix required GitHub settings and release ordering; require green CI/database checks before promotion, F14.
3. Run all relevant business E2E specs, not only smoke.
4. Verify Vercel production environment names and target project identity without revealing values.
5. Verify auth redirect URLs, confirmation/reset/invite mail delivery, custom domains and cross-deployment routing.
6. Test readiness failure and rollback behavior, F17.

**Owner:** platform engineer. **Exit:** the exact release SHA has passing checks and a recorded staging-to-production promotion procedure.

### Gate D — establish operational assurance

1. Verify monitoring/error capture and actionable alerts with a controlled test event.
2. Correct and execute recovery procedures, F19.
3. Benchmark latency/capacity and scheduled-job reliability, F20.
4. Reconcile privacy/retention promises, F21.
5. Remove or harden legacy/latent endpoints, F16/F18.

**Owner:** platform/operations and privacy/product owners. **Exit:** documented restore evidence, alert delivery, capacity targets, retention procedure and accountable ownership.

A narrower pilot with synthetic data can be useful after the critical access defects are corrected. A customer-data production launch should wait until Gates A–C pass and essential recovery/monitoring evidence is recorded. No reliable launch date or effort estimate can be given until the fixes and tests are scoped.

## 9. Remaining limits of this review

- Vercel deployment details were accessible, but later browser debugging failures prevented a complete environment/settings/runtime-log inspection.
- Build success used dummy settings; production service-key identity, email providers, Sentry configuration and environment separation remain unverified.
- Public HTTP probes did not perform signups, payments, payroll mutations, uploads or provider calls.
- Fresh migrations/pgTAP could not run locally; neither live-data mutation tests nor production load tests were attempted.
- Database cross-tenant proof used a controlled authenticated-role context, not a real attacker account.
- Backup entitlement, restore history, object backup jobs, billing/subscription enforcement and incident alert operation were not certified.
- Accessibility, exhaustive Arabic/English visual QA, mobile behavior, all aliases, and complete browser business-flow coverage remain open.
- Existing local changes were not evaluated as part of this GitHub release. They must be reviewed and merged before being counted as fixes.
- The report is a point-in-time engineering assessment. A later commit or configuration change requires targeted revalidation.

## 10. Evidence artifacts

The separate audit checkout retains these local results for review:

- [Unit test result](C:/Users/Zbook/.codex/audits/elite-production-2026-10-12/unit-test-result.log)
- [Production build result](C:/Users/Zbook/.codex/audits/elite-production-2026-10-12/build-result.log)
- [Lint result](C:/Users/Zbook/.codex/audits/elite-production-2026-10-12/lint-result.log)
- [Full dependency audit](C:/Users/Zbook/.codex/audits/elite-production-2026-10-12/audit-result.json)
- [Production dependency audit](C:/Users/Zbook/.codex/audits/elite-production-2026-10-12/audit-production-result.json)
- [Sanitized evidence summary](<C:/Users/Zbook/Downloads/shadcn-dashboard-landing-template-main (1)/shadcn-dashboard-landing-template-main/nextjs-version/docs/production-readiness-evidence-2026-10-12.json>)

Type checking and static guard scripts also passed as recorded in section 3. Links to source findings are pinned to the reviewed GitHub commit so that unpublished local changes cannot silently alter the evidence.
