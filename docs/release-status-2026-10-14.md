# Release status — 14 October 2026

Production is not approved for release. PR #69 remains draft and unmerged; invoice CRUD is stacked in draft PR #70. Neither local verification nor a successful Vercel login replaces the hosted release gates.

## Verified external state

- Vercel CLI/API access works for elitesaasc-5643 / elite-dashboard (project prj_0FJTFtAXzBZMUP9rPyU7XtiEYteX). A fresh inspection supersedes the October 3 snapshot: production alias https://elite-dashboard-blush.vercel.app points to READY deployment dpl_6AvrHT1TvQwRJjyyENqrheoYZVWD, created 2026-10-13 21:02:35 UTC (14 October 00:02:35 Riyadh). Its source is `redeploy`, with GitHub master SHA 3362ab17b8da7240cd44ef15a6c8cd47c59bae21. It does not contain PR #69 or #70. The immutable URL is https://elite-dashboard-lfwxjc7un-elitesaasc-5643.vercel.app. Read-only health and sign-in requests returned HTTP 200; health reported app/database/auth OK but version unknown. Authenticated production CRUD has not been tested, and this session did not create that deployment.
- The existing preview configuration points to production Supabase. Configure branch-specific staging variables before any hosted mutation tests.
- The chosen staging project is viowrovartosrkqukjxy (elite-staging). Preserve its existing invoice and other data; do not reset it.
- Supabase CLI project listing, linking, and production backup inspection succeeded on this date. Subsequent migration list/fetch requests failed at the temporary database login endpoint with HTTP 403 (insufficient privileges). Access is not consistently sufficient for migration operations.
- The production backup response reported walg_enabled=true, pitr_enabled=false, backups=[], physical_backup_data={}. This does not establish a recoverable backup. An independent backup may exist elsewhere, but none has been verified. Database and Storage recovery evidence remains a launch gate.

## Staging migration history drift

A read-only `db push --dry-run --linked` stopped because these applied staging versions are absent from repository migration files:

| Version | Name |
|---|---|
| 20260903062109 | add_multi_tenant_rls |
| 20260903164208 | white_label_tenants_and_security_fixes |
| 20260904152818 | audit_remediation_rls_searchpath_anon_hardening |
| 20260904153328 | revoke_public_execute_internal_functions |
| 20260905065316 | platform_admins_console_foundation |
| 20260905073848 | is_platform_admin_helper |
| 20260905074247 | tenants_trial_ends_at |
| 20260906213149 | hot_fk_indexes_and_admin_policy_initplan |

The stored SQL was inspected through the read-only connector. It includes historical tenant policies, later policy removal, search-path/grant hardening, platform-admin setup, trial metadata, and six hot-path indexes. It is not equivalent to merely renaming the repository's reconstructed production migrations. Production has version 20260906220134 instead of staging's 20260906213149.

Do not run the CLI's suggested `migration repair --status reverted` blindly: it would discard real historical records and could cause replay of already-applied schema changes. Reconcile a staging-specific historical manifest and verify catalog parity before applying pending repository migrations. No history repair or hosted migration was performed.

## Check results

- PR #69, commit 49d71242d5210402d03ecc95e4b779ad570e13e6: CI and pgTAP jobs passed; hosted E2E failed because staging URL and test credentials were not configured.
- PR #70, commit abb2e0d229cc19aa12fcc9cbee351873f4592569: CI and pgTAP jobs passed; hosted E2E failed at configuration. Later UI follow-up work must receive checks on its own commit.
- Production backup/Storage restore drill, authenticated staging flows, merge authorization under repository rules, and exact production commit verification remain incomplete.

## Release order

1. Restore Supabase migration privileges and reconcile staging history without discarding data.
2. Configure a staging-only Vercel preview and synthetic test identity; pass authenticated E2E.
3. Verify database and Storage recovery, review the PR and exact-head CI.
4. Merge PR #69 only after all launch gates pass; coordinate its migration/application rollout and verify the deployed merge SHA.
5. Release invoice and journal CRUD separately with their matching database migrations and passing checks. Additional module work does not waive the initial release gates.
