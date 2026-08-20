// Sentry client-side configuration.
// This file initializes Sentry in the browser.
// See: https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN,

  // Adjust this value in production, or use tracesSampleRate for a lower sampling rate
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Capture replay sessions on errors (100% on error, 10% on regular sessions)
  replaysSessionSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
  replaysOnErrorSampleRate: 1.0,

  // Don't set environment if not configured — Sentry auto-detects
  environment: process.env.NODE_ENV,

  // Only send errors in production
  enabled: process.env.NODE_ENV === "production" || !!process.env.SENTRY_DSN,

  // Ignore common non-actionable errors
  ignoreErrors: [
    "ResizeObserver loop",
    "Network request failed",
    "AbortError",
    "ChunkLoadError",
    "Loading chunk",
    "hydrat",
  ],
})
