# Preview CI Trusted Source proposal

This is a review proposal for one GitHub Actions External Service entry on the Vercel project owning the verified Preview URL. No Vercel setting has been changed by this task. The companion [JSON](./vercel-trusted-sources-preview.json) is a review model, not a verified REST API payload.

| Setting or required claim | Exact value |
| --- | --- |
| Issuer URL | `https://token.actions.githubusercontent.com` |
| `aud` | `https://github.com/Mumohammad` |
| `repository` | `Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash` |
| `head_ref` | `codex/production-modules-completion` |
| `base_ref` | `master` |
| `event_name` | `pull_request` |
| Applies to environments | **Preview only** |

Configure all five claims in the raw-claims form. Each must be present and match its exact listed value; no wildcard or extra accepted value is proposed. Vercel verifies the issuer signature, every configured claim, and the target deployment environment. This rule grants no Production access. [Vercel Trusted Sources](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources#how-claim-matching-works)

GitHub defines `head_ref` as the PR source branch and `base_ref` as its target branch. CI must still preserve its same-repository PR-head guard and verify the immutable Preview commit before fixture work. The requested audience is exactly `https://github.com/Mumohammad`; hosted jobs need job-scoped `id-token: write`. [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)

The intended caller requests a short-lived token on demand and sends it in `x-vercel-trusted-oidc-idp-token` only to the exact verified Preview origin. Tokens stay in memory, with GitHub masking only; the proposal contains no token or static bypass secret. [Vercel token attachment](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources#attach-the-oidc-token-from-your-code)

A local development token supplied by `vc env run` for the same linked project already has default `development` → `preview` self-access. It needs no additional GitHub External Service rule unless those self-access defaults were customized. [Vercel default access](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources#default-access)

## Approval boundary

The [access-protected-vercel-deployment skill](C:/Users/Zbook/.codex/plugins/cache/openai-curated-remote/vercel/0.54.1/skills/access-protected-vercel-deployment/SKILL.md) explicitly requires:

> Treat this as an access-control change: explain the exact rule required and obtain authorization before changing it. Do not broaden unrelated environment pairs.

That requirement applies to adding the proposed External Service entry. Root will request authorization for this concrete Preview-only rule after the code and tests are reviewable. Preparing these files does not authorize or apply the setting.

The current official documentation describes the dashboard raw-claims form. Its REST API payload schema was not verified in this task; use the reviewed values above rather than submitting the JSON file as an API request.
