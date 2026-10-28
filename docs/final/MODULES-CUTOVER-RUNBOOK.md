# Modules migration cutover

This runbook supplements the production modules release checklist. It does not authorize a release with failing checks or changes to business records or production secrets.

## Why a coordinated cutover is required

The 22 forward migrations after the released `6b21b383993022690c6c13c96994243e41e9b6a3` baseline replace direct writes and older approval/application/leave entry points with reviewed atomic operations. The accounting master completion additionally protects customers, suppliers and chart accounts with caller-bound receipts, timestamp checks and audited transactions; the platform schema convergence adds the nullable provenance column already present in production. The invoice completion additionally preserves four-decimal unit prices and separate item names, adds a presentation-only due-date preference, and introduces complete caller-bound reads and transactional draft retry receipts. Historical/sample-only post-VAT adjustments remain excluded from new issuance. The final period correction lets a reviewed reopened period close again while retaining the pending-draft guard, original reason and service-only execution. The old application is not compatible with the completed schema. Some legacy server actions use service-role writes; retaining access to their old immutable deployments after promotion would also retain those older application paths. Do not restore old client grants to hide this incompatibility.

## Before changing production

- Finish the local checks, rollback-only SQL suites, production-copy restore/upgrade rehearsal, hosted module acceptance, Linux invoice/font verification, exact-head CI and diff review. Keep an explicit evidence row for every workflow; a separately passing module is not a passing coordinated suite.
- Verify the current production schema history, serving commit, intended project/team and alias. Refresh the approved ignored local backup close to cutover, preserve prior backups, and rehearse from the actual released baseline. Storage metadata in a database backup is not a backup of Storage file contents.
- Review the pending migration inventory and exact source hashes. Do not replay the eight archived staging migrations, run seeds, repair migration history, or modify the retained historical finance examples.
- Merge only the tested feature head after checks pass. Verify that the production base has not changed underneath the reviewed candidate. Keep the existing automated deployment holds in place.
- Build the exact merge commit with the existing production environment and licensed private Tahoma package using a deployment with domain assignment held (`--prod --skip-domain`). Verify its project, commit, asset package and production-only backend configuration. Do not create production test business records or regenerate an existing invoice merely to run a smoke test.

## Fence, drain and apply

1. Re-read the live and staged project routing versions. Abort on an unexpected concurrent routing change. The scoped staging probe evidence is a mechanism test, not permission to overwrite unrelated routes.
2. Publish a first-position project maintenance rule returning HTTP 503 with `Retry-After` and `Cache-Control: no-store`. Project routes cover immutable deployments as well as aliases and execute before Skew Protection. Any staging exemptions must be exact reviewed hosts and must not permit requests pinned to an older production deployment.
3. Verify the public production alias and legacy immutable production URLs are fenced for ordinary requests and deployment-ID header/query/cookie requests. Verify any intentional staging exemptions still identify the staging database. Preserve user cookies; do not sign users out or reset passwords for the cutover.
4. Drain in-flight requests and jobs using the actual configured maximum function durations and current database activity. The released deployment inventory has a 300-second maximum; allow at least 300 seconds after the verified fence, then confirm database activity is drained. A CDN fence does not stop already-running requests, direct Supabase traffic, or independent scheduled jobs. Confirm those paths are quiescent or separately controlled before applying incompatible changes. Earlier local write-fence rehearsals covered 19 source migrations and all 128 original public/Auth/Storage tables. They do not establish the final 22-migration cutover or hosted HTTP/Auth/Storage/session behavior. Record the final inventory and preserve numeric values semantically when a numeric column gains scale; rounding new values back to an old type can hide a change. Rehearse the final inventory, preserve existing pre-request hook behavior, and verify actual hosted write blocking and recovery before relying on that mechanism.
5. Apply only the reviewed forward migrations, in order, with a short lock timeout and bounded statements. Do not kill unrelated transactions to obtain a lock. If a migration fails, retain maintenance, inspect the recorded state and repair forward from the tested source; do not blindly replay successful versions or remove their history.
6. Verify migration versions, grants, function signatures and the preserved business-record invariants before promoting the held merge deployment.

## Resume safely

- Promote the verified merge deployment, then verify immutable and public-alias health/version/CSP and read-only key flows against the intended production project.
- Keep legacy production-backed immutable deployments fenced. Do not assume a missing Skew Protection setting means it is disabled. Explicitly verify an appropriate deployment cutoff or disable old deployment pinning, then test old deployment-ID headers, queries and cookies against the public alias before restoring writes. Use a reviewed policy that accounts for every legitimate current domain and future preview.
- Remove only the temporary maintenance rule, preserving the legacy-deployment fence and unrelated routing rules. Verify the final routing version, exact public serving SHA and healthy responses. Record the actual deployment URL, migration versions, CI results and remaining limits in the release record.
- After these migrations, rolling only the app back to `6b21b38` is unsafe. Prefer a tested forward application fix while maintenance remains active. A database restore requires a separately approved recovery plan and consideration of every write after the backup.

## Limits that must stay explicit

Current QR output remains application-generated internal invoice information. Official ZATCA Phase 2 issuance and bank/provider acceptance remain independently gated. Preserve the authority-submission gates and honest UI disclosures. Leaked-password protection remains unavailable on the organization plan retained by the owner; do not claim it is enabled. Production secret rotation requires the owner's explicit approval.
