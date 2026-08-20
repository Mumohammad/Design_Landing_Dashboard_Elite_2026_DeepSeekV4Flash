// Cron endpoint for processing pending webhook retries.
//
// This endpoint should be called periodically (e.g., every 5 minutes)
// by Vercel Cron, or any scheduled task runner.
//
// Vercel Cron configuration (vercel.json):
//   { "crons": [{ "path": "/api/webhooks/cron", "schedule": "*/5 * * * *" }] }
//
// Security: Only accepts requests with the CRON_SECRET header.

import { NextResponse } from "next/server"
import { processRetries } from "@/lib/webhooks/dispatcher"
import { moduleLogger } from "@/lib/logger"

const log = moduleLogger("api/webhooks/cron")

export async function GET(req: Request): Promise<NextResponse> {
  // Verify cron secret.
  const authHeader = req.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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
