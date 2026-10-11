# Dependency security exceptions

## GHSA-vfj7-8cjw-p6xm (`braces`) — temporary development-only exception

- Reviewed: 2026-10-10
- Severity: high
- Dependency path: `eslint-config-next` → `@next/eslint-plugin-next` →
  `fast-glob` → `micromatch` → `braces@3.0.3`
- Upstream status: no patched npm release is available for the affected
  `braces` line at the time of review.
- Runtime exposure: none identified. The package is reached only through the
  repository's ESLint development toolchain and is absent from
  `pnpm audit --prod`.
- Mitigation: lint only trusted repository-controlled file globs in local/CI
  jobs; do not expose the lint process as a network service or pass
  user-controlled glob patterns to it.
- Tracking: `pnpm.auditConfig.ignoreGhsas` contains only this advisory. Remove
  the exception and upgrade as soon as `eslint-config-next`/`fast-glob` ships a
  patched dependency chain.

Verification commands:

```text
pnpm audit --audit-level=high
pnpm audit --prod --audit-level=high
```

The first command exits successfully but reports one explicitly ignored high
advisory. The production-only audit must report no known vulnerabilities.
