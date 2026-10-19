# Pending-expense creation and retry safety

The old action inserted an expense and then wrote its audit separately. A
successful insert followed by an audit or transport failure could leave the UI
reporting failure and allow a duplicate expense on retry.

`create_expense_atomic` now derives tenant/actor from the caller's JWT and checks
the actual `expenses:create` permission/MFA boundary. It commits the pending
expense, canonical request payload and creation audit together. A tenant/request
index and transaction lock serialize identical retries. Matching input returns
the original ID; changed input or a removed/altered original requires review.
Historical rows are not backfilled. Approval may legitimately change VAT and
does not invalidate a retry of the original creation request.

The UI keeps one UUID for each open form and preserves it on uncertain saves.
Inputs and dismissal stay locked while saving. Errors are bilingual and explain
safe retries; a new form resets fields/errors and starts a fresh request. Input
validation covers real calendar dates, decimal-rounded positive amounts within
NUMERIC(10,2), VAT bounds and bounded optional text. Pending creation records no
input VAT; the existing approval transaction remains responsible for VAT/AP.

Authenticated direct inserts now require the RPC, preventing creation without
its audit. Caller updates/deletes of managed expenses cannot bypass the guarded
workflow. Existing trusted service imports and historical rows remain usable;
service approval/soft-delete operations preserve immutable request identity.
The function has an empty search path and authenticated-only execution with
internal authorization. Its intentional authenticated SECURITY DEFINER advisor
notice is recorded; anonymous/service RPC execution is denied.

## Verification checkpoint

- Staging migration `20261019190716_expense_creation_atomic_retry` is applied to
  `viowrovartosrkqukjxy` only. The CLI-generated local version was renamed to
  the actual hosted version without repairing or rewriting migration history.
- Focused native PostgreSQL: six simultaneous calls produced one expense/audit;
  exact 1.005 → 1.01 and rate precision, tenant isolation, injected audit
  rollback/recovery, JWT/MFA, input/amount bounds, identity protection, approval
  compatibility and deleted-record retry rejection passed. This uses focused
  authorization fixtures; actual Supabase RBAC/RLS remains a CI/hosted gate.
- Local: 972 unit tests passed before the final year-zero rejection; 43 targeted
  expense tests passed afterward. Full lint has zero errors/86 existing warnings;
  final type checks and production build passed. Current-head CI/hosted results
  are recorded on PR 76 after execution. The expanded browser helper injects a lost successful response and
  verifies unchanged-form retry leaves one persisted record/audit and one summary
  increment. New pgTAP checks exercise the existing approval/AP transaction too.
- Security advisors were compared before/after staging migration. The only added
  notice is the intentional authenticated RPC execution; no anonymous exposure
  or other new notice was introduced.

Production has not received this migration. This does not certify the complete
expense lifecycle: the approval action still dispatches and writes its separate
approval audit after the database approval transaction. Its uncertain-response
and audit-failure handling needs further work. Genuine finance/tax configuration,
accounting acceptance and the other module-review conditions remain open.
