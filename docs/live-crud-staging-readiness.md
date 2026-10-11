# Live CRUD staging gate — 2026-10-11

Status: **not cleared for authenticated hosted CRUD or merge**. This first fix
hardens the Actions preview path; it does not reconcile hosted migrations, prove
preview isolation, or establish production readiness.

## Approved scope and preservation

- Fix branch: `fix/live-crud-readiness`, based on Accounting branch
  `feat/saas-accounting` at `b66bec1` (PR #67, stacked on #66 and #65).
- Approved staging: `viowrovartosrkqukjxy` (`elite-staging`). The owner confirmed
  its existing records are test data and explicitly required their preservation.
- Read-only staging checks found 68 applied migration versions, zero Auth/public
  users and Storage objects, and existing tenant/invoice/bank-account records.
- The former project `wwfnsbilmyxeawgzicmv` remains out of scope for writes.
  Its production/data classification has not been confirmed.
- Production branch remains `master`. No hosted migrations, resets, Auth-account
  creation, data changes, settings changes, merge or production deployment were
  performed in this step. Preserve the original dirty checkout.
- The owner said the paused B2B deployment is not required. Its integration and
  failing status have not been removed or bypassed.

## Repository changes

`scripts/preview-safety.mjs` and its dependency-free Node regression tests enforce:

1. A real Actions API gate, bound to the PR head SHA and PR number, with both
   `ci` and `pgtap` jobs successful in the latest matching run/attempt. Missing,
   skipped, failed and unavailable checks fail closed; an echo is not a gate.
2. Required staging configuration identifying the approved project before
   pulling/building/deploying. Legacy key metadata checks catch obvious
   project/role mixups; they do not verify signatures or credential validity.
   Opaque keys still require real API verification.
3. Exact agreement between GitHub staging configuration and the three Supabase
   values pulled from Vercel's branch-specific Preview environment. Build-time
   overrides alone do not prove server runtime isolation.
   Require a Preview `NEXT_PUBLIC_APP_URL` and single-host routing; remove the
   build's localhost fallback (the deployment output does not exist yet).
4. Offline ZATCA configuration for CRUD tests (mock mode, no gateway URL).
5. A GET-only preview smoke check that fails on degraded/malformed health,
   exposed anonymous dashboard content, or cross-origin sign-in redirects.
   Health's `getSession()` result does **not** prove a real authenticated login.

The existing authenticated E2E job remains required **before merge**, not before
the preview it needs exists. This does not waive E2E or authorize merging a red
PR. Current E2E tests target `STAGING_URL`; that must be the verified deployment
under review. A successful smoke response is not a full CRUD test.

Both PR workflows now include `feat/saas-accounting` as a target branch so this
stacked fix is tested. The production Actions job remains disabled as before.
Vercel's independent native Git integration is **not** controlled by these
Actions gates. Its Preview configuration must be checked separately before use.

## Migration divergence — do not blindly push or repair history

The Accounting candidate tracks 88 migration versions. Staging has the 60
numbered versions through `060` plus these eight versions absent from the
candidate's tracked migration filenames:

| Version | Applied migration name |
| --- | --- |
| 20260903062109 | add_multi_tenant_rls |
| 20260903164208 | white_label_tenants_and_security_fixes |
| 20260904152818 | audit_remediation_rls_searchpath_anon_hardening |
| 20260904153328 | revoke_public_execute_internal_functions |
| 20260905065316 | platform_admins_console_foundation |
| 20260905073848 | is_platform_admin_helper |
| 20260905074247 | tenants_trial_ends_at |
| 20260906213149 | hot_fk_indexes_and_admin_policy_initplan |

Their original SQL is retained in staging's migration-history table (one stored
statement array entry per version). Only metadata was inspected in this step;
no statements were replayed. A database maintainer must review that SQL and
compare it with repository migrations/current catalogs before producing a
reviewable, forward-only reconciliation. Do not create empty placeholders, mark
unknown versions applied, or reset staging. Test the reconciled path on a
disposable local database first and preserve all existing staging records.

## Checks run for this fix

The associated PR/report records exact final commands and results. Checks:
28 preview-safety tests passed; 615 unit tests passed in 57 files; TypeScript
passed; lint passed with 85 existing warnings; build passed with local-only Supabase placeholders and
offline ZATCA after permitting the existing Google Fonts downloads. Full pgTAP
passed: 20 files, 2,363 assertions, on the existing local `saas-accounting` Docker
database. **No clean reset was performed in this step**, and this is not a
hosted RLS/Storage or preview CRUD result.

`pnpm audit --audit-level=high` exits zero but reports one ignored high advisory;
`pnpm audit --prod --audit-level=high` reports no known vulnerabilities. The
documented development-only exception remains in
`docs/dependency-security-exceptions.md`; do not describe the full audit as zero
high/critical vulnerabilities.

Commands actually run from the isolated worktree:

```powershell
pnpm test:deployment
pnpm test --maxWorkers=1
pnpm exec tsc --noEmit
pnpm lint
node scripts/verify-deploy-config.mjs
node scripts/verify-api-guards.mjs
git diff --check
pnpm audit --audit-level=high
pnpm audit --prod --audit-level=high

# Local placeholders only; no hosted keys were copied into this worktree.
$env:NEXT_PUBLIC_SUPABASE_URL='http://localhost:57321'
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY='test-key'
$env:NEXT_PUBLIC_APP_URL='http://localhost:3000'
$env:ZATCA_MODE='mock'
pnpm build

# Existing, verified local Docker stack; this is NOT --linked or --db-url.
supabase test db --local --workdir 'C:\Users\Zbook\AppData\Local\Temp\saas-accounting\.artifacts\accounting-local' 'C:\Users\Zbook\Downloads\shadcn-dashboard-landing-template-main (1)\shadcn-dashboard-landing-template-main\nextjs-version\.kilo\qa\supabase\tests'
```

Initial unit-runner startup failures were resolved by shortening the isolated
Windows worktree path and rebuilding dependency links with the frozen lockfile.
No dependency versions or assertions changed. Initial sandboxed builds could not
download Google Fonts; the permitted-network build passed. These local tooling
fixes do not establish any hosted or production result.

## Required next steps and owners

1. **Database maintainer:** reconcile the eight retained historical migrations
   and 28 repository-only versions; validate a fresh local reset plus all pgTAP
   tests, and a non-destructive staging upgrade with pre/post record counts.
   Review pending registration recovery and invoice-finalization/outbox integrity
   findings separately; this CI-only fix does not resolve them.
2. **Authorized Vercel/GitHub operator:** set Preview-only configuration through
   the existing secret stores (never paste values into chat or source). At the
   last verified inspection, GitHub's Preview secret list was empty and repository
   secrets contained only the three Vercel names. Required names are
   `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`,
   `STAGING_SUPABASE_SERVICE_KEY`; the existing E2E job additionally needs
   `STAGING_URL`, `TEST_USER_EMAIL`, `TEST_USER_PASSWORD` accessible to that job.
   Do not change Production scopes. Verify the native Preview deployment also
   uses the approved project's URL and keys, and local-origin auth redirects.
   Set Preview `NEXT_PUBLIC_APP_URL` to the branch's approved Preview origin;
   leave `DEPLOYMENT_ROLE`, `NEXT_PUBLIC_DASHBOARD_URL` and
   `NEXT_PUBLIC_LANDING_URL` unset there. Single-host server-side password-recovery
   currently passes a relative confirmation URL and needs a separate code fix
   plus tests before recovery can be counted as verified.
3. **QA/operator:** create dedicated staging-only test accounts/tenants after
   schema review. Record the deployment SHA and immutable Preview URL. Disable
   external email/webhook/billing/tax side effects for this test environment.
   Run authenticated login/recovery/redirect tests and actual create/read/update/
   delete flows on newly marked test records, with foreign-tenant, insufficient-
   permission and disabled-user cases. For posted financial records, verify
   rejection of edits/deletes and use supported reversals. Clean up only records
   created by these tests, not existing financial history.
4. **Reviewer/release owner:** require green CI, pgTAP, E2E and documented Preview
   CRUD, review the whole stacked PR chain, resolve the unrelated paused-project
   check explicitly, then decide whether to merge. No merge or production release
   should be inferred from local build/test success.
5. **Production operator:** only after explicit approval, review migration
   reversibility, backups/restore and deployment rollback, production secrets and
   Auth URLs, monitoring/alerts, and current dependency status; verify the normal
   production deployment and read-only smoke separately. Never use production
   data for test CRUD.
