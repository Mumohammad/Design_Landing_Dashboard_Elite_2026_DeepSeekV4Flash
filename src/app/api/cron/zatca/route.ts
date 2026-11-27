// Scheduled ZATCA backstop (vercel.json cron). Documents are submitted when
// they are finalized; this run retries anything still pending (gateway
// outage, finalizer without accounting:approve) for every tenant with a
// registered ZATCA operator. Tenants and their event scans resume across runs.
//
// Security: CRON_SECRET bearer only. FAILS CLOSED (503) when the secret or the
// ZATCA gateway is not configured.

import { NextResponse } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { integrationAvailable, INTEGRATION_UNAVAILABLE } from "@/lib/release/integrations"
import { createAdminClient } from "@/lib/supabase/admin"
import { runZatcaForTenant, type ScheduledZatcaScan, type ZatcaAdapterSummary } from "@/lib/accounting/zatca-adapter-core"
import { moduleLogger } from "@/lib/logger"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const log = moduleLogger("api/cron/zatca")
const MAX_TENANTS = 200
const WORKERS = 4
// Allow the last admitted event to finish gateway I/O and retain evidence
// before the platform's hard execution deadline.
const ADMISSION_BUDGET_MS = 225_000
const TURN_ADMISSION_MS = 20_000

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
  const stopAt = Date.now() + ADMISSION_BUDGET_MS
  let claimSlots = 0
  let schedulerFailed = false
  const summary = { tenants: 0, processed: 0, failed: 0, tenantsFailed: 0 }

  async function runWorker() {
    while (!schedulerFailed && claimSlots < MAX_TENANTS && Date.now() < stopAt) {
      claimSlots++
      try {
        const { data, error } = await admin.rpc("claim_zatca_scheduled_tenant")
        if (error) { schedulerFailed = true; return }
        if (data == null) return
        const claim: { tenant_id: string; token: string; scan: ScheduledZatcaScan | null } = data
        if (typeof claim.tenant_id !== "string" || typeof claim.token !== "string") {
          schedulerFailed = true
          return
        }

        summary.tenants++
        let progress: ZatcaAdapterSummary["scheduledProgress"]
        try {
          const result = await runZatcaForTenant(claim.tenant_id, undefined, {
            scan: claim.scan,
            stopAt: Math.min(stopAt, Date.now() + TURN_ADMISSION_MS),
          })
          summary.processed += result.processed ?? 0
          summary.failed += result.failed ?? 0
          if (!result.success) summary.tenantsFailed++
          progress = result.scheduledProgress
        } catch {
          summary.tenantsFailed++
        }
        const checkpoint = await admin.rpc("finish_zatca_scheduled_tenant", {
          p_tenant: claim.tenant_id, p_token: claim.token, p_progress: progress ?? null,
        })
        if (checkpoint.error || checkpoint.data !== true) schedulerFailed = true
      } catch {
        schedulerFailed = true
      }
    }
  }

  await Promise.all(Array.from({ length: WORKERS }, runWorker))
  if (schedulerFailed) {
    log.error(summary, "ZATCA retry scheduling could not be checkpointed")
    return NextResponse.json({ ...summary, error: "Unable to checkpoint ZATCA retry scheduling" }, { status: 500 })
  }
  log.info(summary, "ZATCA scheduled run")
  return NextResponse.json(summary)
}
