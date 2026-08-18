"use server"

// Accounting Module — Phase 9: Event Dispatcher.
//
// runEventDispatcher() polls the `financial_events` queue and materialises
// journal entries, VAT ledger rows, receivables and adjustments through the
// service-role-only SQL function `dispatch_pending_events()` (migration
// 042). Each event is dispatched atomically and idempotently:
//
//   processed          → effects written (journal + VAT + AR/AP)
//   skipped_duplicate  → the effect already existed (replay-safe)
//   failed             → the event is marked failed with the error message
//                        and is retried on the next run
//
// The action is permission-gated (accounting:approve) and is called:
//   1. automatically at the end of the producer actions (finalize /
//      approve / note / cancel) so effects land immediately, and
//   2. manually from the Accounting → Events monitor tab.

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { mapFinancialError } from "@/lib/accounting/csv-utils"

export type DispatchSummary = {
  success: boolean
  error?: string
  processed?: number
  skipped?: number
  failed?: number
  lastError?: string | null
}

type DispatchRow = {
  out_processed?: number | string | null
  out_skipped?: number | string | null
  out_failed?: number | string | null
  out_last_error?: string | null
}

const toNum = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export async function runEventDispatcher(): Promise<DispatchSummary> {
  try {
    await requirePermission("accounting", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const { data, error } = await admin.rpc("dispatch_pending_events", {
      p_batch_size: 100,
    })
    if (error) return { success: false, error: mapFinancialError(error.message) }

    const row = (Array.isArray(data) ? data[0] : data) as DispatchRow | null

    revalidatePath("/accounting")
    return {
      success: true,
      processed: toNum(row?.out_processed),
      skipped: toNum(row?.out_skipped),
      failed: toNum(row?.out_failed),
      lastError: row?.out_last_error ?? null,
    }
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Unknown error",
    }
  }
}
