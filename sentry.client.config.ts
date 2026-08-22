// Sentry client-side configuration.
// This file initializes Sentry in the browser.
// See: https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN,

  // ── Sampling ───────────────────────────────────────────────
  // 10% of transactions in production, 100% in dev
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // ── Session Replay ─────────────────────────────────────────
  // 10% of normal sessions, 100% on error — gives visual context
  replaysSessionSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
  replaysOnErrorSampleRate: 1.0,

  // ── Environment ────────────────────────────────────────────
  environment: process.env.NODE_ENV,

  // ── Enable/Disable ─────────────────────────────────────────
  // Only send errors when DSN is configured OR in production
  enabled: process.env.NODE_ENV === "production" || !!process.env.SENTRY_DSN,

  // ── Release tracking ───────────────────────────────────────
  // Automatically set by @sentry/nextjs, but explicit is better
  release: process.env.NEXT_PUBLIC_COMMIT_SHA ?? undefined,

  // ── Tags ───────────────────────────────────────────────────
  // Applied to every event for easier filtering in Sentry
  initialScope: {
    tags: {
      app: "elitedev",
      market: "saudi_arabia",
    },
  },

  // ── PII scrubbing ──────────────────────────────────────────
  // Never send sensitive data to Sentry
  beforeSend(event) {
    // Scrub any accidental password/token leaks
    if (event.request?.data) {
      const data = event.request.data as Record<string, unknown>
      for (const key of Object.keys(data)) {
        if (/password|token|secret|key|credential/i.test(key)) {
          data[key] = "[Filtered]"
        }
      }
    }

    // Scrub breadcrumbs for sensitive operations
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((crumb) => {
        if (crumb.data && typeof crumb.data === "object") {
          const data = crumb.data as Record<string, unknown>
          for (const key of Object.keys(data)) {
            if (/password|token|secret|key|credential/i.test(key)) {
              data[key] = "[Filtered]"
            }
          }
        }
        return crumb
      })
    }

    return event
  },

  // ── Ignore common non-actionable errors ─────────────────────
  ignoreErrors: [
    // Browser extension noise
    "ResizeObserver loop",
    "ResizeObserver loop completed with undelivered notifications",
    // Network issues (user offline, etc.)
    "Network request failed",
    "NetworkError",
    "Failed to fetch",
    "Load failed",
    // Aborted requests
    "AbortError",
    "The user aborted a request",
    // Code splitting
    "ChunkLoadError",
    "Loading chunk",
    "Loading CSS chunk",
    // Hydration (Next.js SSR)
    "hydrat",
    "Hydration failed",
    // Third-party script errors
    "Script error.",
    "window.__cfRW",
    // Non-errorrejections
    "Non-Error promise rejection",
  ],

  // ── Allow URLs ─────────────────────────────────────────────
  // Only send errors from our domain
  allowUrls: [
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    /app\.elitedev\.com\.sa/,
  ],
})
