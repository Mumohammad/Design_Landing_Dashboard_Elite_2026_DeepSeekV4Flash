// Scheduled management notification digest (vercel.json cron, 04:00 UTC =
// 07:00 Asia/Riyadh). Each tenant is emailed at most once per business day
// (notification_digest_log unique key), so retries are safe.
//
// Security: CRON_SECRET bearer only. FAILS CLOSED (503) without the secret.

import { NextResponse } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { runScheduledDigests } from "@/lib/notifications/digest"
import { moduleLogger } from "@/lib/logger"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const log = moduleLogger("api/cron/notifications")

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`)
  const got = Buffer.from(header ?? "")
  return got.length === expected.length && timingSafeEqual(got, expected)
}

export async function GET(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: "Service unavailable" }, { status: 503 })
  if (!authorized(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const summary = await runScheduledDigests()
    log.info(summary, "notification digest run")
    return NextResponse.json(summary)
  } catch (err) {
    log.error({ err }, "notification digest run failed")
    return NextResponse.json({ error: "Digest run failed" }, { status: 500 })
  }
}
