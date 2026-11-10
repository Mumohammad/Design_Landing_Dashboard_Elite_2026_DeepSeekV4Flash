# Expenses overview correctness

The old page fetched only the newest 100 expenses, searched those rows in the
browser and summed them as if they were the whole tenant. Failed expense reads
looked empty. Mapping/account reads could fail silently or miss account codes
beyond their own first-100 cutoff.

The candidate uses the existing shared 25-row database pagination hook with
exact counts, stable expense-date/ID ordering, debounced full-dataset literal
search and stale-request cancellation. Expense code, vendor, type, category and
description are searched alongside Arabic/English driver names and codes.
Document-only matches keep their displayed driver; unassigned rows remain
searchable.

Summary reads are independent of page/search and collect only IDs, monetary
fields, currency and approval state through the shared checked reader. Exact
decimal sums replace binary floating-point accumulation. They reject incomplete
or failed reads, changing counts, duplicate IDs, invalid values and mixed
currencies. The shared reader now also rejects malformed counts and non-array
responses. Missing totals stay unknown rather than becoming zero. The VAT KPI
is labelled recorded VAT, without implying recoverability or an approved tax
return.

The summary has the existing explicit 100,000-row resource ceiling. It fails
instead of showing a partial total above that budget. This live overview is not
a transactionally frozen accounting report; capacity and financial reporting
acceptance remain separate. No schema, permission, posting, approval or existing
business record is changed by these read improvements.

Mapping reads have exact-count checks and fetch only their actual account
codes. HTTP/malformed/truncated dependency reads now produce a retryable error.
Create/approve refresh the current table query, complete summary and dependency
reads. A failed table/summary/dependency never appears as a successful empty
module.

Local verification: 925 unit tests passed, lint zero errors / 86 existing
warnings, explicit TypeScript and production build passed. New tests cover the
actual SDK query contract, literal OR search, two-page decimal sums, rejected
currencies/values, mapping failures/truncation and mapped account lookup.
The browser harness adds 106 synthetic expenses and verifies records beyond the
old cap, exact KPIs, pagination, document/driver/unassigned search, independent
failure/retry paths, create refresh and Arabic mobile. Current-commit CI/hosted
results are recorded in PR 76 after execution.

The [pending-expense retry continuation](expense-create-retries-2026-10-19.md)
replaces separate creation/audit writes with a durable authorized transaction.
It is applied to staging; exact-head CI/hosted verification and the separate
approval-action audit/uncertain-response handling remain release conditions.
Company tax setup and finance-owner acceptance also remain required.
