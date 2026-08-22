// Sentry server-side configuration.
// This file initializes Sentry in the Node.js runtime
// (server actions, API routes, middleware).
// See: https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // ── Sampling ───────────────────────────────────────────────
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // ── Environment ────────────────────────────────────────────
  environment: process.env.NODE_ENV,

  // ── Enable/Disable ─────────────────────────────────────────
  enabled: process.env.NODE_ENV === "production" || !!process.env.SENTRY_DSN,

  // ── Release tracking ───────────────────────────────────────
  release: process.env.NEXT_PUBLIC_COMMIT_SHA ?? undefined,

  // ── Max breadcrumb / value lengths ─────────────────────────
  maxValueLength: 1000,
  maxBreadcrumbs: 50,

  // ── Tags ───────────────────────────────────────────────────
  initialScope: {
    tags: {
      app: "elitedev",
      runtime: "server",
      market: "saudi_arabia",
    },
  },

  // ── PII scrubbing ──────────────────────────────────────────
  beforeSend(event) {
    // Never send service-role keys or auth tokens
    if (event.extra) {
      for (const key of Object.keys(event.extra)) {
        if (/password|token|secret|key|credential|service_role/i.test(key)) {
          event.extra[key] = "[Filtered]"
        }
      }
    }

    // Scrub request data
    if (event.request?.data) {
      const data = event.request.data as Record<string, unknown>
      for (const key of Object.keys(data)) {
        if (/password|token|secret|key|credential/i.test(key)) {
          data[key] = "[Filtered]"
        }
      }
    }

    // Scrub request headers (never send auth headers)
    if (event.request?.headers) {
      const headers = event.request.headers as Record<string, string>
      for (const key of Object.keys(headers)) {
        if (/authorization|cookie|set-cookie/i.test(key)) {
          headers[key] = "[Filtered]"
        }
      }
    }

    return event
  },

  // ── Ignore common noise ────────────────────────────────────
  ignoreErrors: [
    "ECONNREFUSED",
    "ENOTFOUND",
    "ETIMEDOUT",
    "ECONNRESET",
    "Socket hang up",
    "AbortError",
    "The user aborted a request",
    "Non-Error promise rejection",
    "Window.fetchError",
    // Supabase auth refresh races
    "Auth session missing",
    "Invalid RefreshToken",
    "RefreshTokenNotFound",
  ],
})
