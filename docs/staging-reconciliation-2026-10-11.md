# Staging reconciliation and Preview isolation — 2026-10-11

**Result: PARTIAL / NO-GO for live CRUD, merge or production release.**
Branch `fix/live-crud-readiness`, draft PR
[#68](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/pull/68),
stacked on Accounting PR #67. Production branch is `master`; this work does not
change it. Original dirty checkout remains at `e707f8a`, with its pre-existing
changes preserved. No UI features, production writes, hosted migrations,
migration-history repairs, secrets/settings changes, merge or production
deployment were performed.

## Migration reconciliation — verified locally, hosted upgrade pending

Restored all eight actual staging migration versions with their original names
and retained SQL. A SHA-256 manifest and offline CI check protect provenance.
The [effect-by-effect comparison](../supabase/history/staging/README.md) records
catalog evidence, superseded policies, overlaps and missing effects. No version
was marked applied based on a filename or incomplete schema overlap.

Confirmed defects and fixes:

- **P1, staging credential exposure:** historical
  `zatca_csids_tenant_isolation` permits authenticated ALL access in the caller's
  tenant, and table grants allow reads/writes. This contradicts the service-only
  design in 055/056 (secret and private-key columns). Staging has zero CSID rows;
  no credential contents were read. The pending RBAC migration now removes this
  policy before its policy-derived grants and unchanged strict postcondition.
  This is a compatibility correction to a migration not applied on audited
  staging. New `20261011133623_staging_repair.sql` also repairs databases already
  past RBAC, revokes client/PUBLIC table and column grants, preserves service
  CRUD, and reloads PostgREST. **Not yet fixed on hosted staging.**
- **P2, incomplete platform foundation:** staging's older admin table lacks
  `note`; canonical CREATE TABLE IF NOT EXISTS cannot add it. The new migration
  adds nullable text without changing existing rows. `platform_invoices` and
  tenant `domain` are absent on staging; their existing repository migrations
  must actually run, not be marked applied because related helpers exist.

Candidate: **97 versions**; staging: **68 versions**; **29 pending**. The eight
restored versions already exist in staging history and must not be replayed
there. No empty migration placeholders were added. Maintainer review and a
non-destructive staged upgrade remain required; clean replay is not a proof
that all 29 pending migrations preserve the older database's records.

## Preview isolation — failed inspection, prevention added

Read-only Vercel project settings inspection showed:

| Variable | Visible scope | Finding |
| --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Production and Preview | Public URL is `https://wwfnsbilmyxeawgzicmv.supabase.co`, not approved staging. |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Production and Preview | Shared entry; value not revealed/copied. Project validity not independently verified. |
| NEXT_PUBLIC_APP_URL | Production and Preview | Public value is `https://elite-dashboard-blush.vercel.app`, not a Preview origin. |
| NEXT_PUBLIC_SITE_URL | Production and Preview | Shared scope; value not revealed. |
| SUPABASE_SERVICE_ROLE_KEY | Separate Production / Preview entries | Names/scopes only; different entries do not prove different values or project binding. |
| RESEND_API_KEY / CRON_SECRET | Production and Preview | Side-effect/credential isolation needs operator review; values stayed hidden. |

Browser/server/admin clients all use `NEXT_PUBLIC_SUPABASE_URL`. Storage uses
those clients, so the wrong Preview URL also points Storage operations at the
old project. Approved staging is `viowrovartosrkqukjxy` (`elite-staging`), with
11 buckets, zero objects; `company-assets` is intentionally public, not private.
Separate project storage exists, but the current Preview is **not** verified to
use it. The old project's data classification remains unconfirmed.

`next.config.ts` now invokes the native Vercel Preview guard, covering Git builds
that bypass Actions. It requires approved staging configuration, Preview app
origin, single-host routing, no foreign site/email origin, and offline ZATCA.
Server-only PUBLIC_* production origins are rejected too. Production/local
build configuration is unchanged. Legacy key metadata checks are not signature
verification; opaque keys still need real API verification. Existing unsafe
deployments are not retroactively changed: operators must configure Preview-only
overrides and rebuild before anyone uses them.

Supabase Site URLs, redirect allow-lists, email templates, actual key validity,
and Preview↔production session isolation remain **unverified externally**.
No token flow or hosted login was exercised against the incorrectly configured
deployment. Do not assume a successful Vercel build proves isolation.

## Registration, recovery and integrity

- **Recovery: partially fixed.** Single-host server email callbacks now use a
  validated absolute `NEXT_PUBLIC_APP_URL`, never a relative callback that can
  fall back to Supabase's production Site URL. Missing/unsafe origin returns
  generic 503 before an email request. Origin is configured, not copied from
  forwarded Host headers. Same-origin return paths reject backslashes and
  control-character host tricks. Real email delivery, token redemption,
  password reset, cookies and expired/reused links still require Preview QA.
- **Registration: partially fixed (redirect only).** Confirmation generation
  receives the explicit callback URL; configuration is resolved before Auth
  creation. **Atomic provisioning/retry/compensation remains unresolved**:
  the route still writes tenant/profile/membership separately, ignores membership
  failure, and reports neutral success on all Auth creation errors. No unreviewed
  recovery by email or user-editable metadata was added. The older trigger trusts
  a user-editable invite marker; any recovery redesign must use server-owned
  intent and preserve the existing admin/invite callers. Do not claim this flow
  is safe because redirect tests pass. No existing Auth account was modified.
- **Accounting integrity: unresolved for finalization/cancellation/notes.**
  `src/lib/accounting/invoices.ts` persists document/AP state separately from
  `emitEvent`; event-insert failure is caught/logged and not rolled back. Credit
  note creation also ignores failure updating the referenced invoice. The
  candidate's atomic draft/payment RPC tests pass, but they do not establish
  finalization/outbox atomicity. This needs a separate transactional fix with
  fault injection, concurrency and retry tests before posted financial CRUD.
- **Authenticated Preview CRUD/cleanup: NOT RUN.** Isolation failed and staging
  has no Auth users. No hosted test accounts or records were created, so hosted
  cleanup cannot be claimed. Local pgTAP fixtures rolled back; a dedicated local
  seed is not a staging account or real authenticated HTTP test.
  The fresh local database also contains the historical demo invoice created
  and finalized by migration `038_invoice_engine.sql` (demo-seed section), not
  a leftover CRUD-test fixture. It was not deleted or edited. This is another
  reason not to replay historical demo SQL or seeds against staging.

## Checks actually run

| Check | Result |
| --- | --- |
| Offline retained history hashes | PASS, all 8 match read-only staging hashes (line-ending normalization only). |
| Fresh isolated local migration replay | PASS, all 97 versions; local Postgres 17.11. No reset command was run. Hosted staging is 17.6; not an exact image/patch match. |
| Complete `supabase test db --local --workdir .kilo/reconcile supabase/tests` | PASS, 21 files / **2,387 assertions**. New 082 suite: 24 assertions for credential grants/column grants/direct denial/service CRUD and fixture cleanup. |
| Rollback-only repeat repair test | PASS: reproduced legacy policy + PUBLIC/client table/column grants, applied repair twice, verified denial, rolled back. |
| `pnpm test --maxWorkers=1` | PASS, 57 files / **626 tests**. |
| `pnpm test:deployment` | PASS, **32 tests**, including native Preview and server-only routing guards. |
| `pnpm exec tsc --noEmit` | PASS. |
| `pnpm lint` | PASS, 0 errors / 85 pre-existing warnings. |
| `pnpm build` | PASS, Next 16.3.8 / 79 static entries, local URL/key placeholders and offline ZATCA only. |
| `git diff --check` | PASS for tracked working-tree edits; **candidate-range check flags retained historical whitespace** in `20260903062109_add_multi_tenant_rls.sql` (six trailing spaces and a blank final line). The staged check revealed this after restoring the previously untracked files. Original SQL is preserved for provenance; this is not an all-diff clean result. |
| Existing static deployment/API guard scripts | PASS; 19 guarded/allowlisted APIs. Static workflow output is not a verification of production credentials. |
| `pnpm audit --audit-level=high` | Exit 0, **one ignored high**, not zero high vulnerabilities. Existing exception documented separately. |
| `pnpm audit --prod --audit-level=high` | No known production dependency vulnerabilities reported. Not a security certification. |

Failures encountered are not hidden: clean replay first stopped at the RBAC
postcondition on the historical credential policy. Its compatibility correction
preserves that guard. The first database test attempt omitted the repository
seed from the custom local config; it failed for missing fixture users/tenant.
The original seed was then applied **only to the new disposable local database**,
and the config references it for future fresh starts. One legacy structural
assertion now checks actual service-only policy/grant access instead of requiring
zero policies (the retained service-role-only policy is legitimate). No assertion
was skipped or coverage reduced. Initial sandbox process-spawn failures were
rerun with permission; a cold-I/O font test timed out once, then passed focused
and in the unchanged full suite. No timeout or assertion was relaxed.

Exact principal local commands (all from the isolated worktree):

```powershell
supabase migration new staging_repair
node scripts/verify-staging-history.mjs
supabase start --workdir .kilo/reconcile
# Unique local project live-crud-reconcile, ports 58320–58326, Postgres 17.
# Config/junctions are local ignored tooling, not hosted/project settings.
# Repository seed was applied with psql --single-transaction to this NEW DB only.
docker exec supabase_db_live-crud-reconcile psql -U postgres -d postgres -At -c "CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;"
supabase test db --local --workdir .kilo/reconcile supabase/tests
pnpm test --maxWorkers=1
pnpm test:deployment
pnpm exec tsc --noEmit
pnpm lint
$env:NEXT_PUBLIC_SUPABASE_URL='http://localhost:58321'
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY='test-key'
$env:NEXT_PUBLIC_APP_URL='http://localhost:3000'
$env:ZATCA_MODE='mock'
pnpm build
pnpm audit --audit-level=high
pnpm audit --prod --audit-level=high
node scripts/verify-deploy-config.mjs
node scripts/verify-api-guards.mjs
git diff --check
supabase stop --project-id live-crud-reconcile --workdir .kilo/reconcile
```

Only the newly created `live-crud-reconcile` local stack was stopped, with
`backup: true` (volumes preserved). No `--all`, `--no-backup` or database reset
was used. Existing local project stacks were not stopped.

Staging read-only preservation snapshot before/after this work: 68 migration
versions, 1 tenant, 1 invoice, 2 invoice lines, 1 bank account, 0 Auth/public
users, 0 Storage objects. Later count additionally confirmed 0 CSID rows. No
hosted write action was performed. Counts are not a full backup/checksum proof
against changes by other actors. No production credentials/data were used for
tests, and no production CRUD operation was attempted.

## Required next stages and explicit approval

1. **Authorized Vercel/GitHub operator:** add Preview-only approved staging URL,
   anon/publishable and server credentials through existing secret stores, not
   chat/source. Set branch Preview APP/SITE origins, unset multi-host origins,
   verify email/webhook/cron/tax side-effect isolation. Leave Production scopes
   unchanged. GitHub needs `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`,
   `STAGING_SUPABASE_SERVICE_KEY`; E2E needs `STAGING_URL`, `TEST_USER_EMAIL`,
   `TEST_USER_PASSWORD` accessible to its job. Verify both native and Actions
   deployments' actual environment and exact commit. Current missing secrets
   are a blocker, not a reason to skip E2E or bypass protection.
2. **Database maintainer:** review 29 pending migrations, rehearse the upgrade
   on a clone with preserved records, review backups and pre/post invariants,
   then apply only the approved non-destructive plan to staging. See the history
   comparison for CLI dry-run commands. Never reset staging or mark partially
   equivalent backfills applied. Ask the owner before destructive/irreversible
   SQL. Confirm effective RLS/grants/storage/account-state behavior there.
3. **Application engineer:** resolve registration's transactional provisioning,
   server-owned retry/recovery intent and safe Auth compensation; resolve invoice
   transitions/notes/AP/outbox integrity with rollback, concurrency and idempotent
   retry tests. These code items are not completed by this reconciliation step.
4. **Auth operator/QA:** constrain staging redirects/templates to the verified
   Preview origin; production must not allow Preview token destinations. Create
   two new marked test tenants/accounts (not attached to existing financial
   records), configure required MFA safely, verify login/registration/recovery,
   invalid/expired tokens, secure cookie/session/redirect behavior and account
   state. Do not share credentials in reports.
5. **QA:** verify approved deployment SHA and staging endpoints first, then test
   actual tenant-scoped UI/server/Data API/Storage CRUD using only new marked
   records, foreign tenant, insufficient permission and disabled-user cases.
   Record IDs privately for cleanup, verify deletion/soft-deletion of drafts and
   removal of only created Storage objects. Posted financial records require
   reversals/approved retention, not bypassing immutability or deleting audit
   history. Compare existing-record invariants before/after. Do not claim cleanup
   succeeded until those operations and checks actually run.
6. **Release owner:** require current-head CI/pgTAP/E2E and isolated Preview CRUD
   evidence, review the whole stacked PR chain, resolve the paused B2B project
   check explicitly, then give a documented **GO or NO-GO**. Until then, live CRUD,
   merge and production release remain **NO-GO**. A GO for isolated Preview QA
   is not approval for production migrations or real-user testing.

At the last external check on prior head `873483d`, CI and pgTAP passed; E2E
and Actions Preview failed missing staging configuration; native primary Vercel
Preview passed despite incorrect isolation, while the paused B2B deployment
failed. These results do not certify the new head; consult PR #68's current
checks after pushing. No hosted deployment/CRUD result is claimed in this report.

Production configuration, backups/restoration, rollback, alerts, legal/privacy
review and actual authenticated production smoke remain separate approval gates.

## Changed-file inventory

Migration/history changes:

- Eight retained migration paths listed in `supabase/history/staging/manifest.json`.
- `supabase/history/staging/README.md`, `supabase/history/staging/manifest.json`.
- `scripts/verify-staging-history.mjs`, `.github/workflows/ci.yml`.
- `supabase/migrations/20261010073050_rbac_completion.sql` (pending replay compatibility).
- `supabase/migrations/20261011133623_staging_repair.sql` (new forward repair).
- `supabase/tests/010_full_rls_test_suite.sql`, `supabase/tests/082_staging_repair_tests.sql`.

Preview/auth changes and documentation:

- `next.config.ts`.
- `scripts/preview-safety.mjs`, `scripts/preview-safety.test.mjs`.
- `src/lib/redirects.ts`, `src/lib/redirects.test.ts`.
- `src/app/api/auth/forgot-password/route.ts`, `src/app/api/auth/auth-routes.test.ts`.
- `src/app/api/platform/register/route.ts`, `src/app/api/platform/platform-routes.test.ts`.
- `docs/live-crud-staging-readiness.md`, this report.

Local disposable configuration, test outputs and dependencies are ignored and
not part of the PR. No environment files containing credentials are committed.
