// Sentry edge runtime configuration.
// This file initializes Sentry in the Edge runtime (middleware/proxy).
// See: https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  environment: process.env.NODE_ENV,

  enabled: process.env.NODE_ENV === "production" || !!process.env.SENTRY_DSN,
})
