# Preview CI Trusted Source — approved and verified

The owner approved this Preview-only GitHub Actions External Service entry on 9 November 2026. It was applied to elite-dashboard only after an authenticated read confirmed no existing Trusted Sources configuration, then checked by a second authenticated read. The companion [JSON record](./vercel-trusted-sources-preview.json) includes the exact submitted `apiPayload`, verified against the public Vercel OpenAPI schema. No Production access, project trust override or secret was added.

| Setting or required claim | Exact value |
| --- | --- |
| Issuer URL | `https://token.actions.githubusercontent.com` |
| `aud` | `https://github.com/Mumohammad` |
| `repository` | `Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash` |
| `head_ref` | `codex/production-modules-completion` |
| `base_ref` | `master` |
| `event_name` | `pull_request` |
| Applies to environments | **Preview only** |

All five configured claims must be present and match their exact listed value; there is no wildcard or extra accepted value. Vercel verifies the issuer signature, every configured claim, and the target deployment environment. This rule grants no Production access. [Vercel Trusted Sources](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources#how-claim-matching-works)

GitHub defines `head_ref` as the PR source branch and `base_ref` as its target branch. CI must still preserve its same-repository PR-head guard and verify the immutable Preview commit before fixture work. The requested audience is exactly `https://github.com/Mumohammad`; hosted jobs need job-scoped `id-token: write`. [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)

The intended caller requests a short-lived token on demand and sends it in `x-vercel-trusted-oidc-idp-token` only to the exact verified Preview origin. Tokens stay in memory, with GitHub masking only; the record contains no token or static bypass secret. [Vercel token attachment](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources#attach-the-oidc-token-from-your-code)

A local development token supplied by `vc env run` for the same linked project already has default `development` → `preview` self-access. It needs no additional GitHub External Service rule unless those self-access defaults were customized. [Vercel default access](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources#default-access)

## Approval boundary

The [access-protected-vercel-deployment skill](C:/Users/Zbook/.codex/plugins/cache/openai-curated-remote/vercel/0.54.1/skills/access-protected-vercel-deployment/SKILL.md) explicitly requires:

> Treat this as an access-control change: explain the exact rule required and obtain authorization before changing it. Do not broaden unrelated environment pairs.

That requirement was satisfied before the change: the owner approved the concrete Preview-only request in this chat. The approval did not broaden the rule to Production or authorize unrelated secret/permission changes.

After the rule was applied, the hosted E2E retry passed the previous protection-denial boundary and failed at the exact-commit readiness check. The existing staging Preview is still an older commit. This rule does not create a deployment, repair database drift or certify hosted acceptance.


## Public staging address (10 November follow-up)

The immutable Preview URL contains no credential. The release jobs prefer the repository variable `STAGING_APP_URL` and retain `STAGING_URL` as a backward-compatible secret fallback. Credentials and API keys remain encrypted secrets. Configure only an immutable, protected Preview in the approved elite-dashboard project, then run the unchanged exact-head health/CSP checks before sign-in or fixtures. A stale commit, Production backend, arbitrary origin or denied Preview identity still fails closed; this setting does not grant access or alter Deployment Protection.

The public variable was saved and read back for the verified `d341394` staging Preview. It must follow the exact tested head on subsequent Preview builds. Editing the legacy encrypted URL secret required GitHub account confirmation; no authentication credential was changed or retrieved.
