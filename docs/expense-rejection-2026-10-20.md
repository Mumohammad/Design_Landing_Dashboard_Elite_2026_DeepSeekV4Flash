# Durable expense rejection

The old inbox rejection only updated timestamps and wrote a separate audit.
The pending queue did not exclude it, so a supposedly rejected expense could
remain pending, be rejected repeatedly or later be approved.

Rejection now locks the expense and retains its decision time, actor, reason and
audit in one transaction. A rejected expense leaves the decision queue, remains
reviewable in Expenses and cannot later be approved. Concurrent approvals and
rejections have one winner. Audit failure rolls back the rejection. Existing
payables/events/journals or stale approval evidence require financial review
instead of being erased or hidden by a rejection.

The inbox and stale approval dialogs report an existing decision honestly and
refresh after lost-response retries. The Expenses table distinguishes rejection
from pending and has an accessible inline disclosure for its reason. Pending
counts exclude rejected records. The amount card is labeled recorded net: it
retains submitted amounts across decision states, rather than claiming to be
posted accounting expenditure. Retried creation also reports that the original
record already exists instead of incorrectly promising it is still pending.

Only trusted server code can execute the rejection RPC; the action retains
tenant/permission/MFA and rate-limit checks. Actor membership/active state and
reason bounds are checked in SQL too. Client updates cannot forge, reopen or
delete rejection evidence. Queue tenant binding and per-module permissions are
preserved. Nullable metadata and a consistency check do not reinterpret old
records or backfill past audit-only rejection entries.

Staging migration `20261020102116_expense_rejection_atomic_decision` is applied.
Privileges and empty search paths were verified. Security advisor findings are
unchanged; performance advisors add only the expected informational unused-index
notice for the new rejection-actor FK index. No production migration or data
repair has occurred.

Focused native database verification passed six concurrent rejections, mixed
approve/reject arbitration, rejected/approved transition guards, audit rollback
and retry, legacy financial conflict rejection, input/actor and direct-caller
boundaries. The native scaffold does not replace actual Supabase queue/RLS tests.
Local unit tests passed 997 cases; lint has zero errors/86 existing warnings and
type checks passed. Final build, exact-commit CI and hosted evidence are recorded
on PR 76 after execution.

New pgTAP/browser coverage checks queue exit, durable reason/audit, financial
conflicts, private execution, no financial effects, response loss/retry and an
approval submitted from a stale tab after another decision. The record and
reason must remain visible in English desktop and Arabic mobile views.

This is not a complete Approvals module claim. Queue pagination/search and read
failure handling still need work; leave/application decisions retain their
separate transition/audit paths. Past audit-only rejections need an explicit
business review if they are to be reconciled. Pending expense edit/archive and
the other module/operational launch conditions remain open.
