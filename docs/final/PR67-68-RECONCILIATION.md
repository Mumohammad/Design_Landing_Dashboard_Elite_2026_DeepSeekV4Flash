# PRs 67 and 68: forward reconciliation

Repository: Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash.

Reviewed source heads:

- PR 67: `b66bec1d4f4a3474e5d374de479ecb54c2c01316`
- PR 68: `5a1162651c7e184f0905c2c84b83fef3cb9cb7ec`
- Released baseline for this completion branch: `6b21b383993022690c6c13c96994243e41e9b6a3`

Both older PRs overlap later production fixes. Reconcile their useful changes forward on the current baseline; merging either stale tree wholesale would restore superseded financial, routing and integration behavior.

| Concern | Current resolution | Evidence required for closure |
| --- | --- | --- |
| Decimal amounts, payment allocation/reversal, atomic invoice lifecycle | Retain the current exact-decimal helpers and later guarded financial transactions. Older draft-save and cancellation implementations are superseded by the released invoice RPCs. | Full financial SQL and unit suites, hosted invoice/payment lifecycle acceptance. |
| Company provisioning | Retain `provision_company_atomic`; do not restore the older sequence of independent admin writes. | Provisioning/auth tests and fresh synthetic tenant acceptance. |
| Landing/dashboard repeated login and locale | Retain the direct localized sign-in CTA, verified-session proxy and current legacy-route redirects. | English/Arabic landing → sign-in → MFA → dashboard → sign-out/returning-user flows. |
| Password-reset and registration callback origins | Ported validated absolute email-origin resolution into `src/lib/redirects.ts`, with configured-origin checks before external Auth actions. | Origin and auth-route tests; correct staging and production callback configuration. |
| Native preview isolation | `scripts/preview-safety.mjs` executes before Next compilation. Hosted previews must use the approved staging backend, isolated app origin and no cross-host/external-ZATCA configuration. CSP connections are limited to the configured Supabase origin. | Preview-safety/CSP tests and exact-commit staging health/CSP checks. |
| Eight historical staging migration versions | Retained only in `supabase/history/staging`, with normalized SHA-256 provenance and `active_migrations:false`. They are not active migrations, a history repair, or permission to replay their SQL. | `node scripts/verify-staging-history.mjs`; archive tamper/replay/extra-file regression tests. |
| Server-only ZATCA credentials | Retain constant browser masking and independent production/transport gates. Forward migration `20261021165218_credential_acl_hardening.sql` also revokes legacy PUBLIC/client table and column ACLs. Earlier RLS with no client policy already denied access; this hardening is not evidence of a demonstrated credential leak. | Credential ACL SQL tests, masking/config/transport tests and advisor review. |
| Official ZATCA integration | Neither older PR establishes authority acceptance. Preserve truthful internal-QR disclosure and code gates. Track the independent SDK/SignedInfo findings in `docs/financial/ZATCA-ENV.md`. | Validated application signer, genuine authorized non-production onboarding/submission and immutable acceptance evidence before changing the gate. |

The forward reconciliation is still a release candidate. Close the older PRs as superseded only after the current feature PR has complete local/staging evidence and exact-head CI/review. No branch protection or unresolved launch blocker is waived by this document.
