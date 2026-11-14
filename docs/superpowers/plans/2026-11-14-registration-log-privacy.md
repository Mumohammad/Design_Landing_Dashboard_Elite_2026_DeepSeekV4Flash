# Registration diagnostic privacy

Scope: remove raw provider diagnostics from registration, the legacy company endpoint, and company confirmation delivery. Preserve HTTP responses, guards, compensation, and best-effort mail delivery. This does not repair the legacy company's missing database contract or close the wider logging audit.

1. Reproduce leaks with synthetic private markers in error messages and nested request/provider fields. Cover confirmation-link rejection, unexpected registration failure, the four company failure stages, rejected email bodies, delivery exceptions, and stream cancellation failure.
2. Keep fixed stage messages and only the email provider's numeric HTTP status. Do not read rejected email response bodies; release the stream without logging cancellation failures.
3. Run focused regressions, request an independent scoped review, and run the existing full release validation against a frozen source inventory.
4. Publish only through the existing exact-commit Preview and CI workflow. Keep Production blocked while hosted acceptance, database recovery/migration rehearsal, and other recorded launch gates remain unresolved.

Evidence: `supabase/.temp/registration-log-privacy-red-20261114.json` reproduced eight leaks (27 tests, 19 passed). The same focused suite passed all 27 tests after the bounded change. All provider operations in these unit tests are mocked; no real email, user, or business record is created.
