"use server"

// In-app notification center feed. Read through the caller's RLS client, so a
// user only ever sees alerts for rows their role can already read; a module the
// role cannot read (or a missing table) simply contributes no items.

import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/auth/authorization"
import { businessDateKey } from "@/lib/formatting/business-date"
import { CACHE_TTL, cacheGet, cacheKey } from "@/lib/cache"
import {
  buildNotificationFeed,
  NOTIFICATION_HORIZON_DAYS,
  type DriverExpiryRow,
  type NotificationFeed,
  type OverdueReceivableRow,
  type VehicleExpiryRow,
} from "./feed-utils"

export async function getNotificationFeed(): Promise<NotificationFeed> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const currentUser = user ? await getCurrentUser() : null
  const todayIso = businessDateKey(new Date())
  if (!user || !currentUser) return buildNotificationFeed({ todayIso })
  const key = cacheKey("notifications", currentUser.tenantId, user.id, { todayIso })
  return cacheGet(key, () => loadFeed(supabase, currentUser.tenantId, todayIso), CACHE_TTL.dashboard)
}

async function loadFeed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  todayIso: string,
): Promise<NotificationFeed> {
  const horizon = new Date(Date.parse(`${todayIso}T00:00:00Z`) + NOTIFICATION_HORIZON_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10)

  const [drivers, vehicles, receivables, approvals] = await Promise.all([
    safe<DriverExpiryRow[]>(async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id, full_name_ar, full_name_en, iqama_expiry_date, license_expiry_date, passport_expiry_date, contract_end")
        .is("deleted_at", null)
        .not("status", "in", "(terminated,blacklisted)")
        .or(`iqama_expiry_date.lte.${horizon},license_expiry_date.lte.${horizon},passport_expiry_date.lte.${horizon},contract_end.lte.${horizon}`)
        .limit(500)
      return error ? [] : ((data ?? []) as DriverExpiryRow[])
    }, []),
    safe<VehicleExpiryRow[]>(async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, plate_number, insurance_expiry, registration_expiry, operating_card_expiry, rental_contract_end")
        .is("deleted_at", null)
        .or(`insurance_expiry.lte.${horizon},registration_expiry.lte.${horizon},operating_card_expiry.lte.${horizon},rental_contract_end.lte.${horizon}`)
        .limit(500)
      return error ? [] : ((data ?? []) as VehicleExpiryRow[])
    }, []),
    safe<OverdueReceivableRow[]>(async () => {
      const { data, error } = await supabase
        .from("receivables")
        .select("id, invoice_ref, due_date, total_amount, paid_amount")
        .is("deleted_at", null)
        .in("status", ["open", "partially_paid", "overdue"])
        .lt("due_date", todayIso)
        .limit(200)
      return error ? [] : ((data ?? []) as OverdueReceivableRow[])
    }, []),
    safe<number>(async () => {
      const { data, error } = await supabase.rpc("fetch_pending_approvals", {
        p_tenant_id: tenantId,
        p_type: null,
        p_from: null,
        p_to: null,
        p_limit: 200,
      })
      return error || !Array.isArray(data) ? 0 : data.length
    }, 0),
  ])

  return buildNotificationFeed({ todayIso, drivers, vehicles, receivables, pendingApprovals: approvals })
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}
