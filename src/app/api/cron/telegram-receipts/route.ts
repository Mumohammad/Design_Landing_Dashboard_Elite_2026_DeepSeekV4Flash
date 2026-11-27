import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { dispatchTelegramConfirmation } from "@/lib/expense-claims/telegram-confirmations"
import { telegramBotId } from "@/lib/expense-claims/telegram"
import { moduleLogger } from "@/lib/logger"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const log = moduleLogger("api/cron/telegram-receipts")
const MAX_ATTEMPTS = 24
const ADMISSION_BUDGET_MS = 225_000

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: "Service unavailable" }, { status: 503 })
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(req.headers.get("authorization") ?? "")
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const botId = telegramBotId()
  if (botId === null) return NextResponse.json({ skipped: "bot-unconfigured" })
  const summary = { sent: 0, retry: 0, uncertain: 0, rejected: 0, suppressed: 0, deferred: 0 }
  const stopAt = Date.now() + ADMISSION_BUDGET_MS
  try {
    const admin = createAdminClient()
    for (let i = 0; i < MAX_ATTEMPTS && Date.now() < stopAt; i++) {
      const outcome = await dispatchTelegramConfirmation(admin, botId, null)
      if (outcome === "empty") break
      summary[outcome]++
      // Avoid starting further requests during a provider flood limit.
      if (outcome === "retry") break
    }
    log.info(summary, "Telegram receipt confirmation run")
    return NextResponse.json(summary)
  } catch {
    log.error(summary, "Unable to process Telegram receipt confirmations")
    return NextResponse.json({ ...summary, error: "Unable to process Telegram receipt confirmations" }, { status: 500 })
  }
}
