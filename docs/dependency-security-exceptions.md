# Dependency security exceptions

## GHSA-vfj7-8cjw-p6xm (`braces`) — temporary development-only exception

- Reviewed: 2026-10-21
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

## Vite patch — 21 October 2026

CI caught [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm)
against the automatically installed Vite 8.2.1 peer used by Vitest. Vite 8.2.4
contains the upstream patch. The repository now declares that exact development
version, with both Vitest and its mocker resolving the patched peer in the lockfile.
No new advisory exception was added. A selector override alone left the old
automatically installed peer in place; the actual resolved graph and audit were
checked after adding the explicit development dependency.

The complete high-severity audit passes with only the existing `braces` exception;
the production-only audit reports no known vulnerabilities. The [upstream braces
advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) still lists no patched
version at this review. This is not a claim that the development tree has no
remaining risk.
