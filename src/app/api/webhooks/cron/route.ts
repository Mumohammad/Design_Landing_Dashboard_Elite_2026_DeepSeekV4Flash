// Cron endpoint for processing pending webhook retries.
//
// This endpoint should be called periodically (e.g., every 5 minutes)
// by Vercel Cron, or any scheduled task runner.
//
// Vercel Cron configuration (vercel.json):
//   { "crons": [{ "path": "/api/webhooks/cron", "schedule": "*/5 * * * *" }] }
//
// Security: Only accepts requests with the CRON_SECRET header.
// FAILS CLOSED: Returns 503 if CRON_SECRET is not configured.

import { NextResponse } from "next/server"
import { processRetries } from "@/lib/webhooks/dispatcher"
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

  log.info("Starting webhook retry processing")

  try {
    const result = await processRetries()
    log.info(result, "Webhook retry processing complete")
    return NextResponse.json(result)
  } catch (err) {
    log.error({ err }, "Webhook retry processing failed")
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
