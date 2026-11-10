"use server"

// Tenant "Getting started" progress. Counts only (no row data leaves the
// server); every query is pinned to the caller's own tenant.

import { can, getCurrentUser } from "@/lib/auth/authorization"
import { createAdminClient } from "@/lib/supabase/admin"
import { buildSetupProgress, isCompanyProfileComplete, type SetupProgress } from "./setup-utils"

export async function getSetupProgress(): Promise<SetupProgress | null> {
  const user = await getCurrentUser()
  if (!user) return null
  // Setup is an owner/admin concern: only callers who can edit company
  // settings see the checklist.
  const allowed = await can("settings", "update").then((r) => r.allowed, () => false)
  if (!allowed) return null
  const admin = createAdminClient()
  const tenantId = user.tenantId

  const count = async (table: string, apply?: (q: any) => any): Promise<number> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      let q = admin.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId)
      if (apply) q = apply(q)
      const { count: n, error } = await q
      return error ? 0 : (n ?? 0)
    } catch {
      return 0
    }
  }

  const [tenant, bankAccounts, platforms, drivers, vehicles, users, invoices] = await Promise.all([
    admin.from("tenants").select("name_ar, vat_number, cr_number, logo_url").eq("id", tenantId).maybeSingle()
      .then((r) => (r.error ? null : r.data), () => null),
    count("bank_accounts", (q) => q.eq("is_active", true).is("deleted_at", null)),
    count("delivery_platforms", (q) => q.eq("is_active", true).is("deleted_at", null)),
    count("drivers", (q) => q.is("deleted_at", null)),
    count("vehicles", (q) => q.is("deleted_at", null)),
    count("users", (q) => q.neq("status", "pending_invite")),
    count("invoices"),
  ])

  return buildSetupProgress({
    companyComplete: isCompanyProfileComplete(tenant),
    bankAccounts,
    platforms,
    drivers,
    vehicles,
    users,
    invoices,
  })
}
