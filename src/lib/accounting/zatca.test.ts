// Financial Phase 18 — unit tests for the ZATCA adapter (src/lib/accounting/zatca.ts).
//
// runZatcaAdapter decides whether a run is "sandbox" (mock) or a real
// reporting path. The transport (zatca-transport.ts) performs a REAL POST only
// when a gateway base URL is configured AND credentials resolve (stored tenant
// CSID first, env fallback). The adapter must mirror that decision so the
// audit log / UI flash can never claim "not sandbox" while the transport is
// actually returning the mock — a stored CSID ALONE must not flip the flag
// (regression pinned by this file; fixed 2026-08-17).
//
// The adapter is a "use server" module with I/O boundaries (Supabase admin
// client, auth, audit log, ZATCA seams), so the tests mock those and drive the
// adapter with an EMPTY event queue — the summary sandbox flag + audit values
// are computed before any event processing, which is exactly the contract
// under test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ── Mocks ──────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(async (_module: string, _action: string) => {}),
  getCurrentUser: vi.fn(async (): Promise<{ tenantId: string; authUserId: string } | null> => null),
  writeAuditLog: vi.fn(async (_entry: { action: string; newValues: Record<string, unknown> }) => {}),
  getZatcaCsidCredential: vi.fn(
    async (
      _environment: string,
      _kind: string,
      _tenantId: string
    ): Promise<{ csidBase64: string; secret: string; privateKeyPem: string | null } | null> => null
  ),
  mapFinancialError: vi.fn((_message: string) => _message),
  buildZatcaUblInvoice: vi.fn(() => "<Invoice/>"),
  transmitToZatca: vi.fn(async () => ({
    uuid: "00000000-0000-4000-8000-000000000000",
    status: "reported",
    receivedAt: new Date().toISOString(),
    raw: { sandbox: true },
  })),
  revalidatePath: vi.fn(),
  adminRpc: vi.fn(async (_name: string, _args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => ({ data: true, error: null })),
  adminFrom: vi.fn(() => ({})),
  resolveEnvironment: vi.fn(),
  prepareZatcaDocument: vi.fn(async (_stream: string, _source: string, _input: Record<string, unknown>) => ({
    id: "11111111-1111-4111-8111-111111111111",
    invoice_counter: 7,
    invoice_hash: "HASH",
    unsigned_xml: "<Invoice prepared/>",
  })),
  submitPreparedZatcaDocument: vi.fn(async (_actor: { tenantId: string; authUserId: string }, _id: string, _mode: string): Promise<Record<string, unknown>> => ({
    success: true,
    status: "cleared",
    pipeline: "clearance",
    warnings: [],
    errors: [],
  })),
}))

vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: mocks.requirePermission,
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock("@/lib/auth/sessions", () => ({
  writeAuditLog: mocks.writeAuditLog,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.adminFrom, rpc: mocks.adminRpc }),
}))

vi.mock("@/lib/accounting/csv-utils", () => ({
  mapFinancialError: mocks.mapFinancialError,
}))

vi.mock("./zatca-credentials", () => ({
  getZatcaCsidCredential: mocks.getZatcaCsidCredential,
}))
vi.mock("./zatca-environment", () => ({ resolveTenantZatcaEnvironment: mocks.resolveEnvironment }))

vi.mock("./zatca-ubl", () => ({
  buildZatcaUblInvoice: mocks.buildZatcaUblInvoice,
}))

vi.mock("./zatca-transport", () => ({
  transmitToZatca: mocks.transmitToZatca,
}))

vi.mock("server-only", () => ({}))

// Preserve the preparation mock's document-focused argument list.
vi.mock("./zatca-issuance", () => ({
  prepareZatcaDocumentAs: (_actor: unknown, ...args: unknown[]) => (mocks.prepareZatcaDocument as (...a: unknown[]) => unknown)(...args),
}))

vi.mock("./zatca-submission-core", () => ({
  submitPreparedZatcaDocumentAs: mocks.submitPreparedZatcaDocument,
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

import { runZatcaAdapter, getZatcaTransmission, sendDocumentToZatca, setZatcaAutoSend } from "./zatca"
import { runZatcaForTenant } from "./zatca-adapter-core"
import { getZatcaNetworkBase, zatcaConfiguredEnvironment } from "./zatca-config"

// ── Helpers ────────────────────────────────────────────────────────────────

const CURRENT_USER = { tenantId: "tenant-0001", authUserId: "auth-0001" }
const STORED_CSID = { csidBase64: "CERT", secret: "SECRET", privateKeyPem: "KEY-PEM" }

/**
 * Chainable + thenable mock of the supabase query builder for the adapter's
 * event-queue query: select().eq().in().order().limit() → { data, error } via
 * `then`. The adapter runs with an EMPTY event queue in these tests, so no
 * other table queries are reached.
 */
function mockBuilder() {
  const builder = {
    select: vi.fn((_cols: string) => builder),
    eq: vi.fn((_col: string, _val: unknown) => builder),
    lte: vi.fn(() => builder),
    in: vi.fn((_col: string, _vals: unknown[]) => builder),
    order: vi.fn((_col: string, _opts?: unknown) => builder),
    limit: vi.fn((_n: number) => builder),
    then: (resolve: (v: unknown) => void, _reject: (e: unknown) => void) =>
      resolve({ data: [], error: null }),
  }
  return builder
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.adminRpc.mockResolvedValue({ data: true, error: null })
  mocks.getCurrentUser.mockResolvedValue(CURRENT_USER)
  mocks.adminFrom.mockReturnValue(mockBuilder())
  mocks.resolveEnvironment.mockImplementation(async()=>{
    getZatcaNetworkBase()
    return zatcaConfiguredEnvironment()
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("runZatcaAdapter — sandbox flag mirrors the transport's real-POST condition", () => {
  it("reports sandbox=true when nothing is configured (no CSID, no env)", async () => {
    mocks.getZatcaCsidCredential.mockResolvedValue(null)
    const res = await runZatcaAdapter()
    expect(res.success).toBe(true)
    expect(res.sandbox).toBe(true)
  })

  it("reports sandbox=true when a stored CSID exists but NO gateway base URL (regression: a stored CSID alone must not flip the flag)", async () => {
    mocks.getZatcaCsidCredential.mockResolvedValue(STORED_CSID)
    // No ZATCA_API_BASE_URL configured — the transport would still return the
    // mock even with credentials, so the flag must stay true.
    const res = await runZatcaAdapter()
    expect(res.sandbox).toBe(true)
  })

  it("reports sandbox=false when a stored CSID AND a gateway base URL are both configured", async () => {
    mocks.getZatcaCsidCredential.mockResolvedValue(STORED_CSID)
    vi.stubEnv("ZATCA_MODE", "sandbox")
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal")
    const res = await runZatcaAdapter()
    expect(res.sandbox).toBe(false)
  })

  it("reports sandbox=false for the env-only path (base + CSID cert + secret)", async () => {
    mocks.getZatcaCsidCredential.mockResolvedValue(null)
    vi.stubEnv("ZATCA_MODE", "sandbox")
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal")
    vi.stubEnv("ZATCA_CSID_CERT", "env-cert")
    vi.stubEnv("ZATCA_CSID_SECRET", "env-secret")
    const res = await runZatcaAdapter()
    expect(res.sandbox).toBe(false)
  })

  it("rejects legacy implicit network configuration rather than claiming mock success", async () => {
    mocks.getZatcaCsidCredential.mockResolvedValue(null)
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.example/e-invoicing/developer-portal")
    const res = await runZatcaAdapter()
    expect(res.success).toBe(false)
    expect(res.error).toContain("requires explicit")
  })

  it("writes the same sandbox value to the audit log as the summary reports", async () => {
    mocks.getZatcaCsidCredential.mockResolvedValue(null)
    const res = await runZatcaAdapter()
    const audit = mocks.writeAuditLog.mock.calls[0]?.[0]
    expect(audit?.action).toBe("zatca_adapter_ran")
    expect(audit?.newValues?.sandbox).toBe(res.sandbox)
    expect(audit?.newValues?.sandbox).toBe(true)
  })

  it("runs an empty queue cleanly (0 processed / 0 skipped / 0 failed)", async () => {
    const res = await runZatcaAdapter()
    expect(res.success).toBe(true)
    expect(res.processed).toBe(0)
    expect(res.skipped).toBe(0)
    expect(res.failed).toBe(0)
    expect(res.error).toBeUndefined()
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/accounting")
  })

  it("traverses the entire issuance queue once in chronological order when UUIDs decrease across pages", async () => {
    const rows = Array.from({ length: 10_002 }, (_, i) => ({
      id: String(20_000 - i).padStart(5, "0"), source_id: `invoice-${i}`, event_type: "InvoiceFinalizedEvent",
      created_at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
    }))
    const visited: string[] = []
    mocks.adminFrom.mockImplementation(((table: string) => {
      if (table === "invoices") {
        const q = { select: () => q, eq: (key: string, val: string) => { if (key === "id") visited.push(val); return q }, maybeSingle: async () => ({ data: null, error: null }) }
        return q
      }
      if (table !== "financial_events") throw new Error("Unexpected table")
      let filtered = rows
      let count = 0
      const q = {
        select: () => q, eq: () => q, in: () => q, order: () => q, lte: () => q,
        gt: (_key: string, id: string) => { filtered = rows.filter(row => row.id > id); return q },
        or: (condition: string) => {
          const cursor = /created_at\.gt\."?([^",]+)"?,and\(created_at\.eq\."?([^",]+)"?,id\.gt\.([\w-]+)\)/.exec(condition)
          if (!cursor || cursor[1] !== cursor[2]) throw new Error("Invalid chronological cursor")
          filtered = rows.filter(row => row.created_at > cursor[1] || (row.created_at === cursor[1] && row.id > cursor[3]))
          return q
        },
        limit: (n: number) => { count = n; return q },
        then: (resolve: (value: unknown) => unknown) => resolve({ data: filtered.slice(0, count), error: null }),
      }
      return q
    }) as never)
    const result = await runZatcaAdapter()
    expect(result).toMatchObject({ success: true, skipped: 10_002, failed: 0 })
    expect(visited).toEqual(rows.map(row => row.source_id))
  })
})

describe("transmission detail boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getCurrentUser.mockResolvedValue(CURRENT_USER) })

  it("scopes privileged reads to the tenant and never serializes an echoed gateway secret", async () => {
    const builder = {select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn()}
    builder.select.mockReturnValue(builder); builder.eq.mockReturnValue(builder)
    builder.maybeSingle.mockResolvedValue({data:{doc_ref:"TEST",doc_type:"invoice",status:"reported",zatca_uuid:"test",payload_xml:"<Invoice/>",transmitted_at:null,error_message:null,response:{sandbox:true,secret:"synthetic-echo-do-not-return"}},error:null})
    mocks.adminFrom.mockReturnValue(builder)
    const result=await getZatcaTransmission("document-id")
    expect(mocks.requirePermission).toHaveBeenCalledWith("accounting","read")
    expect(builder.eq).toHaveBeenCalledWith("tenant_id",CURRENT_USER.tenantId)
    expect(result.transmission?.mock).toBe(true)
    expect(JSON.stringify(result)).not.toContain("synthetic-echo-do-not-return")
    expect(result.transmission).not.toHaveProperty("response")
  })

  it("rejects unauthenticated detail reads before privileged database access", async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    expect((await getZatcaTransmission("document-id")).success).toBe(false)
    expect(mocks.adminFrom).not.toHaveBeenCalled()
  })
})

vi.mock("@/lib/release/integrations", () => ({ integrationAvailable: () => true, INTEGRATION_UNAVAILABLE: "Unavailable" }))

// ── Network mode: prepared + signed submission, never unsigned XML ─────────

const SOURCE_ID = "22222222-2222-4222-8222-222222222222"
const TENANT_ROW = {
  name_ar: "شركة", name_en: "Co", legal_name: "Synthetic Co", vat_number: "399999999900003", cr_number: "1010010000",
  address: "King Fahd Road", city: "Riyadh", region: "Riyadh", district: "Olaya", building_number: "1234",
  additional_number: "5678", postal_code: "12345", country: "SA",
}

function tableBuilder(table: string, rows: Record<string, unknown>, writes: { table: string; op: string; value: unknown }[]) {
  const single = () => Promise.resolve({ data: rows[table] ?? null, error: rows[`${table}:error`] ?? null })
  const builder: Record<string, unknown> = {}
  for (const m of ["select", "eq", "in", "order", "limit", "lte", "gt", "is", "or"]) builder[m] = vi.fn(() => builder)
  builder.maybeSingle = vi.fn(single)
  builder.insert = vi.fn((value: unknown) => { writes.push({ table, op: "insert", value }); return Promise.resolve({ error: null }) })
  builder.update = vi.fn((value: unknown) => { writes.push({ table, op: "update", value }); return builder })
  builder.upsert = vi.fn((value: unknown, opts: unknown) => { writes.push({ table, op: "upsert", value: { value, opts } }); return Promise.resolve({ error: null }) })
  builder.then = (resolve: (v: unknown) => void) =>
    resolve(table === "financial_events" ? { data: rows.financial_events, error: null } : { data: rows[`${table}:list`] ?? [], error: null })
  return builder
}

function networkAdmin(overrides: Record<string, unknown> = {}) {
  const writes: { table: string; op: string; value: unknown }[] = []
  const rows: Record<string, unknown> = {
    financial_events: [{ id: "ev-1", event_type: "InvoiceFinalizedEvent", source_type: "invoice", source_id: SOURCE_ID, payload: {} }],
    invoices: { id: SOURCE_ID, invoice_number: "INV-1", invoice_type: "sales", status: "finalized", customer_id: "cust-1", issue_date: "2026-10-28", currency: "SAR", subtotal: 100, discount: 0, vat_amount: 15, total: 115, vat_rate: 15 },
    "invoice_lines:list": [{ line_no: 1, item_name: "Delivery service", description: "Delivery", quantity: 1, unit_price: 100.1234, discount: 0, amount: 100, vat_rate: 15, vat_amount: 15 }],
    zatca_transmissions: null,
    tenants: TENANT_ROW,
    customers: { name_ar: "عميل", name_en: null, tax_number: "399999999800003", address: "Olaya St", city: "Riyadh", district: "Olaya", building_number: "4321", additional_number: null, postal_code: "54321", country_code: "SA" },
    zatca_issuance_streams: { id: "33333333-3333-4333-8333-333333333333" },
    ...overrides,
  }
  mocks.adminFrom.mockImplementation(((table: string) => tableBuilder(table, rows, writes)) as never)
  return writes
}

function scheduledAdmin(events: { id: string; created_at: string }[], overrides: Record<string, unknown> = {}) {
  networkAdmin({ zatca_automation: { operator_id: "auth-9", enabled: true }, ...overrides })
  const last = events[events.length - 1]
  mocks.adminRpc.mockImplementation(async name => ({
    data: name === "list_zatca_scheduled_events"
      ? { events, after: last ? { id: last.id, created_at: last.created_at } : null, has_more: false }
      : true,
    error: null,
  }))
}

describe("runZatcaAdapter — network mode uses the prepared, signed submission path", () => {
  beforeEach(() => {
    mocks.getZatcaCsidCredential.mockResolvedValue(STORED_CSID)
    vi.stubEnv("ZATCA_MODE", "sandbox")
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal")
  })

  it("prepares on the EGS stream, submits for clearance and records the issuance identity", async () => {
    const writes = networkAdmin()
    const res = await runZatcaAdapter()
    expect(res).toMatchObject({ success: true, processed: 1, failed: 0, sandbox: false })
    expect(mocks.transmitToZatca).not.toHaveBeenCalled()
    expect(mocks.buildZatcaUblInvoice).not.toHaveBeenCalled()
    const [stream, source, input] = mocks.prepareZatcaDocument.mock.calls[0]
    expect(stream).toBe("33333333-3333-4333-8333-333333333333")
    expect(source).toBe(SOURCE_ID)
    expect(input).toMatchObject({ docType: "invoice", invoiceKind: "standard", invoiceNumber: "INV-1", deliveryDate: "2026-10-28" })
    expect(mocks.submitPreparedZatcaDocument).toHaveBeenCalledWith(CURRENT_USER, "11111111-1111-4111-8111-111111111111", "submit")
    expect(input).toMatchObject({ lines: [expect.objectContaining({ item_name: "Delivery service", description: "Delivery", unit_price: 100.1234 })] })
    expect(mocks.adminRpc).toHaveBeenCalledWith("record_zatca_transmission", expect.objectContaining({
      p_tenant: CURRENT_USER.tenantId, p_actor: CURRENT_USER.authUserId, p_source_type: "invoice", p_status: "cleared",
      p_source_id: SOURCE_ID, p_zatca_uuid: "11111111-1111-4111-8111-111111111111", p_payload_xml: "<Invoice prepared/>", p_error_message: null,
    }))
    expect(writes.filter(w => ["invoices", "zatca_transmissions"].includes(w.table))).toEqual([])
  })

  it("records the original acceptance time when the adapter recovers after a failed status write", async () => {
    const transmittedAt = "2026-11-24T12:34:56.000Z"
    mocks.submitPreparedZatcaDocument.mockResolvedValueOnce({
      success: true, status: "cleared", pipeline: "clearance", transmittedAt,
    })
    networkAdmin()

    expect(await runZatcaAdapter()).toMatchObject({ processed: 1, failed: 0 })
    expect(mocks.adminRpc).toHaveBeenCalledWith("record_zatca_transmission", expect.objectContaining({
      p_status: "cleared", p_transmitted_at: transmittedAt,
    }))
  })

  it("reports an in-flight manual submission without writing a failed transmission", async () => {
    mocks.submitPreparedZatcaDocument.mockResolvedValueOnce({ success: false, inProgress: true, pipeline: "clearance" })
    networkAdmin()

    expect(await sendDocumentToZatca(SOURCE_ID)).toMatchObject({
      success: false, inProgress: 1, failed: 0, error: "A ZATCA submission is already in progress.",
    })
    expect(mocks.adminRpc).not.toHaveBeenCalledWith("record_zatca_transmission", expect.anything())
  })

  it("reports unconfirmed evidence without projecting a stale failure", async () => {
    const error = "Unable to retain the ZATCA submission evidence. Retry with the same prepared document."
    mocks.submitPreparedZatcaDocument.mockResolvedValueOnce({ success: false, unconfirmed: true, pipeline: "clearance", error })
    networkAdmin()

    expect(await runZatcaAdapter()).toMatchObject({ processed: 0, failed: 1, error })
    expect(mocks.adminRpc).not.toHaveBeenCalledWith("record_zatca_transmission", expect.anything())
  })

  it("fails closed (no preparation) when the seller National Address is incomplete", async () => {
    networkAdmin({ tenants: { ...TENANT_ROW, building_number: null, postal_code: null } })
    const res = await runZatcaAdapter()
    expect(res).toMatchObject({ success: true, processed: 0, failed: 1 })
    expect(res.error).toContain("seller.building_number")
    expect(mocks.prepareZatcaDocument).not.toHaveBeenCalled()
  })

  it("never submits documents finalized before the EGS go-live (stream registration)", async () => {
    networkAdmin({
      financial_events: [{ id: "ev-1", event_type: "InvoiceFinalizedEvent", source_type: "invoice", source_id: SOURCE_ID, payload: {}, created_at: "2026-10-01T10:00:00Z" }],
      zatca_issuance_streams: { id: "33333333-3333-4333-8333-333333333333", created_at: "2026-10-20T00:00:00Z" },
    })
    const res = await runZatcaAdapter()
    expect(res).toMatchObject({ success: true, processed: 0, skipped: 1, failed: 0 })
    expect(mocks.prepareZatcaDocument).not.toHaveBeenCalled()
  })

  it("does not treat a mock or other-environment acceptance as done for the configured gateway", async () => {
    networkAdmin({ zatca_transmissions: { id: "tx-1", status: "reported", environment: null } })
    expect(await runZatcaAdapter()).toMatchObject({ processed: 1, skipped: 0 })
    vi.clearAllMocks(); mocks.getCurrentUser.mockResolvedValue(CURRENT_USER); mocks.getZatcaCsidCredential.mockResolvedValue(STORED_CSID)
    networkAdmin({ zatca_transmissions: { id: "tx-1", status: "cleared", environment: "sandbox" } })
    expect(await runZatcaAdapter()).toMatchObject({ processed: 0, skipped: 1 })
    networkAdmin({ zatca_transmissions: { id: "tx-1", status: "reported", environment: "sandbox", mock: true } })
    expect(await runZatcaAdapter()).toMatchObject({ processed: 1, skipped: 0 })
  })

  it("requires a registered EGS issuance stream for the environment", async () => {
    networkAdmin({ zatca_issuance_streams: null })
    const res = await runZatcaAdapter()
    expect(res.failed).toBe(1)
    expect(res.error).toContain("EGS issuance stream")
    expect(mocks.submitPreparedZatcaDocument).not.toHaveBeenCalled()
  })

  it.each([
    { customers: null },
    { customers: null, "customers:error": { message: "private database error" } },
    { "zatca_transmissions:error": { message: "private database error" } },
  ])("stops when the linked buyer or prior transmission cannot be verified", async overrides => {
    networkAdmin(overrides)
    const res = await runZatcaAdapter()
    expect(res).toMatchObject({ processed: 0, failed: 1 })
    expect(res.error).not.toContain("private database error")
    expect(mocks.prepareZatcaDocument).not.toHaveBeenCalled()
    expect(mocks.submitPreparedZatcaDocument).not.toHaveBeenCalled()
  })

  it("records a rejected submission as rejected (never reported) and counts it as failed", async () => {
    mocks.submitPreparedZatcaDocument.mockResolvedValueOnce({ success: false, status: "rejected", pipeline: "reporting", warnings: [], errors: [{ code: "BR-KSA-63" }] })
    networkAdmin({ customers: null, invoices: { id: SOURCE_ID, invoice_number: "INV-2", invoice_type: "sales", status: "finalized", customer_id: null, issue_date: "2026-10-28", currency: "SAR", subtotal: 100, discount: 0, vat_amount: 15, total: 115, vat_rate: 15 } })
    const res = await runZatcaAdapter()
    expect(res.failed).toBe(1)
    expect(mocks.prepareZatcaDocument.mock.calls[0][2]).toMatchObject({ invoiceKind: "simplified" })
    expect(mocks.adminRpc).toHaveBeenCalledWith("record_zatca_transmission", expect.objectContaining({
      p_status: "rejected", p_error_message: "Rejected by ZATCA validation.",
    }))
  })
  it("stops a revoked or inactive operator before credentials, source reads or network",async()=>{
    networkAdmin()
    mocks.adminRpc.mockResolvedValueOnce({data:false,error:null})
    expect(await runZatcaAdapter()).toMatchObject({success:false,error:"The ZATCA operator is no longer authorized."})
    expect(mocks.getZatcaCsidCredential).not.toHaveBeenCalled()
    expect(mocks.adminFrom).not.toHaveBeenCalled()
    expect(mocks.resolveEnvironment).not.toHaveBeenCalled()
    expect(mocks.submitPreparedZatcaDocument).not.toHaveBeenCalled()
  })
  it("stops unsupported production resolution before source reads, credentials or submission",async()=>{
    networkAdmin()
    mocks.resolveEnvironment.mockResolvedValueOnce("production")
    expect(await runZatcaAdapter()).toMatchObject({success:false,error:"ZATCA production submission is disabled."})
    expect(mocks.adminFrom).not.toHaveBeenCalled()
    expect(mocks.getZatcaCsidCredential).not.toHaveBeenCalled()
    expect(mocks.prepareZatcaDocument).not.toHaveBeenCalled()
    expect(mocks.submitPreparedZatcaDocument).not.toHaveBeenCalled()
    expect(mocks.transmitToZatca).not.toHaveBeenCalled()
  })
  it("does not fall back to the deployment gateway when tenant resolution returns no environment",async()=>{
    networkAdmin()
    mocks.resolveEnvironment.mockResolvedValueOnce(null)
    expect(await runZatcaAdapter()).toMatchObject({success:false,error:"Unable to resolve the tenant's ZATCA environment."})
    expect(mocks.adminFrom).not.toHaveBeenCalled()
    expect(mocks.getZatcaCsidCredential).not.toHaveBeenCalled()
    expect(mocks.submitPreparedZatcaDocument).not.toHaveBeenCalled()
    expect(mocks.transmitToZatca).not.toHaveBeenCalled()
  })
  it("stops a tenant environment lookup failure before source reads or submission",async()=>{
    networkAdmin()
    mocks.resolveEnvironment.mockRejectedValueOnce(new Error("Unable to resolve the tenant's ZATCA environment."))
    expect(await runZatcaAdapter()).toMatchObject({success:false,error:"Unable to resolve the tenant's ZATCA environment."})
    expect(mocks.adminFrom).not.toHaveBeenCalled()
    expect(mocks.getZatcaCsidCredential).not.toHaveBeenCalled()
    expect(mocks.transmitToZatca).not.toHaveBeenCalled()
  })
  it.each([{data:false,error:null},{data:null,error:{message:"private database detail"}}])("does not count an unpersisted transmission as processed (%j)",async result=>{
    networkAdmin()
    mocks.adminRpc.mockResolvedValueOnce({data:true,error:null}).mockResolvedValueOnce(result)
    expect(await runZatcaAdapter()).toMatchObject({processed:0,failed:1,error:"Unable to persist the ZATCA transmission result."})
  })
  it.each(["paid","partially_paid","overdue"])("retries a %s invoice only if it already has an immutable preparation",async status=>{
    const invoice={id:SOURCE_ID,invoice_number:"INV-1",invoice_type:"sales",status,customer_id:"cust-1",issue_date:"2026-10-28",currency:"SAR",subtotal:100,discount:0,vat_amount:15,total:115,vat_rate:15}
    networkAdmin({invoices:invoice,zatca_document_issuances:null})
    expect(await runZatcaAdapter()).toMatchObject({processed:0,skipped:1})
    expect(mocks.prepareZatcaDocument).not.toHaveBeenCalled()
    networkAdmin({invoices:invoice,zatca_document_issuances:{id:"11111111-1111-4111-8111-111111111111"}})
    expect(await runZatcaAdapter()).toMatchObject({processed:1,failed:0})
    expect(mocks.prepareZatcaDocument).toHaveBeenCalledTimes(1)
  })
  it.each(["credit_note","debit_note"])("preserves the separate item name and four decimal price for %s",async docType=>{
    const table=docType==="credit_note"?"credit_notes":"debit_notes"
    networkAdmin({
      financial_events:[{id:"ev-note",event_type:docType==="credit_note"?"CreditNoteIssuedEvent":"DebitNoteIssuedEvent",source_type:docType,source_id:SOURCE_ID,payload:{}}],
      [table]:{id:SOURCE_ID,[`${docType}_number`] : "NOTE-1",reference_invoice_id:"invoice-1",customer_id:"cust-1",issue_date:"2026-10-28",currency:"SAR",subtotal:100,discount:0,vat_amount:15,total:115,reason:"Adjustment",lines:[{line_no:1,item_name:"Named service",description:"Separate description",quantity:1,unit_price:100.1234,amount:100,vat_rate:15,vat_amount:15}]},
    })
    expect(await runZatcaAdapter()).toMatchObject({processed:1,failed:0})
    expect(mocks.prepareZatcaDocument.mock.calls[0][2]).toMatchObject({docType,lines:[expect.objectContaining({item_name:"Named service",description:"Separate description",unit_price:100.1234})]})
  })
})

describe("runZatcaForTenant — scheduled backstop on behalf of the registered operator", () => {
  beforeEach(() => {
    mocks.getZatcaCsidCredential.mockResolvedValue(STORED_CSID)
    vi.stubEnv("ZATCA_MODE", "sandbox")
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal")
  })

  it("does nothing without a registered operator", async () => {
    networkAdmin({ zatca_automation: null })
    const res = await runZatcaForTenant("tenant-0001")
    expect(res).toMatchObject({ success: false, operator: false })
    expect(mocks.prepareZatcaDocument).not.toHaveBeenCalled()
  })

  it("stops when the operator is no longer authorized", async () => {
    networkAdmin({ zatca_automation: { operator_id: "auth-9", enabled: true } })
    mocks.adminRpc.mockResolvedValueOnce({ data: false, error: null })
    const res = await runZatcaForTenant("tenant-0001")
    expect(res.error).toContain("no longer authorized")
    expect(mocks.adminRpc).toHaveBeenCalledWith("zatca_operator_authorized", { p_tenant: "tenant-0001", p_user: "auth-9" })
    expect(mocks.prepareZatcaDocument).not.toHaveBeenCalled()
  })

  it("submits pending documents as the operator and records the run", async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    mocks.getZatcaCsidCredential.mockRejectedValueOnce(new Error("No browser session"))
    const writes = networkAdmin({ zatca_automation: { operator_id: "auth-9", enabled: true } })
    const res = await runZatcaForTenant("tenant-0001")
    expect(res).toMatchObject({ success: true, processed: 1, operator: true })
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
    expect(mocks.getZatcaCsidCredential).not.toHaveBeenCalled()
    expect(mocks.submitPreparedZatcaDocument).toHaveBeenCalledWith(
      { tenantId: "tenant-0001", authUserId: "auth-9" },
      "11111111-1111-4111-8111-111111111111",
      "submit",
    )
    expect(writes.find((w) => w.table === "zatca_automation")?.value).toMatchObject({ last_result: { success: true, processed: 1 } })
    expect(mocks.adminRpc).toHaveBeenCalledWith("record_zatca_transmission",expect.objectContaining({p_actor:"auth-9",p_tenant:"tenant-0001"}))
  })

  it("checkpoints a bounded scheduled page even when every document in that page fails", async () => {
    const events = Array.from({ length: 17 }, (_, index) => ({
      id: `event-${index}`, source_id: `invoice-${index}`, event_type: "InvoiceFinalizedEvent",
      created_at: new Date(Date.UTC(2026, 9, 31, 0, 0, index)).toISOString(),
    }))
    const through = "2026-11-01T00:00:00.000Z"
    scheduledAdmin(events, {
      "invoices:error": { message: "synthetic failure" },
    })

    const result = await runZatcaForTenant("tenant-0001", undefined, {
      scan: { environment: "sandbox", through, cursor: null }, stopAt: Date.now() + 10_000,
    })
    expect(result).toMatchObject({
      success: true, failed: 16, scheduledProgress: {
        scan: { environment: "sandbox", through, cursor: { id: events[15].id, created_at: events[15].created_at } },
      },
    })
  })

  it("resumes strictly after the saved tuple inside the same finite window", async () => {
    const through = "2026-11-01T00:00:00.000Z"
    const cursor = { id: "event-1", created_at: "2026-10-31T12:00:00.000Z" }
    scheduledAdmin([])

    const result = await runZatcaForTenant("tenant-0001", undefined, {
      scan: { environment: "sandbox", through, cursor }, stopAt: Date.now() + 10_000,
    })
    expect(mocks.adminRpc).toHaveBeenCalledWith("list_zatca_scheduled_events", {
      p_tenant: "tenant-0001", p_environment: "sandbox", p_through: through,
      p_cursor_at: cursor.created_at, p_cursor_id: cursor.id, p_limit: 512,
    })
    expect(result).toMatchObject({ scheduledProgress: { scan: null } })
  })

  it("leaves the saved scan intact when the scheduled time slice is already exhausted", async () => {
    networkAdmin({ zatca_automation: { operator_id: "auth-9", enabled: true } })
    const result = await runZatcaForTenant("tenant-0001", undefined, { scan: null, stopAt: Date.now() - 10 })
    expect(result).not.toHaveProperty("scheduledProgress")
    expect(mocks.adminFrom).not.toHaveBeenCalledWith("financial_events")
    expect(mocks.adminRpc).not.toHaveBeenCalledWith("list_zatca_scheduled_events", expect.anything())
    expect(mocks.prepareZatcaDocument).not.toHaveBeenCalled()
  })

  it("advances over a settled window and checkpoints it if the next database read fails", async () => {
    const cursor = { id: "last-settled-event", created_at: "2026-10-31T12:00:00.123456Z" }
    const through = "2026-11-01T00:00:00.000Z"
    scheduledAdmin([])
    let reads = 0
    mocks.adminRpc.mockImplementation(async name => {
      if (name !== "list_zatca_scheduled_events") return { data: true, error: null }
      if (++reads === 1) return { data: { events: [], after: cursor, has_more: true }, error: null }
      return { data: null, error: { message: "synthetic read failure" } }
    })

    const result = await runZatcaForTenant("tenant-0001", undefined, {
      scan: { environment: "sandbox", through, cursor: null }, stopAt: Date.now() + 10_000,
    })
    expect(result).toMatchObject({ success: false, scheduledProgress: { scan: { environment: "sandbox", through, cursor } } })
    expect(mocks.adminRpc).toHaveBeenCalledWith("list_zatca_scheduled_events", expect.objectContaining({
      p_cursor_at: cursor.created_at, p_cursor_id: cursor.id,
    }))
    expect(mocks.prepareZatcaDocument).not.toHaveBeenCalled()
  })

  it("does not start a sweep before a stream exists in the configured environment", async () => {
    scheduledAdmin([])
    mocks.adminRpc.mockImplementation(async name => ({
      data: name === "list_zatca_scheduled_events" ? null : true, error: null,
    }))
    const result = await runZatcaForTenant("tenant-0001", undefined, { scan: null, stopAt: Date.now() + 10_000 })

    expect(result).toMatchObject({ success: false, error: expect.stringContaining("Register an EGS issuance stream") })
    expect(result).not.toHaveProperty("scheduledProgress")
    expect(mocks.prepareZatcaDocument).not.toHaveBeenCalled()
  })

  it("stops admitting documents when the first submission consumes the rest of a turn", async () => {
    let now = Date.now()
    const wallClock = vi.spyOn(Date, "now").mockImplementation(() => now)
    try {
      const timestamp = "2026-10-31T12:00:00.000Z"
      const events = ["event-1", "event-2"].map(id => ({
        id, event_type: "InvoiceFinalizedEvent", source_id: SOURCE_ID, created_at: timestamp,
      }))
      scheduledAdmin(events)
      mocks.submitPreparedZatcaDocument.mockImplementationOnce(async () => {
        now += 200
        return { success: true, status: "cleared", pipeline: "clearance" }
      })

      const result = await runZatcaForTenant("tenant-0001", undefined, { scan: null, stopAt: now + 100 })
      expect(result).toMatchObject({
        processed: 1,
        scheduledProgress: { scan: { cursor: { id: "event-1", created_at: timestamp } } },
      })
      expect(mocks.submitPreparedZatcaDocument).toHaveBeenCalledOnce()
    } finally {
      wallClock.mockRestore()
    }
  })
})

describe("Daftra-style controls — per-document send and opt-in auto-send", () => {
  beforeEach(() => {
    mocks.getZatcaCsidCredential.mockResolvedValue(STORED_CSID)
    vi.stubEnv("ZATCA_MODE", "sandbox")
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal")
  })

  it("sends only the selected document, requiring accounting:approve", async () => {
    networkAdmin()
    const res = await sendDocumentToZatca(SOURCE_ID)
    expect(res).toMatchObject({ success: true, processed: 1 })
    expect(mocks.requirePermission).toHaveBeenCalledWith("accounting", "approve")
    const eventsBuilder = mocks.adminFrom.mock.results.find((r, i) => (mocks.adminFrom.mock.calls[i] as unknown[])[0] === "financial_events")?.value as { in: ReturnType<typeof vi.fn> }
    expect(eventsBuilder.in).toHaveBeenCalledWith("source_id", [SOURCE_ID])
  })

  it("rejects malformed ids and tenants without a connected EGS unit", async () => {
    expect(await sendDocumentToZatca("x")).toMatchObject({ success: false })
    networkAdmin({ zatca_issuance_streams: null })
    const res = await sendDocumentToZatca(SOURCE_ID)
    expect(res.error).toContain("Connect ZATCA")
    expect(mocks.prepareZatcaDocument).not.toHaveBeenCalled()
  })

  it("registers the approver as operator when toggling auto-send and audits the change", async () => {
    const writes = networkAdmin()
    expect(await setZatcaAutoSend(true)).toEqual({ success: true })
    expect(writes.find((w) => w.table === "zatca_automation")?.value).toEqual({
      value: expect.objectContaining({ tenant_id: "tenant-0001", operator_id: "auth-0001", enabled: true }), opts: { onConflict: "tenant_id" },
    })
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "zatca_auto_send_changed", newValues: { enabled: true } }))
  })

  it("refuses to enable auto-send before onboarding, but always allows turning it off", async () => {
    networkAdmin({ zatca_issuance_streams: null })
    expect((await setZatcaAutoSend(true)).success).toBe(false)
    expect((await setZatcaAutoSend(false)).success).toBe(true)
  })
})
