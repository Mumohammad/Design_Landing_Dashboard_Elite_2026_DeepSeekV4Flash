// Cron endpoint for processing pending webhook retries.
//
// Scheduled in vercel.json ("*/10 * * * *" — clamp-eligible on Hobby) and/or
// via Supabase pg_cron + pg_net (scripts/pg_cron-webhook-retry.sql), which
// hits this same route with the CRON_SECRET bearer. See FX-05.
//
// Security: Only accepts requests with the CRON_SECRET header.
// FAILS CLOSED: Returns 503 if CRON_SECRET is not configured.

import { integrationAvailable, INTEGRATION_UNAVAILABLE } from "@/lib/release/integrations"
import { NextResponse } from "next/server"
import { processRetries } from "@/lib/webhooks/dispatcher"
import { cleanOldDeliveries } from "@/lib/webhooks/store"
import { moduleLogger } from "@/lib/logger"

const log = moduleLogger("api/webhooks/cron")

/**
 * Timing-safe string comparison to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

export async function GET(req: Request): Promise<NextResponse> {
  // Verify cron secret — FAIL CLOSED if not configured
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    log.error("CRON_SECRET is not configured — rejecting request")
    return NextResponse.json(
      { error: "Service unavailable" },
      { status: 503 }
    )
  }

  const authHeader = req.headers.get("authorization")

  if (!authHeader || !safeCompare(authHeader, `Bearer ${cronSecret}`)) {
    log.warn("Cron request rejected: invalid authorization")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!integrationAvailable("webhooks")) {
    return NextResponse.json({ error: INTEGRATION_UNAVAILABLE }, { status: 503 })
  }
  log.info("Starting webhook retry processing")

  try {
    const result = await processRetries()

    // Bounded retention: purge delivery records older than 30 days in the
    // same cron run (audit FX-05 — webhook_deliveries previously grew
    // unbounded; cleanOldDeliveries existed but was never called).
    const deleted = await cleanOldDeliveries(30)

    log.info({ ...result, deletedDeliveries: deleted }, "Webhook cron run complete")
    return NextResponse.json({ ...result, deletedDeliveries: deleted })
  } catch (err) {
    log.error({ err }, "Webhook retry processing failed")
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
