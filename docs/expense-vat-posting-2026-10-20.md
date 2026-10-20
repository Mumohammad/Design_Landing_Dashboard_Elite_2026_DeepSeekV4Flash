# Expense VAT classification and posting

The actual consumer/journal functions reproduced `JRN007` for zero-VAT and
non-recoverable expenses. The consumer always supplied three journal lines,
including a VAT line with both debit and credit zero. The journal engine correctly
rejected that line, leaving the approved expense/payable waiting for posting.

The consumer now constructs two balanced lines when there is no recoverable VAT
debit, and three only when recoverable VAT is positive. Non-recoverable and
pending-review VAT retain the existing gross debit policy. The input VAT ledger
still retains the original VAT amount and classification; omitting an empty
journal line does not erase tax evidence or turn non-recoverable VAT into a claim.
The VAT account is resolved only when a VAT debit is needed. The journal engine's
zero-line and closed-period protections are unchanged.

The source must be approved and is locked during posting. Existing journal replay
remains a skip. The consumer has an empty search path and service-only execution;
the JWT/MFA-bound accounting dispatcher remains the browser authorization boundary.
The migration does not rewrite past journals, VAT rows, payables or expenses.

The approval dialog now starts with the category's configured recoverability,
instead of always choosing recoverable. Invalid classifications or dangling
account mappings produce an explicit dependency error. Users can still choose
the applicable classification when approving, subject to finance-owner policy.

Staging migration `20261020095034_expense_posting_vat_lines` is applied. Its actual
hosted version matches the checked-in filename. Function privileges were checked,
and normalized security advisor findings are unchanged.

Verification implemented/recorded:

- Focused native PostgreSQL first reproduced both failures using the repository's
  real consumer/journal functions. After the change, both cases produced two
  balanced lines without needing a VAT account, retained classified VAT evidence,
  replayed without duplicates and denied anonymous/authenticated direct calls.
- Local unit tests passed 986 cases. Full lint/types/build and exact-commit CI/
  hosted results are recorded on PR 76 after execution.
- New database cases cover recoverable, zero, non-recoverable, pending-review and
  rounded-to-zero VAT, balanced/classified postings, replay, strict journal
  validation, unapproved source denial, closed periods and private execution.
- The hosted browser helper verifies stored rate/category defaults, posts all
  three additional UI classifications, checks exact journal sides/VAT/AP/audit,
  and confirms full-summary values using synthetic staging data.

This preserves the repository's existing classification policy; it is not tax
advice or certification that a tenant's chosen VAT treatment is legally correct.
Official ZATCA issuance, rejected-expense state, complete approval queues and the
other module/operational launch conditions remain open. Production has not
received this migration or an automatic retry of historical failed events.
