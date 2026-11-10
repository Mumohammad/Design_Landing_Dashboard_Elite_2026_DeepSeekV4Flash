// Scheduled ZATCA backstop (vercel.json cron). Documents are submitted when
// they are finalized; this run retries anything still pending (gateway
// outage, finalizer without accounting:approve) for every tenant with a
// registered ZATCA operator, inside the 24-hour B2C reporting window.
//
// Security: CRON_SECRET bearer only. FAILS CLOSED (503) when the secret or the
// ZATCA gateway is not configured.

import { NextResponse } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { integrationAvailable, INTEGRATION_UNAVAILABLE } from "@/lib/release/integrations"
import { createAdminClient } from "@/lib/supabase/admin"
import { runZatcaForTenant } from "@/lib/accounting/zatca-adapter-core"
import { moduleLogger } from "@/lib/logger"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const log = moduleLogger("api/cron/zatca")
const MAX_TENANTS = 200

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
  if (!integrationAvailable("zatca")) return NextResponse.json({ error: INTEGRATION_UNAVAILABLE }, { status: 503 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("zatca_automation")
    .select("tenant_id")
    .eq("enabled", true)
    .order("tenant_id", { ascending: true })
    .limit(MAX_TENANTS)
  if (error) return NextResponse.json({ error: "Unable to load ZATCA tenants" }, { status: 500 })

  let processed = 0, failed = 0, tenantsFailed = 0
  for (const row of data ?? []) {
    try {
      const r = await runZatcaForTenant(row.tenant_id as string)
      processed += r.processed ?? 0
      failed += r.failed ?? 0
      if (!r.success) tenantsFailed++
    } catch {
      tenantsFailed++
    }
  }
  const summary = { tenants: data?.length ?? 0, processed, failed, tenantsFailed }
  log.info(summary, "ZATCA scheduled run")
  return NextResponse.json(summary)
}
