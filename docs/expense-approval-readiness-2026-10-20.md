# Expense approval transaction and recovery

Expense approval previously committed the payable/event before writing its
approval audit in a separate request. An audit or response failure could leave
the browser reporting failure after the financial decision had committed.

Both the Expenses screen and positive Approvals inbox decision now share one
action and a service-only transaction. It locks the current expense, claims it
once and commits the matching payable, accounting event and approval audit
together. The inbox's required reason is retained in that same transaction.
An audit failure rolls everything back. Conflicting legacy payables/events
require review instead of silently returning an unrelated event receipt.

VAT is calculated using the two-decimal rate retained on the expense. The inbox
has no tax editor, so an omitted rate preserves the locked source's saved rate,
including zero/reduced VAT. Locking also prevents an overlapping historical edit
from leaving the payable/event based on an older amount. Caller updates cannot
alter approval evidence or approved expenses outside the guarded service path.
The existing five-argument service RPC remains compatible. No business rows or
historical audit records are backfilled by this migration.

After a confirmed commit, dispatcher/cache/notification failures do not turn
the approval into a reported failure. The action checks its exact accounting
event and warns when posting is pending, failed or unverified. A lost browser
response retains the form for review/retry; an already-approved response refreshes
the list without a second payable/event/audit. Both dialogs clear their busy
state on transport failure and guard dismissal during an active request.

## Verification and release boundary

The candidate includes database tests for atomic audit rollback, retained VAT,
stale events, tenant/caller boundaries and inbox reasons. A separate disposable
database test exercises six concurrent approvals and a pending historical edit.
The hosted browser helper exercises successful-response loss, same-form retry,
both approval entry points, one payable/event/audit/journal/VAT row, balanced
journal lines and Arabic mobile rendering using synthetic staging data.

Staging migration `20261020011334_expense_approval_atomic_audit` is applied to
`viowrovartosrkqukjxy`. Its actual hosted version matches the repository filename.
Both approval RPCs are service-only with an empty search path; anonymous and
authenticated execution are denied. Security advisor findings are unchanged
after removing observation timestamps from the comparison.

Local unit verification passed 983 tests. Results for the final commit and hosted
deployment are recorded on PR 76 after execution. Test implementation alone is
not evidence of a passing run. Production migration/merge/promotion remain
separate gates.

On `03e0c38`, the main and E2E CI jobs passed, and all 2,565 database assertions
and approval concurrency cases passed. The subsequent browser approval check
found that new companies lacked expense mappings. The [accounting initialization
continuation](company-accounting-defaults-2026-10-20.md) addresses that setup defect;
the failed candidate was not merged/promoted.

This fixes positive expense approval, not the entire Approvals module. Expense
rejection still uses a separate update/audit path and lacks a durable rejected
state. The inbox's capped queue, inactive search and swallowed read errors need
further work. The [VAT posting continuation](expense-vat-posting-2026-10-20.md)
addresses the reproduced zero-line failure for zero/non-recoverable VAT; its final
acceptance is recorded separately. Genuine finance configuration,
tax setup and finance-owner acceptance remain required.
