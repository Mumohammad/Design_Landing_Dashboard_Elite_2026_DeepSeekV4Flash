# Coordinated release — 15 October 2026

This is a release candidate, not a production deployment confirmation.

## Included work

- The production-readiness, invoice draft, journal draft, bank lifecycle and invoice reference-print changes from PRs #69–73.
- Maintenance and platform CRUD from PRs #63–64, merged into the same candidate.
- Transactional payment recording/reversal and SAR-only accounting safeguards from PR #67, reconciled with the newer invoice and bank RPCs. The old invoice draft implementation is superseded by the versioned, atomic draft editor in this candidate.
- Accessible field names for the imported operations forms, plus authenticated browser verification for platform create/edit/deactivate and maintenance create/edit/start/complete.
- Existing production data is never automatically relabeled to SAR. Legacy foreign-currency records require a separate disposition before editing/posting.

## Verification so far

- 660 unit tests passed.
- Lint: zero errors, 87 existing warnings. Type check and production build passed.
- Replayed all 68 migrations from the selected staging project's recorded history into the disposable local stack, then applied the pending repository migrations without erasing historical records.
- The resulting database passed 2,468 assertions across the database suites, including the final targeted 51-assertion payment rerun after correcting its privileged fixture setup. Tests enforce current RBAC/MFA and anonymous denial, rather than the old branches' permissive assumptions.
- Concurrent retries produced one payment and one audit entry. Competing allocations allowed one commit and rejected the competing overspend.
- Browser and hosted CI results must be appended after completion; a local build is not a hosted staging release check.
- All eight local Auth/Storage integration tests passed after allowing 30 seconds for HTTP assertions; the initial five-second default timed out two assertions on the cold local stack.
- Authenticated browser checks passed invoice create/edit/print/PDF/delete, journal draft CRUD, bank lifecycle and the paginated payment-bank picker. The operations run exposed a real platform edit-dialog bug: blank disabled code and blank names prevented saving. The dialog now initializes all identity fields from the selected record; the browser test asserts those values before editing.

## Confirmed external state and remaining release gates

- Vercel production is still READY deployment `dpl_6AvrHT1TvQwRJjyyENqrheoYZVWD`, from master `3362ab17b8da7240cd44ef15a6c8cd47c59bae21`. The canonical alias is https://elite-dashboard-blush.vercel.app. It does not contain these pending features.
- Production Supabase `wwfnsbilmyxeawgzicmv` still ends at migration `20261001230000`.
- Staging `viowrovartosrkqukjxy` has eight additional historical migration versions. The local rehearsal preserved those records and demonstrated an upgrade path. No hosted migrations were applied during this integration.
- Supabase SQL connector access works. CLI temporary migration login and API-key access still returned HTTP 403; the user is updating account access.
- Read-only production inspection found four active accountants and one active supervisor with no grants attached to their roles. This can explain permission failures for those accounts; deployment alone cannot repair them. Do not grant permissions without confirming the intended access, and do not silently modify live users.
- A staging-only preview, synthetic test identity and hosted E2E configuration are still required. Existing preview configuration must not be used for mutation tests because it points to production.
- Verify recoverable database and Storage backups, exact-head CI, diff review, and rollout compatibility before merging or promoting production. The existing deployment hold is retained.

## Hosted verification update — 16 October 2026

- Applied all 36 pending migrations to staging `viowrovartosrkqukjxy` through the connected Supabase migration tool after CLI writes repeatedly failed with HTTP 403. Reconciled only each newly generated migration record to its corresponding repository version after successful application; retained all pre-existing history. Staging now has 104 migration records, ending at `20261014073118`.
- Backed up staging schema and all 79 public tables (491 rows), then restored them into a separate local database and compared every row value. A fresh export matched the verified backup. Staging had no Auth users or Storage objects before testing. The original invoice and its two lines remained unchanged after migration.
- Created branch-scoped Vercel preview variables pointing exclusively to staging. Deployment `dpl_6DLE76ZLQyanjrXHY34PrCifEGJC`, https://elite-dashboard-ppw4h5tzg-elitesaasc-5643.vercel.app, is READY at runtime commit `dd6074c926ec42999f321ab7c5175a8778cc9778`. Its health response confirmed that commit and healthy database/Auth connectivity.
- Hosted authenticated browser verification passed invoice create/edit/mobile/print/PDF/delete/audit; journal draft CRUD; bank lifecycle and payment-bank pagination/search; platform create/edit/deactivate; maintenance create/edit/start/complete; owner MFA enrollment, sign-out, and returning-user challenge. Fixtures were isolated to newly created staging tenants.
- Configured a separate read-only staging CI identity and the missing GitHub Actions staging secrets without printing or committing values. The first hosted smoke run passed 16/17 tests. Its sidebar navigation test used an immediate URL assertion after a network-idle wait and could silently skip an absent link. It now requires the actual sidebar link and waits for the destination URL; three repeated hosted runs passed. Full CI must pass on this test-only correction before merge.
- Backed up and checksum-verified all 22 production Storage objects (1,445,361 bytes) across 11 buckets. Production schema backup exists; full production database backup and restore verification are still pending. Local Docker failed at startup; a separate native PostgreSQL recovery instance is available on loopback port 59432.
- Production preflight found four user-consent rows whose new sequence field would be populated by the consent migration, plus two missing tenant roles affecting four active accountants and one active supervisor. Production data/permission repairs require the user's explicit approval. No foreign-currency records were found in the five accounting tables checked.

No production migrations, business-data changes, permission repairs, production-secret changes, GitHub merges, or production deployments have been performed. Staging migration history and synthetic test fixtures have changed as described above. The earlier external-state section records the state before the hosted upgrade.
