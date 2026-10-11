# Staging history evidence — 2026-10-11

Source: read-only queries of `supabase_migrations.schema_migrations` and
Postgres catalogs on **viowrovartosrkqukjxy**. No credential rows were read.
The eight missing files in `supabase/migrations` retain the original SQL,
names and versions. The manifest stores SHA-256 hashes computed in staging;
the offline verifier normalizes only checkout line endings/trailing newlines.

Run `node scripts/verify-staging-history.mjs`. It never connects to a database,
repairs history, or marks a version applied. CI runs this provenance check.

## Effect reconciliation

| Retained version | Confirmed staging effects / later supersession | Candidate relationship |
| --- | --- | --- |
| 20260903062109 | Tenant UUID foreign keys on drivers/vehicles/applications and all three indexes exist. Its nine broad PUBLIC policies were dropped by 20260904152818 and are absent now. | Restore exact history, not the obsolete policies on staging. 076/077 test the later tenant/RBAC boundaries. |
| 20260903164208 | `slug`, JSONB `brand_colors`, unique slug index exist; zero null slugs. `vehicle_active_documents` is security-invoker. Rate-limit ALL policy is service-role-only. Its authenticated ALL credential policy **still exists**, with authenticated table grants. | 055/056 explicitly require service-only credentials. RBAC removes the invalid policy before grant calculation; new repair revokes table/column grants on already-upgraded databases too. No credential rows were inspected; count is zero. |
| 20260904152818 | All 24 listed function search paths equal `public, extensions`. Nine superseded PUBLIC policies absent. Anonymous application policy is still default-tenant-bound. All ten indexes exist. Tenant/RBAC helpers remain the older implementation. | Restore original SQL. Later 061/launch/RBAC migrations supersede parts; do not mark those later versions applied on staging based on this partial overlap. |
| 20260904153328 | Anonymous/PUBLIC direct execution revoked for the specified internal functions; authenticated execution remains for completeness/chart validation. Auth/profile trigger execution revoked from clients. | Overlaps later reconstructed revoke migrations, not proof that their entire effects exist. |
| 20260905065316 | Admin allowlist table/RLS/self-read policy exist. Original table has **no `note`** and did not create `platform_invoices`. | 20260905091941's CREATE TABLE IF NOT EXISTS cannot add `note` to this older table. New repair explicitly adds nullable `note`; the canonical foundation must actually create missing platform invoices. |
| 20260905073848 | Admin helper exists, pinned to public; anon execute false, authenticated true. | Helper overlap is not equivalence with the full canonical platform-console foundation. |
| 20260905074247 | Trial timestamptz column and partial trial index exist. | Original statement adds metadata only; it does not populate trials or establish other registration effects. |
| 20260906213149 | All six hot-path FK indexes exist; admin self-read uses initplan auth UID. | Canonical 20260906220134 additionally creates platform-invoice indexes/read policy, impossible to confirm while platform invoices are absent. Do not mark it applied. |

The 22 expected index definitions, tenant FK definitions, relation columns,
view option, policy conditions/roles and function configurations/grants were
compared, not just migration filenames. The historical SQL's own comments
are retained as evidence, not endorsed as security conclusions.

## Forward path and limits

The candidate now has **97 versions**. Staging still has **68**, leaving
**29 repository versions pending**. Restoring matching history does not mean
the hosted database is upgraded. No migration repair or hosted DDL was run.
Do not replay an already-recorded historical statement, create placeholders,
use `--include-seed` on staging, or copy the local test seed into staging.

The RBAC migration is still pending on audited staging. Its compatibility fix
removes the invalid CSID policy before its existing strict postcondition; no
guard is relaxed. The new forward repair covers databases already past RBAC,
adds the missing admin column, revokes inherited/client column and table
credential grants, preserves service CRUD, and notifies PostgREST.

Fresh local replay exposed this ordering problem; after its fix, all 97
versions applied on a new isolated local Postgres 17 database. This is not a
staging-upgrade result, migration-equivalence shortcut, or production approval.

Before any hosted apply, a database maintainer must review **each** of the 29
pending files against staging's schema and existing records. Review constraint,
trigger, backfill, view and grant changes and any SQL that can mutate data.
The SAR NOT VALID constraints preserve historical currency labels but need
specialist review if existing foreign-currency records are found; never
relabel them to SAR. Any destructive/irreversible change requires the owner's
approval. Use a backup and an isolated clone for upgrade rehearsal.

CLI 2.119.0's read-only planning commands, **recommended, not run on staging**:

```powershell
supabase migration list --project-ref viowrovartosrkqukjxy
supabase db push --project-ref viowrovartosrkqukjxy --dry-run --include-all --skip-vault
```

Use the authorized operator's existing secure credential environment. Never
put passwords/connection strings on the command line or in this document.
Do not run the apply variant until the reviewed plan and preservation checks
are approved. Never target `wwfnsbilmyxeawgzicmv` for these tests.
