# New-password policy — 19 October 2026

Registration already required 10–128 characters with an English letter and a
digit. Invitation acceptance and password reset did not enforce that same
application policy. A shared validator now covers all three flows, with Arabic
and English hints, accessible validation alerts and bounded password fields.
Invitation validation runs before creating accounts or consuming invitations.
Sign-in continues to accept older passwords; strengthening new-password rules
must not lock existing users out. The registration submit/loading labels now
follow the selected language, and its required fields have associated labels.

Local validation: 939 unit tests passed, including policy bounds/composition and
an invitation retry that confirms weak input creates no account and consumes no
invite. Full lint has zero errors and 86 existing warnings. TypeScript and the
production build passed. Exact-commit browser/CI results are recorded on PR 76
after execution.
The browser release harness now checks both languages on mobile, rejection
before network mutations and a real disposable-user recovery/password change.
Hosted verification passed on exact preview head `e4294df`: English/Arabic
mobile hints and validation, zero weak-input mutation requests, localized
registration control, a real recovery session and strong-password update,
successful replacement-password sign-in and rejected old credential. Sessions
were revoked and the synthetic recovery user retired. Scoped alert locators
exclude Next.js's separate route announcer; its initial ambiguous-locator
failure was corrected. The new mobile captures were visually inspected.

## Hosted configuration

The Management API connection works for both projects. Supabase rejected enabling
`password_hibp_enabled` on staging with HTTP 402 because the current plan does
not include leaked-password protection. The user explicitly chose to retain
the current plan. No upgrade, paid resource or HIBP activation was performed.
This is an accepted plan limitation, not a credential-access problem or an
implemented replacement for breached-password screening.

Staging `viowrovartosrkqukjxy` now has a minimum length of 10 and requires a
letter plus a digit. Hosted Auth applies config asynchronously: immediate tests
before the rollout completed failed and were rolled back. After allowing the
rollout to finish, an isolated test passed existing 8-character sign-in, three
weak-password update rejections, strong-password update and subsequent sign-in,
and rejection of the replaced password. All other Auth configuration fields
were compared in memory and remained unchanged. Sessions were revoked and the
synthetic Auth account was retired. No credentials or recovery links were logged.

Production `wwfnsbilmyxeawgzicmv` remains unchanged at this checkpoint (minimum
length 6, no required character groups, HIBP disabled). Apply the tested basic
policy as part of the reviewed release after the updated application and
exact-commit checks pass. It needs no paid plan or password reset. Do not claim
that new application hints alone configure the hosted Auth service.

The existing must-change-password gate also needs a separate end-to-end review:
it redirects to the security overview, and no synchronization of its profile
flag with a completed Auth password change was found in this source review.
This policy change does not claim to complete that account-administration flow.

Sources: [Supabase password security](https://supabase.com/docs/guides/auth/password-security),
[Management API schema](https://api.supabase.com/api/v1-json).
