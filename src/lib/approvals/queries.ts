"use server"

import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/authorization"
import { createClient } from "@/lib/supabase/server"
import {
  APPROVAL_ITEM_TYPES, APPROVALS_PAGE_SIZE_DEFAULT, APPROVALS_PAGE_SIZE_MAX,
  dateRangeBounds, maskRequesterName, type ApprovalFilterState, type ApprovalQueueRow,
} from "./approvals-utils"

export type ApprovalsPageData = {
  rows: ApprovalQueueRow[]
  kpis: { total: number; expenses: number; leaves: number; applications: number; stale: number }
  page: number
  pageSize: number
  totalPages: number
}

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const optionalText = z.string().nullable().optional()
// Whitelist the wire projection; never forward arbitrary RPC properties/PII.
const rowSchema = z.object({
  item_type: z.enum(APPROVAL_ITEM_TYPES), item_id: z.uuid(), subject: z.string(),
  requester: z.string(), requested_at: z.iso.datetime({ offset: true }),
  subject_meta: z.object({
    workflow_version: z.number().int().positive().optional(),
    correction_version: z.number().int().positive().optional(),
    amount: z.union([z.number().finite(), z.string()]).nullable().optional(),
    currency: optionalText, expense_type: optionalText, category: optionalText,
    vendor: optionalText, expense_date: optionalText, driver_id: z.uuid().nullable().optional(),
    leave_type: optionalText, start_date: optionalText, end_date: optionalText,
    days_requested: z.number().nullable().optional(), reason: optionalText,
    full_name: optionalText, mobile_hashed: optionalText, city: optionalText,
    work_type: optionalText, driver_category: optionalText, status: optionalText,
  }),
})
const pageSchema = z.object({
  rows: z.array(rowSchema).max(APPROVALS_PAGE_SIZE_MAX),
  kpis: z.object({ total: count, expenses: count, leaves: count, applications: count, stale: count }),
  page: count.min(1), pageSize: count.min(1).max(APPROVALS_PAGE_SIZE_MAX), totalPages: count.min(1),
})
const filtersSchema = z.object({
  from: z.string().max(10).optional(), to: z.string().max(10).optional(),
  type: z.enum([...APPROVAL_ITEM_TYPES, "all"]).optional(), search: z.string().max(200).optional(),
})

/** Caller/session-bound, exact filtered totals and stable database pages.
 * No service-role roster read or guessed application-to-user consent link. */
export async function fetchApprovalsPage(
  filters: Partial<ApprovalFilterState> = {},
  pageSize = APPROVALS_PAGE_SIZE_DEFAULT,
  page = 1,
): Promise<ApprovalsPageData> {
  try {
    const user = await getCurrentUser()
    if (!user) throw new Error("Unauthenticated")
    const input = filtersSchema.parse(filters)
    const { fromIso, toIso } = dateRangeBounds(input.from ?? "", input.to ?? "")
    if ((input.from && !fromIso) || (input.to && !toIso) || (fromIso && toIso && fromIso > toIso)) {
      throw new Error("Invalid date range")
    }
    const size = Number.isFinite(pageSize)
      ? Math.min(Math.max(1, Math.floor(pageSize)), APPROVALS_PAGE_SIZE_MAX) : APPROVALS_PAGE_SIZE_DEFAULT
    const requestedPage = Number.isFinite(page) ? Math.min(Math.max(1, Math.floor(page)), 2147483647) : 1
    const client = await createClient()
    const { data, error } = await client.rpc("fetch_pending_approvals_page", {
      p_tenant_id: user.tenantId,
      p_type: input.type && input.type !== "all" ? input.type : null,
      p_from: fromIso, p_to: toIso, p_search: input.search?.trim() ?? "",
      p_page: requestedPage, p_page_size: size,
    })
    if (error) throw new Error("Queue unavailable")
    const result = pageSchema.parse(data)
    if (result.kpis.total !== result.kpis.expenses + result.kpis.leaves + result.kpis.applications
      || result.kpis.stale > result.kpis.total || result.pageSize !== size
      || result.totalPages !== Math.max(1, Math.ceil(result.kpis.total / size))
      || result.page !== Math.min(requestedPage, result.totalPages)
      || result.rows.length !== Math.min(size, Math.max(0, result.kpis.total - (result.page - 1) * size))) {
      throw new Error("Incomplete queue")
    }
    return { ...result, rows: result.rows.map(row => row.item_type === "application"
      ? { ...row, id: `${row.item_type}:${row.item_id}`, requester: "", subject_meta: {
        full_name: maskRequesterName("application", "", row.subject_meta.full_name ?? null, false),
        city: row.subject_meta.city, work_type: row.subject_meta.work_type,
        driver_category: row.subject_meta.driver_category, status: row.subject_meta.status, workflow_version: row.subject_meta.workflow_version,
      } }
      : { ...row, id: `${row.item_type}:${row.item_id}` }) }
  } catch {
    // Errors must reach the explicit retry state, never a successful empty queue.
    // Raw database/provider errors can contain personal data and are not logged.
    throw new Error("Could not load the approvals queue")
  }
}
