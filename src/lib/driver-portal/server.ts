import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { hashPortalToken, isPortalToken } from "./token"

export interface PortalLink { id: string; tenant_id: string; driver_id: string; expires_at: string }
export class PortalReadUnavailableError extends Error {
  constructor() { super("Portal information is temporarily unavailable"); this.name = "PortalReadUnavailableError" }
}
export interface PortalView {
  link: PortalLink
  company: { name_ar: string | null; name_en: string | null }
  driver: { id: string; full_name_ar: string; full_name_en: string | null; driver_code: string | null; status: string; nationality: string | null; iqama_last4: string | null; photo_url: string | null }
  documents: { id: string; doc_type: string; doc_number: string | null; expiry_date: string | null; is_verified: boolean }[]
  platforms: { platform_code: string; platform_driver_id: string; is_primary: boolean }[]
  cards: { card_serial: string; expires_at: string | null }[]
  vehicle: { plate_number: string | null; make: string | null; model: string | null } | null
  submissions: { id: string; doc_type: string; status: string; created_at: string; review_note: string | null }[]
}

/** Resolve a portal token to its active link (service role; never trusts the client). */
export async function resolvePortalLink(token: string): Promise<PortalLink | null> {
  if (!isPortalToken(token)) return null
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.from("driver_portal_links").select("id, tenant_id, driver_id, expires_at, revoked_at")
      .eq("token_hash", hashPortalToken(token)).maybeSingle()
    const expiry = data ? new Date(data.expires_at).getTime() : NaN
    if (error) throw new PortalReadUnavailableError()
    if (!data || data.revoked_at || !Number.isFinite(expiry) || expiry <= Date.now()) return null
    const [tenant, driver] = await Promise.all([
      admin.from("tenants").select("id").eq("id", data.tenant_id).eq("status", "active").is("deleted_at", null).maybeSingle(),
      admin.from("drivers").select("id").eq("id", data.driver_id).eq("tenant_id", data.tenant_id).in("status", ["active", "on_leave"]).is("deleted_at", null).maybeSingle(),
    ])
    if (tenant.error || driver.error) throw new PortalReadUnavailableError()
    if (!tenant.data || !driver.data) return null
    return { id: data.id, tenant_id: data.tenant_id, driver_id: data.driver_id, expires_at: data.expires_at }
  } catch { throw new PortalReadUnavailableError() }
}

export async function loadPortalView(token: string): Promise<PortalView | null> {
  const link = await resolvePortalLink(token)
  if (!link) return null
  const admin = createAdminClient()
  const t = link.tenant_id, id = link.driver_id
  const [tenant, driver, docs, plats, cards, veh, subs] = await Promise.all([
    admin.from("tenants").select("name_ar, name_en").eq("id", t).eq("status", "active").is("deleted_at", null).maybeSingle(),
    admin.from("drivers").select("id, full_name_ar, full_name_en, driver_code, status, nationality, iqama_number, photo_url").eq("id", id).eq("tenant_id", t).in("status", ["active", "on_leave"]).is("deleted_at", null).maybeSingle(),
    admin.from("driver_documents").select("id, doc_type, doc_number, expiry_date, is_verified").eq("driver_id", id).eq("tenant_id", t).eq("is_active", true).is("deleted_at", null).order("doc_type"),
    admin.from("driver_platform_accounts").select("platform_code, platform_driver_id, is_primary").eq("driver_id", id).eq("tenant_id", t).eq("status", "active").is("deleted_at", null),
    admin.from("driver_cards").select("card_serial, expires_at").eq("driver_id", id).eq("tenant_id", t).eq("status", "active").is("deleted_at", null),
    admin.from("vehicle_assignments").select("vehicles(plate_number, make, model)").eq("driver_id", id).eq("tenant_id", t).eq("is_current", true).is("deleted_at", null).limit(1).maybeSingle(),
    admin.from("driver_portal_submissions").select("id, doc_type, status, created_at, review_note").eq("driver_id", id).eq("tenant_id", t).order("created_at", { ascending: false }).limit(10),
  ])
  if ([tenant, driver, docs, plats, cards, veh, subs].some(result => result.error)) throw new PortalReadUnavailableError()
  if (!tenant.data || !driver.data) return null
  void admin.from("driver_portal_links").update({ last_used_at: new Date().toISOString() }).eq("id", link.id).then(() => undefined)
  let photo: string | null = null
  const p = driver.data.photo_url as string | null
  if (p && !/^https?:/.test(p)) photo = (await admin.storage.from("driver-photos").createSignedUrl(p, 900)).data?.signedUrl ?? null
  const iq = (driver.data.iqama_number as string | null) ?? null
  const v = (veh.data as { vehicles?: PortalView["vehicle"] } | null)?.vehicles ?? null
  return {
    link,
    company: { name_ar: tenant.data?.name_ar ?? null, name_en: tenant.data?.name_en ?? null },
    driver: { id, full_name_ar: driver.data.full_name_ar, full_name_en: driver.data.full_name_en, driver_code: driver.data.driver_code, status: driver.data.status, nationality: driver.data.nationality, iqama_last4: iq ? iq.slice(-4) : null, photo_url: photo },
    documents: (docs.data ?? []) as PortalView["documents"],
    platforms: (plats.data ?? []) as PortalView["platforms"],
    cards: (cards.data ?? []) as PortalView["cards"],
    vehicle: v,
    submissions: (subs.data ?? []) as PortalView["submissions"],
  }
}
