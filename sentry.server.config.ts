// Sentry server-side configuration.
// This file initializes Sentry in the Node.js runtime (server actions, API routes, middleware).
// See: https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Lower sampling rate in production to manage costs
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  environment: process.env.NODE_ENV,

  // Only send errors in production or when DSN is explicitly set
  enabled: process.env.NODE_ENV === "production" || !!process.env.SENTRY_DSN,

  // Max Breadcrumbs for debugging context
  maxValueLength: 1000,
})
