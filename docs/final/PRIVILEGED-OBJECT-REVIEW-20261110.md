# Privileged-object review — 10 November 2026

Status: partial review, no hosted permission/schema changes, no blanket security certification.

## audit_log_safe

The security advisor flags this public owner-executed view in both Production and staging. Hosted metadata shows owner postgres, security_barrier=true, authenticated SELECT and no anonymous SELECT. Both definitions have fingerprint f8cd26b7e1281a9a0eb27b525c9489fa.

The repository's 20261023060000_audit_metadata_privacy.sql defines a minimized audit projection. It checks a non-null authenticated caller, current tenant and audit_log.read; joins only that tenant's audit rows; requires the tenant active and not deleted; projects payloads through audit_metadata_minimal; returns no raw reason/IP. Financial metadata access separately depends on accounting.read or payroll.read.

Read-only hosted checks confirmed those predicate/projection markers in both environments. Anonymous view SELECT, authenticated INSERT/UPDATE/DELETE and authenticated raw old_values/new_values column SELECT were false. These checks inspect catalog contracts, not live audit records. They do not validate all dependent function bodies, stale-token handling or runtime caller behavior.

The corresponding repository suite 143_audit_metadata_privacy.sql exercises foreign tenants, absent audit permissions, required MFA, missing identity, suspended/deleted tenants, anonymous/service ACLs, raw payload minimization and retained immutable history. Suite 137 checks company/bank-reference privacy. The overall disposable SQL run passed 4,870 assertions; hosted real-role acceptance remains required.

## Resolution decision

Do not switch this view to security_invoker merely to clear the warning: its minimized projection reads raw columns that authenticated callers are deliberately denied. First establish the supported boundary. Either retain the explicitly reviewed owner-executed projection with a documented exception and real-role/tenant/MFA denial acceptance, or move the privileged projection into a non-exposed schema and provide a narrow reviewed API that preserves all caller gates and privacy behavior. Rehearse the migration and frontend/RPC compatibility on an isolated baseline before applying it.

Security-barrier behavior is not a substitute for tenant authorization or invoker security. Predicate markers and an identical hash are not complete security proof. The remaining anonymous and authenticated definer-function findings still need individual ownership, grants, search-path, identity/role/MFA, tenant, idempotency and failure-boundary review. No bulk revoke or security-definer rewrite is justified by this partial inventory.

Reference: https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view
