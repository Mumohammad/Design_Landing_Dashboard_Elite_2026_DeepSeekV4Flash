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
  adminRpc: vi.fn(async () => ({ data: true, error: null })),
  adminFrom: vi.fn(() => ({})),
  prepareZatcaDocument: vi.fn(async (_stream: string, _source: string, _input: Record<string, unknown>) => ({
    id: "11111111-1111-4111-8111-111111111111",
    invoice_counter: 7,
    invoice_hash: "HASH",
    unsigned_xml: "<Invoice prepared/>",
  })),
  submitPreparedZatcaDocument: vi.fn(async (_id: string, _mode: string): Promise<Record<string, unknown>> => ({
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

vi.mock("./zatca-ubl", () => ({
  buildZatcaUblInvoice: mocks.buildZatcaUblInvoice,
}))

vi.mock("./zatca-transport", () => ({
  transmitToZatca: mocks.transmitToZatca,
}))

vi.mock("server-only", () => ({}))

// The adapter core calls the actor-based primitives; drop the actor argument
// so assertions keep checking the document arguments.
vi.mock("./zatca-issuance", () => ({
  prepareZatcaDocumentAs: (_actor: unknown, ...args: unknown[]) => (mocks.prepareZatcaDocument as (...a: unknown[]) => unknown)(...args),
}))

vi.mock("./zatca-submission-core", () => ({
  submitPreparedZatcaDocumentAs: (_actor: unknown, ...args: unknown[]) => (mocks.submitPreparedZatcaDocument as (...a: unknown[]) => unknown)(...args),
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

import { runZatcaAdapter, getZatcaTransmission, sendDocumentToZatca, setZatcaAutoSend } from "./zatca"
import { runZatcaForTenant } from "./zatca-adapter-core"

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
  mocks.getCurrentUser.mockResolvedValue(CURRENT_USER)
  mocks.adminFrom.mockReturnValue(mockBuilder())
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
  const single = () => Promise.resolve({ data: rows[table] ?? null, error: null })
  const builder: Record<string, unknown> = {}
  for (const m of ["select", "eq", "in", "order", "limit", "gt", "is"]) builder[m] = vi.fn(() => builder)
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
    "invoice_lines:list": [{ line_no: 1, description: "Delivery", quantity: 1, unit_price: 100, discount: 0, amount: 100, vat_rate: 15, vat_amount: 15 }],
    zatca_transmissions: null,
    tenants: TENANT_ROW,
    customers: { name_ar: "عميل", name_en: null, tax_number: "399999999800003", address: "Olaya St", city: "Riyadh", district: "Olaya", building_number: "4321", additional_number: null, postal_code: "54321", country_code: "SA" },
    zatca_issuance_streams: { id: "33333333-3333-4333-8333-333333333333" },
    ...overrides,
  }
  mocks.adminFrom.mockImplementation(((table: string) => tableBuilder(table, rows, writes)) as never)
  return writes
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
    expect(mocks.submitPreparedZatcaDocument).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "submit")
    const tx = writes.find((w) => w.table === "zatca_transmissions")?.value as Record<string, unknown>
    expect(tx).toMatchObject({ status: "cleared", source_id: SOURCE_ID, zatca_uuid: "11111111-1111-4111-8111-111111111111", payload_xml: "<Invoice prepared/>", error_message: null })
    expect(writes.find((w) => w.table === "invoices")?.value).toMatchObject({ zatca_status: "cleared" })
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
  })

  it("requires a registered EGS issuance stream for the environment", async () => {
    networkAdmin({ zatca_issuance_streams: null })
    const res = await runZatcaAdapter()
    expect(res.failed).toBe(1)
    expect(res.error).toContain("EGS issuance stream")
    expect(mocks.submitPreparedZatcaDocument).not.toHaveBeenCalled()
  })

  it("records a rejected submission as rejected (never reported) and counts it as failed", async () => {
    mocks.submitPreparedZatcaDocument.mockResolvedValueOnce({ success: false, status: "rejected", pipeline: "reporting", warnings: [], errors: [{ code: "BR-KSA-63" }] })
    const writes = networkAdmin({ customers: null, invoices: { id: SOURCE_ID, invoice_number: "INV-2", invoice_type: "sales", status: "finalized", customer_id: null, issue_date: "2026-10-28", currency: "SAR", subtotal: 100, discount: 0, vat_amount: 15, total: 115, vat_rate: 15 } })
    const res = await runZatcaAdapter()
    expect(res.failed).toBe(1)
    expect(mocks.prepareZatcaDocument.mock.calls[0][2]).toMatchObject({ invoiceKind: "simplified" })
    const tx = writes.find((w) => w.table === "zatca_transmissions")?.value as Record<string, unknown>
    expect(tx.status).toBe("rejected")
    expect(tx.error_message).toBe("Rejected by ZATCA validation.")
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
    const writes = networkAdmin({ zatca_automation: { operator_id: "auth-9", enabled: true } })
    const res = await runZatcaForTenant("tenant-0001")
    expect(res).toMatchObject({ success: true, processed: 1, operator: true })
    expect(mocks.getCurrentUser).not.toHaveBeenCalled()
    expect(writes.find((w) => w.table === "zatca_automation")?.value).toMatchObject({ last_result: { success: true, processed: 1 } })
    expect((writes.find((w) => w.table === "zatca_transmissions")?.value as Record<string, unknown>).created_by).toBe("auth-9")
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
