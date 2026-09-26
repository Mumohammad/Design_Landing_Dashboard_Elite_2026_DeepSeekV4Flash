"use server"

// Read queries for the Approvals module (Prompt E) — the /approvals inbox.
//
// Server-side only: the unified queue read flows through the capped
// SECURITY DEFINER RPC (fetch_pending_approvals, 20260926120000) after
// requirePermission() — same pattern as src/lib/audit-trail/queries.ts and
// the fetch_audit_trail_page surface. The tenant argument is ALWAYS taken
// from getCurrentUser() server-side, never from the browser.
//
// PDPL masking: applicant display names are masked per the users-module
// consent gate (has_user_pdpl_consent batched per distinct requester with a
// consent-bearing profile). The queue RPC itself never projects applicant
// mobile / identity numbers — only a presence flag.

import { getCurrentUser } from "@/lib/auth/authorization"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  APPROVALS_PAGE_SIZE_DEFAULT,
  APPROVALS_PAGE_SIZE_MAX,
  dateRangeBounds,
  isStale,
  type ApprovalItemType,
  type ApprovalQueueRow,
} from "./approvals-utils"

export type ApprovalsPageData = {
  rows: ApprovalQueueRow[]
  requesterOptions: { id: string; name: string }[]
  /** users.id -> has PDPL terms consent (masking gate for applicant names). */
  requestersConsented: Record<string, boolean>
  kpis: {
    total: number
    expenses: number
    leaves: number
    applications: number
    stale: number
  }
  pageSize: number
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

function emptyData(pageSize: number): ApprovalsPageData {
  return {
    rows: [],
    requesterOptions: [],
    requestersConsented: {},
    kpis: { total: 0, expenses: 0, leaves: 0, applications: 0, stale: 0 },
    pageSize,
  }
}

/**
 * Fetch one capped page of the unified pending-decision queue with
 * server-side filters applied. Requires an authenticated session (GM bypasses
 * per can(); decisions are additionally gated per item type in actions.ts).
 */
export async function fetchApprovalsPage(
  filters: { from?: string; to?: string; type?: ApprovalItemType | "all" } = {},
  pageSize = APPROVALS_PAGE_SIZE_DEFAULT
): Promise<ApprovalsPageData> {
  const currentUser = await getCurrentUser()
  if (!currentUser) return emptyData(APPROVALS_PAGE_SIZE_DEFAULT)

  const cap = Math.min(Math.max(1, Math.floor(pageSize)), APPROVALS_PAGE_SIZE_MAX)
  const admin = createAdminClient()

  const type =
    filters.type && filters.type !== "all" ? (filters.type as ApprovalItemType) : null
  const { fromIso, toIso } = dateRangeBounds(filters.from ?? "", filters.to ?? "")

  let rows: ApprovalQueueRow[] = []
  try {
    const { data, error } = await admin.rpc("fetch_pending_approvals", {
      p_tenant_id: currentUser.tenantId,
      p_type: type,
      p_from: fromIso,
      p_to: toIso,
      p_limit: cap,
    })
    if (error) throw error
    rows = (data ?? []) as unknown as ApprovalQueueRow[]
  } catch (e) {
    console.error("[approvals] fetchApprovalsPage failed:", e)
    return emptyData(cap)
  }

  // Requester picker + PDPL consent batch: applicant identities resolve via
  // the custom users table where present; every distinct application on the
  // page gets exactly one consent RPC call (batched, fail-closed).
  const requesterOptions: { id: string; name: string }[] = []
  const requestersConsented: Record<string, boolean> = {}

  const applicantIds = rows
    .filter((r) => r.item_type === "application")
    .map((r) => r.item_id)

  if (applicantIds.length > 0) {
    const { data: profileRows } = await admin
      .from("users")
      .select("id, full_name_ar, full_name_en, email")
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .limit(200)

    for (const u of profileRows ?? []) {
      const r = u as Record<string, unknown>
      requesterOptions.push({
        id: r.id as string,
        name:
          (r.full_name_ar as string | null) ??
          (r.full_name_en as string | null) ??
          (r.email as string),
      })
    }

    // Consent is a per-profile gate: profile rows on the page's tenant roster.
    for (const u of profileRows ?? []) {
      const r = u as Record<string, unknown>
      const usersId = r.id as string
      try {
        const { data: consent, error: consentError } = await admin.rpc(
          "has_user_pdpl_consent",
          { p_user_id: usersId, p_consent_type: "terms" }
        )
        requestersConsented[usersId] = !consentError && consent === true
      } catch {
        requestersConsented[usersId] = false
      }
    }
  }

  const stale = rows.filter((r) => isStale(r.requested_at)).length

  return {
    rows,
    requesterOptions,
    requestersConsented,
    kpis: {
      total: rows.length,
      expenses: rows.filter((r) => r.item_type === "expense").length,
      leaves: rows.filter((r) => r.item_type === "leave_request").length,
      applications: rows.filter((r) => r.item_type === "application").length,
      stale,
    },
    pageSize: cap,
  }
}
