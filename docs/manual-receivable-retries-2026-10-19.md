# Manual receivable creation and retries

The previous action inserted a receivable and then wrote its audit entry in a
separate operation. An audit or response failure could leave a saved row while
the user saw failure; retrying could create another record.

`create_manual_receivable_atomic` now derives the actor and tenant from the
caller JWT and requires the database's accounting/create and MFA permission.
The receivable, request identity and audit entry commit in one transaction.
A tenant/request advisory lock serializes simultaneous retries. An unchanged
retry returns the original record without another audit entry. Reusing the
request for different details or a removed/altered original requires review.

The form keeps one request UUID while open, including after an uncertain HTTP
response. Starting a new form creates a new UUID and clears its fields and old
errors. Inputs/closing are disabled while saving. A page refresh or a deliberately
new form is a new intent; this does not claim cross-session deduplication.
Direct authenticated Data API writes cannot forge or change managed request
identities. Existing unmanaged rows are not backfilled or rewritten. Existing
service-side payment/soft-delete workflows remain compatible.

Exact decimal VAT is calculated by PostgreSQL after normalizing net amount to
two decimal places. The UI/action retain early validation and preview helpers,
but the database enforces payload types, date order, reference length, amount
range, positive rounded amount and VAT bounds. SAR 4.10 at 15% persists VAT 0.62
and total 4.72. The action uses the session-bound client instead of an admin
insert and never exposes database/transport details in its retry messages.

## Evidence and limits

- Local unit suite: 900 tests passed; lint: zero errors, 86 existing warnings.
- Local production build, TypeScript and the 84 MiB PDF runtime trace pass.
- A fresh native PostgreSQL database verified six simultaneous retries, one
  record/audit, exact VAT, tenant isolation, audit-failure rollback and retry,
  request immutability, invalid inputs and deleted-record handling. This focused
  fixture is not a substitute for actual Supabase authorization tests.
- `085_manual_receivable_atomic_tests.sql` and the concurrent database verifier
  are required in CI against the full Supabase schema. The browser verifier
  deliberately drops a successful server-action response, then retries the
  same form and checks one persisted record/audit and a clean new form.
- Staging project `viowrovartosrkqukjxy` has migration
  `20261019162847_manual_receivable_atomic_creation`. The connector applied the
  tested DDL after the CLI refused eight pre-existing remote-only migration
  versions. Historical migration records were not repaired or removed.

Current-commit CI and hosted browser results belong in PR 76 after execution.
Production has not received this migration. This is manual AR creation/retry
hardening; party selection, full lifecycle/posting acceptance, remaining capped
reads, official ZATCA and the other launch conditions remain open.
