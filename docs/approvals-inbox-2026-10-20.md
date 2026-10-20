# Approvals inbox paging and privacy — 20 October 2026

The inbox previously returned only its first 50–100 pending items. Its search
control did nothing, KPIs counted the visible page, and failed RPC reads returned
successful empty data. Application names reached the browser in subject metadata
and CSV despite a masking label. The server also fetched up to 200 unrelated
user profiles and their consent records without a verified application-to-user
association.

The candidate replaces that read path with `fetch_pending_approvals_page`:

- Exact filtered source counts and rows share one SQL snapshot. Pages are ordered
  by request time, type and ID, including tied timestamps. Out-of-range pages
  clamp to the current last page after decisions; page size remains bounded.
- Tenant, active account, password completion/MFA and each source's approve
  permission remain bound to the authenticated caller. The unbounded source
  helper is private to the function owner, including denial to the service API.
- Applicant names become initials in SQL before filtering or return. Neither raw
  names, mobile nor identity numbers participate in queue search. The old queue
  signature also uses this projection for older clients. No consent association
  is inferred; full application review remains on its separately authorized route.
- The server uses the session client, validates the complete result, whitelists
  response fields and masks applicant data again before serialization. It no
  longer reads the user roster or consent records with service privileges.
- Literal search covers permitted references and visible details throughout the
  queue; `%` and `_` do not expand into wildcards. Date filters use UTC+3 Saudi
  business-day bounds and reject invalid or reversed ranges.
- Failed reads show unavailable metrics and a translated Retry action; stale rows,
  exports and decisions are cleared. A late response cannot overwrite newer
  filters. Row actions remain visible on touch devices. CSV explicitly exports
  the current page, retains masking and neutralizes spreadsheet formulas.

Staging migration `20261020160955_approvals_private_paging` changes read-function
definitions only. It does not update production, business records, source-table
permissions, consent or historical decisions. Private execution and empty search
paths were verified. Performance advisor findings are unchanged. The security
advisor lists the new authenticated SECURITY DEFINER endpoint (27 → 28); its
caller/tenant/account/permission gates are intentional and tested. This is not
reported as an unchanged security-advisor result. See the [Supabase advisor
rule](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Local verification passed 1,045 unit tests, including failed/malformed read
responses, no roster access, masking/serialization, literal filters, result counts,
date bounds and CSV safety. Focused native PostgreSQL verified 106 rows over
three pages, complete unique traversal, stable ties, exact counts, Unicode masking,
hidden-name denial, literal search, page bounds and private execution. Its helper
scaffold is not a substitute for genuine RLS integration. The new 39-case pgTAP
suite tests the actual schema and source/account/permission boundaries in CI.

The browser verifier creates 105 expenses, one application and one leave request
in a fresh isolated workspace; it checks three-page traversal, totals, hidden-field
search, masked server-action/UI/CSV output, injected read failure/retry, late
responses and Arabic mobile. Final CI, hosted deployment and visual results are
recorded on PR 76 after execution. No production release is claimed here.

Leave/application transition audit atomicity and pending-expense edit/archive
remain separate open issues. This change does not certify those write workflows,
ZATCA, bank/WPS exports, provider integrations or the overall production release.
