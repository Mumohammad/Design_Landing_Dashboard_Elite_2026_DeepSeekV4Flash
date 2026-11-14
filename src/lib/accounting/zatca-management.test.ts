import { describe, expect, it, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({
  enabled: true,
  tables: {} as Record<string, { data: unknown }>,
  requirePermission: vi.fn(async () => undefined),
  user: vi.fn(), caller: vi.fn(), rpc: vi.fn(), rate: vi.fn(), gatewayError: false, from: vi.fn(),
}))

vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: m.requirePermission,
  getCurrentUser: m.user,
}))
vi.mock("@/lib/release/integrations", () => ({ integrationAvailable: () => m.enabled }))
vi.mock("./zatca-config", () => ({ zatcaConfiguredEnvironment: () => (m.enabled ? "sandbox" : null), zatcaProductionAvailable: () => false, ZATCA_PRODUCTION_BLOCKED: "production-blocked", ZATCA_ENVIRONMENT_UNAVAILABLE: "ZATCA environment could not be verified. Reload before continuing.", getZatcaNetworkBase: () => { if (m.gatewayError) throw Error("private gateway detail"); return m.enabled ? "https://fixture.invalid" : null } }))
vi.mock("@/lib/supabase/server", () => ({ createClient: m.caller }))
vi.mock("@/lib/auth/rate-limit", () => ({ rateLimitAccounting: m.rate }))
vi.mock("@/lib/auth/sessions", () => ({ writeAuditLog: vi.fn(async () => undefined) }))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      m.from(table)
      const res = m.tables[table] ?? { data: [] }
      const q: Record<string, unknown> = {}
      for (const k of ["select", "eq", "in", "order", "limit"]) q[k] = () => q
      q.maybeSingle = async () => res
      q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(res).then(ok, ko)
      return q
    },
  }),
}))
import { getZatcaStatus, setZatcaProductionMode } from "./zatca-management"

const tenant = {
  name_ar: "شركة", name_en: "Co", legal_name: "Co LLC", vat_number: "399999999900003", cr_number: "1010010000",
  address: "King Fahd Rd", city: "Riyadh", region: "Riyadh", district: "Olaya", building_number: "1234",
  additional_number: "5678", postal_code: "12345", country: "SA",
}
const old = new Date(Date.now() - 30 * 3600_000).toISOString()
const recent = new Date(Date.now() - 2 * 3600_000).toISOString()

describe("getZatcaStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.enabled = true; m.gatewayError = false
    m.requirePermission.mockResolvedValue(undefined)
    m.user.mockResolvedValue({id:"profile",tenantId:"t1",authUserId:"u1"})
    m.rate.mockResolvedValue({success:true})
    m.caller.mockResolvedValue({rpc:m.rpc})
    m.rpc.mockResolvedValue({data:{production_enabled:false,changed_at:null,configuration_version:7,can_manage:true},error:null})
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
  it("retains a stored ON flag but never labels it connected or routes it to a test gateway", async () => {
    m.rpc.mockResolvedValue({data:{production_enabled:true,changed_at:old,configuration_version:8,can_manage:true},error:null})
    const result=await getZatcaStatus()
    expect(result.status).toMatchObject({productionEnabled:true,enabled:false,environment:null,mode:"local",productionAvailable:false,configurationVersion:8})
  })
  it("reports invalid gateway configuration without leaking its value",async()=>{
    m.gatewayError=true
    const result=await getZatcaStatus()
    expect(result.status).toMatchObject({enabled:false,configurationError:"ZATCA gateway configuration is unavailable. Production remains blocked."})
    expect(JSON.stringify(result)).not.toContain("private gateway")
  })
  it.each([null,{production_enabled:"false",changed_at:null,configuration_version:7,can_manage:true},{production_enabled:false,changed_at:null,configuration_version:0,can_manage:true},{production_enabled:false,changed_at:"not-a-time",configuration_version:7,can_manage:true}])("does not present unverified environment metadata as OFF",async data=>{
    m.rpc.mockResolvedValue({data,error:null})
    expect(await getZatcaStatus()).toEqual({success:false,error:"ZATCA environment could not be verified. Reload before continuing."})
  })
})

const requestId="33333333-2222-4333-8444-555555555555"
describe("guarded ZATCA preference recovery",()=>{
 beforeEach(()=>{
  vi.clearAllMocks();m.requirePermission.mockResolvedValue(undefined)
  m.user.mockResolvedValue({id:"profile",tenantId:"t1",authUserId:"u1"})
  m.rate.mockResolvedValue({success:true});m.caller.mockResolvedValue({rpc:m.rpc})
  m.rpc.mockResolvedValue({data:{request_id:requestId,production_enabled:false,configuration_version:8,replayed:false},error:null})
 })
 it("commits only a caller-bound versioned OFF intent and validates its receipt",async()=>{
  expect(await setZatcaProductionMode(false,7,requestId)).toEqual({success:true,configurationVersion:8,productionEnabled:false,requestId,replayed:false})
  expect(m.requirePermission).toHaveBeenCalledWith("accounting","approve")
  expect(m.rate).toHaveBeenCalledWith("profile")
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith("save_my_zatca_environment",{p_request_id:requestId,p_expected_version:7,p_enabled:false,p_acknowledgement:null})
  expect(m.from).not.toHaveBeenCalled()
 })
 it("cannot open production even with an administrator acknowledgement",async()=>{
  expect(await setZatcaProductionMode(true,7,requestId,"ack")).toMatchObject({success:false,code:"ZATCA_PRODUCTION_BLOCKED"})
  expect(m.caller).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled()
 })
 it.each([0,NaN,Number.MAX_SAFE_INTEGER])("refuses unusable reviewed versions before requesting a save",async version=>{
  expect(await setZatcaProductionMode(false,version,requestId)).toMatchObject({success:false,code:"ZATCA_SWITCH_INVALID"})
  expect(m.caller).not.toHaveBeenCalled()
 })
 it("rejects altered request identities and acknowledgement data",async()=>{
  expect(await setZatcaProductionMode(false,7,"bad")).toMatchObject({code:"ZATCA_SWITCH_INVALID"})
  expect(await setZatcaProductionMode(false,7,requestId,"")).toMatchObject({code:"ZATCA_SWITCH_INVALID"})
  expect(m.rpc).not.toHaveBeenCalled()
 })
 it.each(["permission","user","rate"])("fails before mutation when %s is unavailable",async guard=>{
  if(guard==="permission")m.requirePermission.mockRejectedValue(Object.assign(Error("private"),{code:"AUTH007"}))
  if(guard==="user")m.user.mockResolvedValue(null)
  if(guard==="rate")m.rate.mockResolvedValue({success:false})
  expect((await setZatcaProductionMode(false,7,requestId)).success).toBe(false)
  expect(m.caller).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled()
 })
 it.each([null,{request_id:requestId,production_enabled:true,configuration_version:8,replayed:false},{request_id:requestId,production_enabled:false,configuration_version:7,replayed:false},{request_id:requestId,production_enabled:false,configuration_version:8},{request_id:"another",production_enabled:false,configuration_version:8,replayed:false}])("does not confirm missing, mismatching or nonadvancing receipts",async data=>{
  m.rpc.mockResolvedValue({data,error:null})
  expect(await setZatcaProductionMode(false,7,requestId)).toMatchObject({success:false,code:"ZATCA_SWITCH_UNAVAILABLE"})
  expect(m.rpc).toHaveBeenCalledTimes(1)
 })
 it("preserves same-intent historical receipts without replaying a write",async()=>{
  m.rpc.mockResolvedValue({data:{request_id:requestId,production_enabled:false,configuration_version:8,replayed:true},error:null})
  expect(await setZatcaProductionMode(false,7,requestId)).toMatchObject({success:true,replayed:true,configurationVersion:8})
  expect(m.rpc).toHaveBeenCalledTimes(1)
 })
 it("classifies stale and unknown outcomes without logging private errors or automatically retrying",async()=>{
  m.rpc.mockResolvedValueOnce({data:null,error:{message:"ZATCA_SWITCH_STALE"}}).mockRejectedValueOnce(Error("private connection details"))
  expect(await setZatcaProductionMode(false,7,requestId)).toMatchObject({success:false,code:"ZATCA_SWITCH_STALE"})
  const unknown=await setZatcaProductionMode(false,7,requestId)
  expect(unknown).toMatchObject({success:false,code:"ZATCA_SWITCH_UNAVAILABLE"})
  if(unknown.success) throw Error("Unexpected confirmed result")
  expect(unknown.error).not.toContain("private");expect(m.rpc).toHaveBeenCalledTimes(2)
 })
})
