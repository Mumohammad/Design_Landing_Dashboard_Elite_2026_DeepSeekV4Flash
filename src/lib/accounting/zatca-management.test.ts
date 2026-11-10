import { describe, expect, it, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({
  enabled: true,
  tables: {} as Record<string, { data: unknown }>,
  requirePermission: vi.fn(async () => undefined),
}))

vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: m.requirePermission,
  getCurrentUser: async () => ({ tenantId: "t1", authUserId: "u1" }),
}))
vi.mock("@/lib/release/integrations", () => ({ integrationAvailable: () => m.enabled }))
vi.mock("./zatca-config", () => ({ zatcaConfiguredEnvironment: () => (m.enabled ? "sandbox" : null), zatcaProductionAvailable: () => false, ZATCA_PRODUCTION_ACK: "ack" }))
vi.mock("@/lib/auth/sessions", () => ({ writeAuditLog: vi.fn(async () => undefined) }))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const res = m.tables[table] ?? { data: [] }
      const q: Record<string, unknown> = {}
      for (const k of ["select", "eq", "in", "order", "limit"]) q[k] = () => q
      q.maybeSingle = async () => res
      q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(res).then(ok, ko)
      return q
    },
  }),
}))
import { getZatcaStatus } from "./zatca-management"

const tenant = {
  name_ar: "شركة", name_en: "Co", legal_name: "Co LLC", vat_number: "399999999900003", cr_number: "1010010000",
  address: "King Fahd Rd", city: "Riyadh", region: "Riyadh", district: "Olaya", building_number: "1234",
  additional_number: "5678", postal_code: "12345", country: "SA",
}
const old = new Date(Date.now() - 30 * 3600_000).toISOString()
const recent = new Date(Date.now() - 2 * 3600_000).toISOString()

describe("getZatcaStatus", () => {
  beforeEach(() => {
    m.enabled = true
    m.tables = {
      tenants: { data: tenant },
      zatca_issuance_streams: { data: [{ egs_serial: "1-EliteDev|2-Dashboard|3-x", environment: "sandbox", last_counter: 4, created_at: old }] },
      zatca_csids: { data: [{ environment: "sandbox", kind: "production", status: "issued", expires_at: new Date(Date.now() + 10 * 86_400_000).toISOString() }] },
      financial_events: { data: [
        { source_id: "a", event_type: "InvoiceFinalizedEvent", created_at: old, payload: { invoice_number: "INV-1" } },
        { source_id: "b", event_type: "InvoiceFinalizedEvent", created_at: recent, payload: { invoice_number: "INV-2" } },
        { source_id: "c", event_type: "CreditNoteIssuedEvent", created_at: old, payload: {} },
      ] },
      zatca_transmissions: { data: [
        { source_id: "c", doc_type: "credit_note", status: "reported", error_message: null },
        { source_id: "a", doc_type: "invoice", status: "failed", error_message: "NETWORK" },
      ] },
    }
  })

  it("reports profile, stream, certificate expiry and the overdue backlog", async () => {
    const res = await getZatcaStatus()
    expect(m.requirePermission).toHaveBeenCalledWith("accounting", "read")
    expect(res.success).toBe(true)
    const s = res.status!
    expect(s).toMatchObject({ enabled: true, environment: "sandbox", productionEnabled: false, profileMissing: [], vatValid: true })
    expect(["local", "connected"]).toContain(s?.mode)
    expect(s.streams).toEqual([{ egsSerial: "1-EliteDev|2-Dashboard|3-x", environment: "sandbox", lastCounter: 4, createdAt: old }])
    expect(s.certificates[0].daysLeft).toBeGreaterThanOrEqual(9)
    expect(s.backlog.pending).toBe(2)
    expect(s.backlog.overdue).toBe(1)
    expect(s.backlog.items[0]).toMatchObject({ docRef: "INV-1", overdue: true, lastStatus: "failed", lastError: "NETWORK" })
    expect(JSON.stringify(res)).not.toMatch(/secret|private/i)
  })

  it("flags an incomplete tax profile and reports no backlog when disabled", async () => {
    m.enabled = false
    m.tables.tenants = { data: { ...tenant, vat_number: "123", building_number: null } }
    const s = (await getZatcaStatus()).status!
    expect(s.enabled).toBe(false)
    expect(s.environment).toBeNull()
    expect(s.vatValid).toBe(false)
    expect(s.profileMissing.length).toBeGreaterThan(0)
    expect(s.backlog).toEqual({ pending: 0, overdue: 0, items: [] })
  })
})
