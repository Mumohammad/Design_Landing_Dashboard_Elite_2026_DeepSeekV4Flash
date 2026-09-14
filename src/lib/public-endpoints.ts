// FX-10: allowlist of API routes that are intentionally public (no auth guard).
//
// Every src/app/api/**/route.ts must either call a recognized guard
// (see scripts/verify-api-guards.mjs) or appear in PUBLIC_ENDPOINTS below.
// CI fails otherwise — this file is the single source of truth for
// "public by design" endpoints.
//
// Contract for additions:
//   - "/api/health"        — path exactly as routed, with leading slash.
//   - Every entry needs a reason documenting why it is unguarded, and the
//     fail-closed mechanism that makes it safe (secret check, signature, etc.).
//   - Keep this list minimal. When in doubt, add a guard to the route instead.

export const PUBLIC_ENDPOINTS: readonly string[] = [
  // Liveness/readiness probe consumed by uptime checks and CI smoke tests.
  // Returns status only; no tenant or PII data. Read-only by construction.
  "/api/health",

  // Scheduled jobs runner. FAIL-CLOSED: when CRON_SECRET is unset, every
  // request is rejected (401/500) — the route never performs work unauthenticated.
  "/api/webhooks/cron",

  // Load-test entrypoint. FAIL-CLOSED: gated on process.env.LOAD_TEST_SECRET;
  // without the secret configured the route rejects all execution.
  "/api/load-test",
] as const;
