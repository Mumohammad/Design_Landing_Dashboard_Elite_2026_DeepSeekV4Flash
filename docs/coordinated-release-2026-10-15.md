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

No production data, production permissions, production secrets, branch protections, or hosted database history were changed by this integration.
