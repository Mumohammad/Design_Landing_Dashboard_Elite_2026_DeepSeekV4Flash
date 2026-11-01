// Client-side reads of driver_platform_accounts (tenant-scoped by RLS).
import { createClient } from "@/lib/supabase/client"

export interface DriverPlatformAccount {
  id: string
  driver_id: string
  platform_code: string
  platform_driver_id: string
  status: "active" | "suspended" | "inactive"
  is_primary: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export async function fetchDriverPlatformAccounts(driverId: string): Promise<DriverPlatformAccount[]> {
  const { data, error } = await createClient()
    .from("driver_platform_accounts")
    .select("id,driver_id,platform_code,platform_driver_id,status,is_primary,notes,created_at,updated_at")
    .eq("driver_id", driverId)
    .is("deleted_at", null)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
  if (error) throw Error("Platform accounts read failed")
  return (data ?? []) as DriverPlatformAccount[]
}

/** Primary first, then active, then the rest — the card order used everywhere. */
export function sortAccounts(accounts: DriverPlatformAccount[]): DriverPlatformAccount[] {
  const rank = (a: DriverPlatformAccount) => (a.is_primary ? 0 : a.status === "active" ? 1 : 2)
  return accounts.slice().sort((a, b) => rank(a) - rank(b) || a.created_at.localeCompare(b.created_at))
}
