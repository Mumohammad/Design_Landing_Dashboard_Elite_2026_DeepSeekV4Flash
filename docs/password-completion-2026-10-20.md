# Password change and completion — 20 October 2026

The old forced-password route led to a security overview with no password form.
Unenrolled privileged users could cycle between that route and MFA enrollment.
A read-only production aggregate found three active accounts with a required
password change. No production account was edited.

The candidate adds `/auth/change-password`, a security-settings entry point and
a shared English/Arabic form for recovery and account changes. A user with an
existing verified factor must complete MFA before replacement. An unenrolled
administrator replaces the required password first, then enrolls MFA. A confirmed
change continues using the existing session and language. Inactive, terminated,
pending and locked app profiles cannot enter the protected change flow.
Visible validation/provider errors follow a live language switch. Confirmation
mismatches have explicit translated feedback and an accessible field association.

The server authenticates the app identity, checks assurance, applies the shared
password policy and fail-closed rate limit, and changes the password using the
user's Supabase session. Optional provider email reauthentication is handled
without weakening the provider policy. Provider diagnostics, passwords, hashes
and verification codes are never added to audit payloads or returned as errors.

Staging migration `20261020152143_auth_password_change_completion` adds future
credential/requirement observation counters. Zero is the migration baseline,
not a claim about past password changes. The Auth trigger observes a real hash
transition, advances the credential counter and records a system audit in that
same transaction. Metadata-only writes do nothing. This trigger never clears a
forced requirement; administrator resets therefore preserve it.

After Auth confirms the authenticated user's update, private completion locks
the app profile and checks the expected credential and requirement generations.
The credential must have been observed under the current requirement. Explicit
`must_change_password=true` updates, including true-to-true, invalidate older
completions. Clearing a forced requirement and its audit commit together;
repeated completion does not add another audit. Anonymous/authenticated callers
cannot execute completion or alter the counters/flag through user-table DML.
Only self-profile/MFA bootstrap remains available before completion; existing
tenant/permission/storage helpers share the required-password business gate.

Auth update and app completion use separate transactions. A response or completion
failure can leave a changed credential with a still-required change. The form
reports uncertainty and offers a same-session access check. If the requirement
remains, the user chooses a different new password. A successful completion whose
response is lost can continue through the access check without another sign-in.
No unverified browser callback or metadata claim clears the requirement.

Local verification passed 1,025 unit tests. Focused native PostgreSQL verified
six concurrent completions, one audit, observation/completion audit rollback,
retry, stale credential/generation denial, a new administrator requirement racing
with completion, and account/private execution boundaries. Actual staging Auth
metadata, user-password and administrator-password API calls also passed with a
synthetic account; its sessions were revoked and Auth account retired. Security
and performance advisor findings are unchanged; privileges and empty search paths
were checked. No production migration or Auth configuration changed.

Earlier business test fixtures now explicitly declare completed passwords so
their permission/tenant tests exercise their intended boundary. New pgTAP tests
cover the forced-password gate and separate self-profile bootstrap. Browser
verification covers recovery completion, lost response before enrollment,
existing-factor step-up before a subsequent change, Arabic mobile and retained
sessions. Application head `93eac01145ae8cad8d4a5cd9c8439a7b81769432` passed all three
CI jobs (run 39451940449), including 2,707 database assertions, actual Auth/Storage,
concurrent completion/reset guards and the complete disposable browser suite.
The exact Vercel preview `elite-dashboard-f6655d9m2-elitesaasc-5643.vercel.app`
passed recovery, required-change response loss, same-session enrollment,
receivable/expense/invoice CRUD and PDF retention, returning verified-factor
challenge and Arabic mobile required password completion, with no runtime errors.
Local build/types/lint passed; PDF assets were 84 MiB. Synthetic app access was
deactivated, sessions revoked and Auth fixtures retired.

Production Auth requirements could not be read: both locally available management
credential profiles returned HTTP 403, and the browser redirected to another
organization. Optional email-nonce reauthentication is implemented, but current-
password provider enforcement has not been verified. Actual email delivery is
also an operational acceptance item; generated synthetic recovery links do not
prove delivery. No production Auth setting or password changed. This is a
verified staging checkpoint, not a production release.
