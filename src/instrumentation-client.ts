// Sentry browser configuration (Next.js instrumentation-client hook; the
// legacy sentry.client.config.ts is not loaded by @sentry/nextjs v10 / Next 16).
// Privacy (PDPL): no default PII, replays only on error with all text masked
// and media blocked. Inert until NEXT_PUBLIC_SENTRY_DSN is configured.
// See: https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs"
import { scrubSentryTelemetry, scrubTelemetrySpan } from "@/lib/telemetry-privacy"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  integrations: [Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true })],

  // ── Sampling ───────────────────────────────────────────────
  // 10% of transactions in production, 100% in dev
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // ── Session Replay ─────────────────────────────────────────
  // Never record normal sessions; record (masked) only around errors.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  // ── Environment ────────────────────────────────────────────
  environment: process.env.NODE_ENV,

  // ── Enable/Disable ─────────────────────────────────────────
  // Only send errors when DSN is configured OR in production
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

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
  beforeSend: scrubSentryTelemetry,
  beforeSendTransaction: scrubSentryTelemetry,
  beforeSendSpan: scrubTelemetrySpan,
  beforeBreadcrumb: scrubSentryTelemetry,
  beforeSendLog: scrubSentryTelemetry,

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

  // ── Deny URLs ──────────────────────────────────────────────
  // Drop errors thrown by browser extensions.
  denyUrls: [/^chrome-extension:\/\//i, /^moz-extension:\/\//i, /^safari-extension:\/\//i],
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
