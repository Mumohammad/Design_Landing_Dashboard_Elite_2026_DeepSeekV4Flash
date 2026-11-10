// Sentry server-side configuration.
// This file initializes Sentry in the Node.js runtime
// (server actions, API routes, middleware).
// See: https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs"
import { scrubSentryTelemetry, scrubTelemetrySpan } from "./src/lib/telemetry-privacy"

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // ── Sampling ───────────────────────────────────────────────
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // ── Environment ────────────────────────────────────────────
  environment: process.env.NODE_ENV,

  // ── Enable/Disable ─────────────────────────────────────────
  enabled: !!process.env.SENTRY_DSN,
  sendDefaultPii: false,

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
  beforeSend: scrubSentryTelemetry,
  beforeSendTransaction: scrubSentryTelemetry,
  beforeSendSpan: scrubTelemetrySpan,
  beforeBreadcrumb: scrubSentryTelemetry,
  beforeSendLog: scrubSentryTelemetry,

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
