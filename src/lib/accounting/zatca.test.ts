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
/* eslint-disable @typescript-eslint/no-unused-vars */
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
  adminFrom: vi.fn(() => ({})),
}))

vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: mocks.requirePermission,
  getCurrentUser: mocks.getCurrentUser,
}))

vi.mock("@/lib/auth/sessions", () => ({
  writeAuditLog: mocks.writeAuditLog,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.adminFrom }),
}))

vi.mock("@/lib/accounting/csv-utils", () => ({
  mapFinancialError: mocks.mapFinancialError,
}))

vi.mock("./zatca-csid", () => ({
  getZatcaCsidCredential: mocks.getZatcaCsidCredential,
}))

vi.mock("./zatca-ubl", () => ({
  buildZatcaUblInvoice: mocks.buildZatcaUblInvoice,
}))

vi.mock("./zatca-transport", () => ({
  transmitToZatca: mocks.transmitToZatca,
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}))

import { runZatcaAdapter } from "./zatca"

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
/* eslint-enable @typescript-eslint/no-unused-vars */

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
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.example/e-invoicing/developer-portal")
    const res = await runZatcaAdapter()
    expect(res.sandbox).toBe(false)
  })

  it("reports sandbox=false for the env-only path (base + CSID cert + secret)", async () => {
    mocks.getZatcaCsidCredential.mockResolvedValue(null)
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.example/e-invoicing/developer-portal")
    vi.stubEnv("ZATCA_CSID_CERT", "env-cert")
    vi.stubEnv("ZATCA_CSID_SECRET", "env-secret")
    const res = await runZatcaAdapter()
    expect(res.sandbox).toBe(false)
  })

  it("reports sandbox=true for a partial env config (base URL without credentials)", async () => {
    mocks.getZatcaCsidCredential.mockResolvedValue(null)
    vi.stubEnv("ZATCA_API_BASE_URL", "https://gw-fatoora.example/e-invoicing/developer-portal")
    const res = await runZatcaAdapter()
    expect(res.sandbox).toBe(true)
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
