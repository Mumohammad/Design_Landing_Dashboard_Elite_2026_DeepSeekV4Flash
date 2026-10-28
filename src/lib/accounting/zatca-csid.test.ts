// Financial Phase 18 — unit tests for the ZATCA CSID credential store
// (src/lib/accounting/zatca-csid.ts, migrations 055 + 056).
//
// The store is a "use server" module with I/O (Supabase admin client, auth,
// audit log, onboarding transport), so the tests mock those boundaries and
// assert the store's own contract:
//   - saveZatcaCsid persists the CSID + private_key (upsert) and masks the
//     secret in the audit log
//   - listZatcaCsids returns a MASKED summary and NEVER selects private_key
//   - getZatcaCsidCredential returns the full server-only credential incl.
//     privateKeyPem, null when no issued row matches
//   - onboardZatcaCsids runs keygen → compliance CSID → production CSID and
//     persists BOTH with the SAME keypair private key; requires an OTP; no
//     tenant → clean error
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ── Mocks ──────────────────────────────────────────────────────────────────

// The mock signatures below are typed so `.mock.calls[i][j]` resolves to real
// types (untyped vi.fn() narrows tuple elements to `never`) — but the params
// are intentionally unused by the no-op mock bodies. The underscore prefix
// does NOT satisfy this repo's @typescript-eslint/no-unused-vars, so disable
// it for this mock block only.
/* eslint-disable @typescript-eslint/no-unused-vars */
const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(async (_module: string, _action: string) => {}),
  getCurrentUser: vi.fn(async (): Promise<{ tenantId: string; authUserId: string } | null> => null),
  writeAuditLog: vi.fn(
    async (_entry: { action: string; newValues: Record<string, unknown> }) => {}
  ),
  generateZatcaKeyPair: vi.fn((): { privateKeyPem: string; publicKeyPem: string } => ({ privateKeyPem: "", publicKeyPem: "" })),
  buildZatcaCsr: vi.fn((_input: Record<string, unknown>, _keyPair: { privateKeyPem: string; publicKeyPem: string }) => "CSR-BASE64"),
  requestComplianceCsid: vi.fn(async (_input: Record<string, unknown>) => ({
    csidBase64: "",
    secret: "",
    requestId: "",
    sandbox: true,
  })),
  requestProductionCsid: vi.fn(async (_input: Record<string, unknown>) => ({
    csidBase64: "",
    secret: "",
    sandbox: true,
  })),
  adminFrom: vi.fn(() => ({})),
}))

vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: mocks.requirePermission,
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock("@/lib/auth/sessions", () => ({
  writeAuditLog: mocks.writeAuditLog,
}))

vi.mock("./zatca-crypto", () => ({
  generateZatcaKeyPair: mocks.generateZatcaKeyPair,
  buildZatcaCsr: mocks.buildZatcaCsr,
  ZATCA_CERT_TEMPLATES: {
    sandbox: "TSTZATCA-Code-Signing",
    simulation: "PREZATCA-Code-Signing",
    production: "ZATCA-Code-Signing",
  },
}))

vi.mock("./zatca-onboarding", () => ({
  requestComplianceCsid: mocks.requestComplianceCsid,
  requestProductionCsid: mocks.requestProductionCsid,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.adminFrom }),
}))

vi.mock("server-only", () => ({}))
import { saveZatcaCsid, listZatcaCsids, onboardZatcaCsids } from "./zatca-csid"
import { getZatcaCsidCredential } from "./zatca-credentials"

// ── Helpers ────────────────────────────────────────────────────────────────

const CURRENT_USER = { tenantId: "tenant-0001", authUserId: "auth-0001" }
const KEY_PEM = "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBg==\n-----END PRIVATE KEY-----"

type BuilderOverrides = {
  maybeSingleData?: unknown
  maybeSingleError?: { message: string } | null
  upsertError?: { message: string } | null
  /** Result of a plain select chain (list queries resolve via `then`). */
  listData?: unknown
}

/**
 * Chainable mock of the supabase query builder used by the store. The builder
 * is ALSO thenable: `await admin.from(t).select().eq().order()` (the list
 * path) resolves to `{ data: listData, error: null }`. Terminal methods
 * (`maybeSingle`, `upsert`) return their own promises.
 */
function mockBuilder(overrides: BuilderOverrides = {}) {
  const builder = {
    select: vi.fn((_cols: string) => builder),
    eq: vi.fn((_col: string, _val: unknown) => builder),
    order: vi.fn((_col: string, _opts?: unknown) => builder),
    limit: vi.fn((_n: number) => builder),
    insert: vi.fn(async (_payload: Record<string, unknown>) => ({ data: null, error: null })),
    maybeSingle: vi.fn(async () => ({
      data: overrides.maybeSingleData ?? null,
      error: overrides.maybeSingleError ?? null,
    })),
    upsert: vi.fn(async (_payload: Record<string, unknown>, _opts?: Record<string, unknown>) => ({
      data: null,
      error: overrides.upsertError ?? null,
    })),
    then: (resolve: (v: unknown) => void, _reject: (e: unknown) => void) =>
      resolve({ data: overrides.listData ?? [], error: null }),
  }
  return builder
}
/* eslint-enable @typescript-eslint/no-unused-vars */

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentUser.mockResolvedValue(CURRENT_USER)
  mocks.requestComplianceCsid.mockResolvedValue({
    csidBase64: "CCSID-BASE64",
    secret: "cc-secret",
    requestId: "req-123",
    sandbox: true,
  })
  mocks.requestProductionCsid.mockResolvedValue({
    csidBase64: "PCSID-BASE64",
    secret: "pc-secret",
    sandbox: true,
  })
  mocks.generateZatcaKeyPair.mockReturnValue({
    privateKeyPem: KEY_PEM,
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\n-----END PUBLIC KEY-----",
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// ── saveZatcaCsid ──────────────────────────────────────────────────────────

describe("saveZatcaCsid", () => {
  it("upserts the CSID row with the private_key and masks the secret in the audit log", async () => {
    const builder = mockBuilder()
    mocks.adminFrom.mockReturnValue(builder)

    const res = await saveZatcaCsid({
      environment: "production",
      kind: "production",
      csidBase64: "CERT-X",
      secret: "super-secret-value",
      privateKey: KEY_PEM,
      requestId: "req-1",
    })

    expect(res.success).toBe(true)
    expect(builder.upsert).toHaveBeenCalledTimes(1)
    const [payload] = builder.upsert.mock.calls[0]
    expect(payload.tenant_id).toBe("tenant-0001")
    expect(payload.private_key).toBe(KEY_PEM)
    expect(payload.csid_base64).toBe("CERT-X")
    expect(payload.secret).toBe("super-secret-value")
    expect(payload.status).toBe("issued")
    expect(payload.created_by).toBe("auth-0001")
    expect(builder.upsert.mock.calls[0][1]).toEqual({ onConflict: "tenant_id,environment,kind" })

    // audit log: secret masked, never the raw value
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1)
    const audit = mocks.writeAuditLog.mock.calls[0][0]
    expect(audit.action).toBe("zatca_csid_saved")
    expect(audit.newValues.secret).toBe("••••")
    expect(audit.newValues.secret).not.toContain("super-secret-value")
    expect(audit.newValues.has_request_id).toBe(true)
  })

  it("requires a CSID cert + secret (private key alone is not enough)", async () => {
    const builder = mockBuilder()
    mocks.adminFrom.mockReturnValue(builder)

    const res = await saveZatcaCsid({
      environment: "sandbox",
      kind: "compliance",
      csidBase64: "",
      secret: "",
      privateKey: KEY_PEM,
    })

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/required/i)
    expect(builder.upsert).not.toHaveBeenCalled()
  })

  it("rejects when the current user is missing", async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    const builder = mockBuilder()
    mocks.adminFrom.mockReturnValue(builder)

    const res = await saveZatcaCsid({
      environment: "sandbox",
      kind: "compliance",
      csidBase64: "C",
      secret: "S",
    })

    expect(res.success).toBe(false)
    expect(builder.upsert).not.toHaveBeenCalled()
  })

  it("surfaces the upsert error instead of throwing", async () => {
    const builder = mockBuilder({ upsertError: { message: "unique violation" } })
    mocks.adminFrom.mockReturnValue(builder)

    const res = await saveZatcaCsid({
      environment: "sandbox",
      kind: "compliance",
      csidBase64: "C",
      secret: "S",
    })

    expect(res.success).toBe(false)
    expect(res.error).toBe("unique violation")
  })
})

// ── listZatcaCsids ─────────────────────────────────────────────────────────

describe("listZatcaCsids", () => {
  it("returns a masked secretPreview and never selects private_key", async () => {
    const builder = mockBuilder({
      listData: [
        { id: "c1", environment: "sandbox", kind: "compliance", status: "issued", secret: "long-secret-1234", issued_at: null, expires_at: null, updated_at: null },
        { id: "c2", environment: "production", kind: "production", status: "issued", secret: "abcd", issued_at: null, expires_at: null, updated_at: null },
      ],
    })
    mocks.adminFrom.mockReturnValue(builder)

    const res = await listZatcaCsids()

    expect(res.success).toBe(true)
    // the SELECT must never ask for the private key
    const selectCols = builder.select.mock.calls[0][0] as string
    expect(selectCols).not.toContain("private_key")
    // rows masked: first 4 chars + ellipsis for long secrets; bullet-only for short
    expect(res.csids![0].secretPreview).toBe("••••")
    expect(res.csids![1].secretPreview).toBe("••••")
    // full secrets absent
    expect(JSON.stringify(res.csids)).not.toContain("long-secret-1234")
    expect(JSON.stringify(res.csids)).not.toContain("abcd")
    // tenant-scoped
    expect(builder.eq).toHaveBeenCalledWith("tenant_id", "tenant-0001")
  })

  it("returns an empty list when the tenant has no CSIDs", async () => {
    const builder = mockBuilder()
    builder.maybeSingle.mockImplementation(async () => ({ data: [], error: null }))
    mocks.adminFrom.mockReturnValue(builder)

    const res = await listZatcaCsids()
    expect(res.success).toBe(true)
    expect(res.csids).toEqual([])
  })
})

// ── getZatcaCsidCredential ─────────────────────────────────────────────────

describe("getZatcaCsidCredential", () => {
  it("rejects foreign tenant access before reading any credential", async () => {
    await expect(getZatcaCsidCredential("production", "production", "tenant-foreign")).rejects.toThrow("Forbidden")
    expect(mocks.adminFrom).not.toHaveBeenCalled()
  })
  it("rejects callers without approval permission", async () => {
    mocks.requirePermission.mockRejectedValueOnce(new Error("Forbidden"))
    await expect(getZatcaCsidCredential("production", "production", "tenant-0001")).rejects.toThrow("Forbidden")
    expect(mocks.adminFrom).not.toHaveBeenCalled()
  })
  it("returns the full server-only credential incl. privateKeyPem", async () => {
    const builder = mockBuilder({
      maybeSingleData: { csid_base64: "CERT-FULL", secret: "full-secret", private_key: KEY_PEM },
    })
    mocks.adminFrom.mockReturnValue(builder)

    const cred = await getZatcaCsidCredential("production", "production", "tenant-0001")

    expect(cred).toEqual({ csidBase64: "CERT-FULL", secret: "full-secret", privateKeyPem: KEY_PEM })
    // scoped to tenant + env + kind + issued status
    expect(builder.eq).toHaveBeenCalledWith("tenant_id", "tenant-0001")
    expect(builder.eq).toHaveBeenCalledWith("environment", "production")
    expect(builder.eq).toHaveBeenCalledWith("kind", "production")
    expect(builder.eq).toHaveBeenCalledWith("status", "issued")
    // the select explicitly includes private_key
    expect(builder.select.mock.calls[0][0]).toContain("private_key")
  })

  it("returns null when no issued row matches (so the adapter falls back to env/sandbox)", async () => {
    const builder = mockBuilder({ maybeSingleData: null })
    mocks.adminFrom.mockReturnValue(builder)

    const cred = await getZatcaCsidCredential("production", "production", "tenant-0001")
    expect(cred).toBeNull()
  })

  it("maps a NULL private_key column to null (rows written before migration 056)", async () => {
    const builder = mockBuilder({
      maybeSingleData: { csid_base64: "CERT", secret: "secret", private_key: null },
    })
    mocks.adminFrom.mockReturnValue(builder)

    const cred = await getZatcaCsidCredential("production", "production", "tenant-0001")
    expect(cred).toEqual({ csidBase64: "CERT", secret: "secret", privateKeyPem: null })
  })
})

// ── onboardZatcaCsids ──────────────────────────────────────────────────────

describe("onboardZatcaCsids", () => {
  it("persists compliance + production CSIDs with the SAME keypair private key and registers the EGS stream", async () => {
    const tenantBuilder = mockBuilder({ maybeSingleData: {
        name_ar: "إيليت", name_en: "Elite", legal_name: "Elite Co", vat_number: "310122993400003", cr_number: "1010010000",
        address: "King Fahd Road", city: "Riyadh", region: "Riyadh", district: "Olaya", building_number: "1234",
        additional_number: "5678", postal_code: "12345", country: "SA",
      } })
    const streamBuilder = mockBuilder({ maybeSingleData: null })
    const csidBuilder = mockBuilder()
    const automationBuilder = mockBuilder()
    mocks.adminFrom.mockImplementation(((table: string) =>
      table === "tenants" ? tenantBuilder : table === "zatca_issuance_streams" ? streamBuilder
        : table === "zatca_automation" ? automationBuilder : csidBuilder) as never)

    const res = await onboardZatcaCsids({ environment: "sandbox", otp: "123456" })

    expect(res).toMatchObject({ success: true, sandbox: true, complianceSaved: true, productionSaved: true })
    expect(res.egsSerial).toMatch(/^1-EliteDev\|2-Dashboard\|3-[0-9a-f-]{36}$/)

    expect(csidBuilder.upsert).toHaveBeenCalledTimes(2)
    const [compliancePayload] = csidBuilder.upsert.mock.calls[0]
    const [productionPayload] = csidBuilder.upsert.mock.calls[1]
    expect(compliancePayload.kind).toBe("compliance")
    expect(compliancePayload.private_key).toBe(KEY_PEM)
    expect(compliancePayload.secret).toBe("cc-secret")
    expect(productionPayload.kind).toBe("production")
    expect(productionPayload.private_key).toBe(KEY_PEM)
    expect(productionPayload.secret).toBe("pc-secret")

    const csrInput = mocks.buildZatcaCsr.mock.calls[0][0]
    expect(csrInput.certificateTemplate).toBe("TSTZATCA-Code-Signing")
    expect(csrInput.uid).toBe("310122993400003")
    expect(csrInput.registeredAddress).toBe("1234 King Fahd Road Olaya Riyadh")
    expect(csrInput.serialNumber).toBe(res.egsSerial)

    expect(mocks.requestProductionCsid).toHaveBeenCalledWith({
      complianceRequestId: "req-123",
      csidBase64: "CCSID-BASE64",
      csidSecret: "cc-secret",
    })
    expect(streamBuilder.insert).toHaveBeenCalledWith({ tenant_id: "tenant-0001", environment: "sandbox", egs_serial: res.egsSerial })
    // The onboarding user becomes the scheduled-run operator.
    expect(automationBuilder.upsert).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: "tenant-0001", enabled: true }), { onConflict: "tenant_id" })

    const audit = mocks.writeAuditLog.mock.calls[0][0]
    expect(audit.action).toBe("zatca_onboarded")
    expect(audit.newValues).toMatchObject({ sandbox: true, vat: "310122993400003", renewal: false })
  })

  it("renews with the existing EGS serial so the ICV/PIH chain continues", async () => {
    const tenantBuilder = mockBuilder({ maybeSingleData: {
        name_ar: "إيليت", name_en: "Elite", legal_name: "Elite Co", vat_number: "310122993400003", cr_number: "1010010000",
        address: "King Fahd Road", city: "Riyadh", region: "Riyadh", district: "Olaya", building_number: "1234",
        additional_number: "5678", postal_code: "12345", country: "SA",
      } })
    const streamBuilder = mockBuilder({ maybeSingleData: { id: "s-1", egs_serial: "1-EliteDev|2-Dashboard|3-existing" } })
    const csidBuilder = mockBuilder()
    mocks.adminFrom.mockImplementation(((table: string) =>
      table === "tenants" ? tenantBuilder : table === "zatca_issuance_streams" ? streamBuilder : csidBuilder) as never)
    const res = await onboardZatcaCsids({ environment: "sandbox", otp: "123456", serialNumber: "1-Other|2-X|3-Y" })
    expect(res.success).toBe(true)
    expect(mocks.buildZatcaCsr.mock.calls[0][0].serialNumber).toBe("1-EliteDev|2-Dashboard|3-existing")
    expect(streamBuilder.insert).not.toHaveBeenCalled()
  })

  it("refuses production onboarding and a mismatched gateway environment", async () => {
    expect(await onboardZatcaCsids({ environment: "production", otp: "123456" })).toMatchObject({ success: false, error: "Production onboarding is disabled." })
    vi.stubEnv("ZATCA_MODE", "sandbox")
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal")
    const res = await onboardZatcaCsids({ environment: "simulation", otp: "123456" })
    expect(res.error).toMatch(/configured ZATCA gateway is sandbox/)
    expect(mocks.requestComplianceCsid).not.toHaveBeenCalled()
  })

  it("requires an OTP before any network or persistence", async () => {
    const builder = mockBuilder()
    mocks.adminFrom.mockReturnValue(builder)

    const res = await onboardZatcaCsids({ environment: "sandbox", otp: "" })

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/OTP/i)
    expect(mocks.requestComplianceCsid).not.toHaveBeenCalled()
    expect(builder.upsert).not.toHaveBeenCalled()
  })

  it("fails cleanly when the tenant is not found", async () => {
    const tenantBuilder = mockBuilder({ maybeSingleData: null })
    mocks.adminFrom.mockReturnValue(tenantBuilder)

    const res = await onboardZatcaCsids({ environment: "sandbox", otp: "123456" })

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/tenant/i)
    expect(mocks.requestComplianceCsid).not.toHaveBeenCalled()
  })

  it("never substitutes a demo VAT number or address: incomplete profiles are refused", async () => {
    const tenantBuilder = mockBuilder({
      maybeSingleData: { name_en: "Elite", legal_name: "Elite Co", vat_number: "not-a-vat", address: null, city: null, country: "SA" },
    })
    mocks.adminFrom.mockReturnValue(tenantBuilder)
    const res = await onboardZatcaCsids({ environment: "sandbox", otp: "123456" })
    expect(res.success).toBe(false)
    expect(res.error).toContain("vat_number")
    expect(res.error).toContain("building_number")
    expect(mocks.buildZatcaCsr).not.toHaveBeenCalled()
    expect(mocks.requestComplianceCsid).not.toHaveBeenCalled()
  })
})

vi.mock("@/lib/release/integrations", () => ({ integrationAvailable: () => true, INTEGRATION_UNAVAILABLE: "Unavailable" }))
