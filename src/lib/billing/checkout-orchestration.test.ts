import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

afterEach(() => vi.unstubAllEnvs())

const mocks = vi.hoisted(() => ({ caller: vi.fn(), admin: vi.fn(), create: vi.fn(), fetch: vi.fn(), configured: vi.fn(), from: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.caller }) }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.admin, from: mocks.from }) }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("./moyasar", () => ({ createMoyasarInvoice: mocks.create, fetchMoyasarInvoice: mocks.fetch, moyasarConfigured: mocks.configured }))
import { reconcileAttempt, startCardCheckout } from "./card-payments"

const id = "10000000-0000-4000-8000-000000000001", tenant = "10000000-0000-4000-8000-000000000002", actor = "10000000-0000-4000-8000-000000000003", attemptId = "10000000-0000-4000-8000-000000000004"
const input = { platformInvoiceId: id, tenantId: tenant, userId: actor, companyName: "Synthetic company" }
const attempt = { id: attemptId, platform_invoice_id: id, tenant_id: tenant, amount_halalas: 11500, created_by: actor, status: "creating", checkout_url: null, provider_invoice_id: null }
const remote = { id: "10000000-0000-4000-8000-000000000005", amount: 11500, currency: "SAR", url: "https://checkout.moyasar.com/synthetic", metadata: { attempt_id: attemptId, platform_invoice_id: id, tenant_id: tenant } }
const mappedAttempt = () => ({ ...attempt, status: "initiated", provider_invoice_id: remote.id, checkout_url: remote.url, created_at: "2026-11-01T00:00:00Z", failure_reason: null as string | null })
let stored = mappedAttempt()
let readError = false
let transitionError = false
let refuseTransition = false

// Apply the query's filters to current state when the write executes, not when
// the provider request starts. This models a callback winning during fetch.
function table() {
  let patch: Record<string, unknown> | null = null
  const filters: Array<(value: typeof stored) => boolean> = []
  const chain = {
    select: () => chain,
    eq: (key: keyof typeof stored, value: unknown) => { filters.push(row => row[key] === value); return chain },
    in: (key: keyof typeof stored, values: unknown[]) => { filters.push(row => values.includes(row[key])); return chain },
    update: (value: Record<string, unknown>) => { patch = value; return chain },
    maybeSingle: async () => {
      if (!patch) return readError ? { data: null, error: { code: "08006" } } : { data: filters.every(filter => filter(stored)) ? { ...stored } : null, error: null }
      if (transitionError) return { data: null, error: { code: "08006" } }
      if (refuseTransition || !filters.every(filter => filter(stored))) return { data: null, error: null }
      stored = { ...stored, ...patch }
      return { data: { ...stored }, error: null }
    },
  }
  return chain
}
beforeEach(() => {
  vi.resetAllMocks()
  stored = mappedAttempt()
  readError = false
  transitionError = false
  refuseTransition = false
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://synthetic.example")
  mocks.configured.mockReturnValue(true)
  mocks.caller.mockResolvedValue({ data: { is_new: true, attempt, invoice: { invoice_number: "Synthetic", period_label: null } }, error: null })
  mocks.create.mockResolvedValue(remote)
  mocks.fetch.mockResolvedValue({ ...remote, status: "initiated" })
  mocks.from.mockImplementation(table)
  mocks.admin.mockImplementation(async name => {
    if (name === "settle_platform_card_payment") { stored.status = "paid"; return { data: "settled", error: null } }
    return { data: { id: attemptId, provider_invoice_id: remote.id, checkout_url: remote.url, amount_halalas: 11500, status: "initiated" }, error: null }
  })
})
describe("checkout confirmation boundary", () => {
  it("returns a checkout only after its exact provider mapping is confirmed", async () => {
    expect(await startCardCheckout(input)).toEqual({ url: remote.url })
    expect(mocks.caller).toHaveBeenCalledWith("claim_my_platform_checkout", { p_invoice_id: id })
    expect(mocks.admin).toHaveBeenCalledWith("confirm_platform_checkout", expect.objectContaining({ p_attempt_id: attemptId, p_provider_id: remote.id }))
  })
  it.each([{ data: null, error: { code: "timeout" } }, { data: null, error: null }, { data: { id: attemptId, checkout_url: "https://wrong.example" }, error: null }])("never exposes a checkout after an unknown/malformed mapping result", async response => {
    mocks.admin.mockResolvedValue(response)
    expect(await startCardCheckout(input)).not.toHaveProperty("url")
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it("keeps an unknown provider creation reserved rather than creating another live attempt", async () => {
    mocks.create.mockRejectedValueOnce(Error("network timeout"))
    expect(await startCardCheckout(input)).not.toHaveProperty("url")
    mocks.caller.mockResolvedValue({ data: { is_new: false, attempt, invoice: { invoice_number: "Synthetic", period_label: null } }, error: null })
    expect(await startCardCheckout(input)).not.toHaveProperty("url")
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it("reuses an existing mapped checkout without another provider creation", async () => {
    mocks.caller.mockResolvedValue({ data: { is_new: false, attempt: { ...attempt, status: "initiated", provider_invoice_id: remote.id, checkout_url: remote.url }, invoice: { invoice_number: "Synthetic", period_label: null } }, error: null })
    expect(await startCardCheckout(input)).toEqual({ url: remote.url })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledWith(remote.id)
  })
  it("replaces an expired checkout only after its terminal state is confirmed in the database", async () => {
    const replacement = "10000000-0000-4000-8000-000000000006"
    mocks.caller.mockResolvedValueOnce({ data: { is_new: false, attempt: mappedAttempt(), invoice: { invoice_number: "Synthetic", period_label: null } }, error: null })
      .mockImplementationOnce(async () => {
        expect(stored.status).toBe("expired")
        return { data: { is_new: true, attempt: { ...attempt, id: replacement }, invoice: { invoice_number: "Synthetic", period_label: null } }, error: null }
      })
    mocks.fetch.mockResolvedValue({ ...remote, status: "expired" })
    mocks.create.mockResolvedValue({ ...remote, metadata: { ...remote.metadata, attempt_id: replacement } })
    mocks.admin.mockResolvedValue({ data: { id: replacement, provider_invoice_id: remote.id, checkout_url: remote.url, amount_halalas: 11500, status: "initiated" }, error: null })
    expect(await startCardCheckout(input)).toEqual({ url: remote.url })
    expect(mocks.caller).toHaveBeenCalledTimes(2)
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
  it("keeps an existing reservation when provider state is unknown", async () => {
    mocks.caller.mockResolvedValue({ data: { is_new: false, attempt: mappedAttempt(), invoice: { invoice_number: "Synthetic", period_label: null } }, error: null })
    mocks.fetch.mockRejectedValue(Error("timeout"))
    expect(await startCardCheckout(input)).not.toHaveProperty("url")
    expect(mocks.caller).toHaveBeenCalledTimes(1)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(stored.status).toBe("initiated")
  })
  it("returns to app confirmation when an existing checkout is already paid", async () => {
    mocks.caller.mockResolvedValue({ data: { is_new: false, attempt: mappedAttempt(), invoice: { invoice_number: "Synthetic", period_label: null } }, error: null })
    mocks.fetch.mockResolvedValue({ ...remote, status: "paid", payments: [{ id: "synthetic-payment", status: "paid", amount: 11500 }] })
    expect(await startCardCheckout(input)).toEqual({ url: "https://synthetic.example/settings/billing?attempt=" + attemptId })
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it("refuses a tenant-mismatched claim before calling the provider", async () => {
    mocks.caller.mockResolvedValue({ data: { is_new: true, attempt: { ...attempt, tenant_id: actor }, invoice: { invoice_number: "Synthetic", period_label: null } }, error: null })
    expect(await startCardCheckout(input)).not.toHaveProperty("url")
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it("preserves refund-required duplicate outcomes on repeated confirmation", async () => {
    const chain = { eq: () => chain, maybeSingle: async () => ({ data: { ...attempt, status: "paid", provider_invoice_id: remote.id, failure_reason: "Captured after the invoice was already paid; refund required" } }) }
    mocks.from.mockReturnValue({ select: () => chain })
    expect(await reconcileAttempt({ attemptId, tenantId: tenant })).toBe("duplicate_payment")
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it("does not make provider or database calls when the configured mode is unavailable", async () => {
    mocks.configured.mockReturnValue(false)
    expect(await startCardCheckout(input)).not.toHaveProperty("url")
    expect(await reconcileAttempt({ attemptId })).toBe("unknown")
    expect(mocks.caller).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

describe("late provider observations", () => {
  it.each(["expired", "failed", "canceled"])("never overwrites paid with a stale %s response", async status => {
    mocks.fetch.mockImplementationOnce(async () => {
      // A second, verified callback settled while this request was in flight.
      stored.status = "paid"
      return { ...remote, status }
    })
    expect(await reconcileAttempt({ attemptId, tenantId: tenant })).toBe("already_settled")
    expect(stored.status).toBe("paid")
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it("preserves a concurrent refund-required outcome", async () => {
    mocks.fetch.mockImplementationOnce(async () => {
      stored.status = "paid"
      stored.failure_reason = "Captured after the invoice was already paid; refund required"
      return { ...remote, status: "expired" }
    })
    expect(await reconcileAttempt({ attemptId, tenantId: tenant })).toBe("duplicate_payment")
    expect(stored.status).toBe("paid")
  })
  it("does not release an expired reservation when its status transition is unconfirmed", async () => {
    mocks.caller.mockResolvedValue({ data: { is_new: false, attempt: mappedAttempt(), invoice: { invoice_number: "Synthetic", period_label: null } }, error: null })
    mocks.fetch.mockResolvedValue({ ...remote, status: "expired" })
    transitionError = true
    expect(await startCardCheckout(input)).not.toHaveProperty("url")
    expect(mocks.caller).toHaveBeenCalledTimes(1)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(stored.status).toBe("initiated")
  })
  it("checks zero-row transitions instead of assuming they committed", async () => {
    mocks.fetch.mockResolvedValue({ ...remote, status: "expired" })
    refuseTransition = true
    expect(await reconcileAttempt({ attemptId, tenantId: tenant })).toBe("pending")
    expect(stored.status).toBe("initiated")
  })
  it("rejects a mismatched non-paid invoice before changing local state", async () => {
    mocks.fetch.mockResolvedValue({ ...remote, status: "expired", metadata: { ...remote.metadata, tenant_id: "foreign" } })
    expect(await reconcileAttempt({ attemptId, tenantId: tenant })).toBe("mismatch")
    expect(stored.status).toBe("initiated")
  })
  it("does not return an active checkout after a concurrent paid callback", async () => {
    mocks.caller.mockResolvedValue({ data: { is_new: false, attempt: mappedAttempt(), invoice: { invoice_number: "Synthetic", period_label: null } }, error: null })
    mocks.fetch.mockImplementationOnce(async () => { stored.status = "paid"; return { ...remote, status: "initiated" } })
    expect(await startCardCheckout(input)).toEqual({ url: "https://synthetic.example/settings/billing?attempt=" + attemptId })
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it("fails closed when the current attempt cannot be read", async () => {
    readError = true
    expect(await reconcileAttempt({ attemptId, tenantId: tenant })).toBe("unknown")
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it("does not infer success when the concurrent winner cannot be re-read", async () => {
    mocks.fetch.mockImplementationOnce(async () => { stored.status = "paid"; readError = true; return { ...remote, status: "expired" } })
    expect(await reconcileAttempt({ attemptId, tenantId: tenant })).toBe("unknown")
    expect(stored.status).toBe("paid")
  })
})
