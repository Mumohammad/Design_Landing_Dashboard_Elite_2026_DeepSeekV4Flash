import { afterEach, describe, expect, it, vi } from "vitest"
import { transmitToZatca, isSandboxTransport, _sandboxUuid } from "./zatca-transport"
import {
  buildSigningInput,
  computeInvoiceHash,
  generateZatcaKeyPair,
  verifyZatcaPayload,
} from "./zatca-crypto"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("transmitToZatca (sandbox mode)", () => {
  it("returns a reported status + UUID for reporting pipeline", async () => {
    const res = await transmitToZatca({
      xml: "<Invoice/>",
      pipeline: "reporting",
      docRef: "INV-2026-000001",
    })
    expect(res.status).toBe("reported")
    expect(res.uuid).toMatch(/^[0-9a-f-]{36}$/)
    expect(res.raw.sandbox).toBe(true)
    expect((res.raw.validationResults as { status?: string } | undefined)?.status).toBe("PASSED")
  })

  it("returns cleared for the clearance pipeline", async () => {
    const res = await transmitToZatca({
      xml: "<Invoice/>",
      pipeline: "clearance",
      docRef: "INV-2026-000002",
    })
    expect(res.status).toBe("cleared")
  })

  it("is deterministic per doc ref (replay-safe)", async () => {
    const a = await transmitToZatca({ xml: "<Invoice/>", pipeline: "reporting", docRef: "INV-X" })
    const b = await transmitToZatca({ xml: "<Invoice/>", pipeline: "reporting", docRef: "INV-X" })
    expect(a.uuid).toBe(b.uuid)
  })

  it("produces different UUIDs for different docs", async () => {
    expect(_sandboxUuid("INV-A")).not.toBe(_sandboxUuid("INV-B"))
  })

  it("reports sandbox mode when no ZATCA env is configured", () => {
    expect(isSandboxTransport()).toBe(true)
  })

  it("reports sandbox mode with partial config (base alone, or base + cert without secret)", () => {
    vi.stubEnv("ZATCA_API_BASE_URL", "https://zatca.example.test")
    expect(isSandboxTransport()).toBe(true) // CSID creds missing
    vi.stubEnv("ZATCA_CSID_CERT", "cert-b64")
    expect(isSandboxTransport()).toBe(true) // secret still missing
    vi.stubEnv("ZATCA_API_BASE_URL", "") // base empty → still sandbox
    expect(isSandboxTransport()).toBe(true)
  })
})

describe("transmitToZatca (production POST path — exercised with a mocked HTTP layer)", () => {
  it("reported-invoice POST: correct endpoint, XML content type, Basic CSID auth, body, and response mapping", async () => {
    vi.stubEnv("ZATCA_API_BASE_URL", "https://zatca.example.test/") // trailing slash must be stripped
    vi.stubEnv("ZATCA_CSID_CERT", "TUlJQ1BUQ0NBZU9n--cert-b64")
    vi.stubEnv("ZATCA_CSID_SECRET", "secret-key-123")
    const captured: { url: string; init: RequestInit } = { url: "", init: {} }
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      captured.url = url
      captured.init = init
      return {
        ok: true,
        status: 200,
        json: async () => ({ reportedInvoiceUuid: "11111111-1111-4111-8111-111111111111", status: "REPORTED" }),
      }
    })
    vi.stubGlobal("fetch", fetchMock)

    const res = await transmitToZatca({
      xml: "<Invoice>payload</Invoice>",
      pipeline: "reporting",
      docRef: "INV-2026-000010",
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(captured.url).toBe("https://zatca.example.test/invoices/reporting/single")
    expect(captured.init.method).toBe("POST")
    expect((captured.init.headers as Record<string, string>)["Content-Type"]).toBe("application/xml")
    // ZATCA reporting auth = Basic (binarySecurityToken:secret), NOT Bearer.
    expect((captured.init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("TUlJQ1BUQ0NBZU9n--cert-b64:secret-key-123").toString("base64")}`
    )
    expect(captured.init.body).toBe("<Invoice>payload</Invoice>")
    // Response mapping: uuid taken from reportedInvoiceUuid, status from pipeline.
    expect(res.status).toBe("reported")
    expect(res.uuid).toBe("11111111-1111-4111-8111-111111111111")
    expect(res.raw.sandbox).toBeUndefined()
    expect(res.raw.status).toBe("REPORTED")
  })

  it("clearance pipeline POSTs to the clearance endpoint and maps status to cleared", async () => {
    vi.stubEnv("ZATCA_API_BASE_URL", "https://zatca.example.test")
    vi.stubEnv("ZATCA_CSID_CERT", "cert-b64")
    vi.stubEnv("ZATCA_CSID_SECRET", "secret-key-123")
    const captured: { url: string; init: RequestInit } = { url: "", init: {} }
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      captured.url = url
      captured.init = init
      return {
        ok: true,
        status: 200,
        json: async () => ({ uuid: "22222222-2222-4222-8222-222222222222" }),
      }
    })
    vi.stubGlobal("fetch", fetchMock)

    const res = await transmitToZatca({
      xml: "<Invoice/>",
      pipeline: "clearance",
      docRef: "INV-2026-000011",
    })

    expect(captured.url).toBe("https://zatca.example.test/invoices/clearance/single")
    expect(captured.init.method).toBe("POST")
    expect(captured.init.body).toBe("<Invoice/>")
    expect(res.status).toBe("cleared")
    // uuid falls back to the generic `uuid` field when reportedInvoiceUuid is absent.
    expect(res.uuid).toBe("22222222-2222-4222-8222-222222222222")
  })

  it("explicit DB-backed credentials override env (Basic auth built from them)", async () => {
    // Fully misconfigured env — only the base URL is set; the DB credentials
    // must activate the production path anyway.
    vi.stubEnv("ZATCA_API_BASE_URL", "https://zatca.example.test")
    const captured: { url: string; init: RequestInit } = { url: "", init: {} }
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      captured.url = url
      captured.init = init
      return { ok: true, status: 200, json: async () => ({ uuid: "33333333-3333-4333-8333-333333333333" }) }
    })
    vi.stubGlobal("fetch", fetchMock)

    const res = await transmitToZatca({
      xml: "<Invoice/>",
      pipeline: "reporting",
      docRef: "INV-2026-000013",
      credentials: { csidBase64: "DB-CERT", secret: "DB-SECRET" },
    })

    expect(captured.init.method).toBe("POST")
    expect((captured.init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("DB-CERT:DB-SECRET").toString("base64")}`
    )
    expect(res.status).toBe("reported")
  })

  it("signs the payload with the DB-backed private key and injects the signature into the XML", async () => {
    vi.stubEnv("ZATCA_API_BASE_URL", "https://zatca.example.test")
    const keyPair = generateZatcaKeyPair()
    const captured: { url: string; init: RequestInit } = { url: "", init: {} }
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      captured.url = url
      captured.init = init
      return { ok: true, status: 200, json: async () => ({ uuid: "44444444-4444-4444-8444-444444444444" }) }
    })
    vi.stubGlobal("fetch", fetchMock)

    // The UBL builder emits this placeholder for exactly this purpose.
    const xml = "<Invoice><cac:Signature><ds:SignatureValue></ds:SignatureValue></cac:Signature></Invoice>"
    await transmitToZatca({
      xml,
      pipeline: "reporting",
      docRef: "INV-2026-000015",
      credentials: {
        csidBase64: "DB-CERT",
        secret: "DB-SECRET",
        privateKeyPem: keyPair.privateKeyPem,
      },
    })

    // The signature was injected into the placeholder, and the body sent is the signed XML.
    const body = captured.init.body as string
    expect(body).toContain("<ds:SignatureValue>")
    expect(body).not.toContain("<ds:SignatureValue></ds:SignatureValue>")
    const signatureBase64 = body.match(/<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/)?.[1]
    expect(signatureBase64).toBeTruthy()

    // The injected signature must verify against the DB-backed public key over
    // the same signing input the transport builds (hash of the ORIGINAL XML +
    // the UTC signing time truncated to the second). Allow a ±1s window so the
    // check can't race a second-boundary rollover between the transport's
    // signing time and ours.
    const invoiceHash = computeInvoiceHash(xml)
    const now = new Date()
    const windowSeconds = [-1, 0, 1]
      .map((d) => new Date(now.getTime() + d * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"))
      .map((iso) => buildSigningInput(invoiceHash, iso))
    expect(windowSeconds.some((input) => verifyZatcaPayload(input, signatureBase64!, keyPair.publicKeyPem))).toBe(true)
  })

  it("does not sign when no private key is available (env or DB)", async () => {
    vi.stubEnv("ZATCA_API_BASE_URL", "https://zatca.example.test")
    vi.stubEnv("ZATCA_CSID_CERT", "cert-b64")
    vi.stubEnv("ZATCA_CSID_SECRET", "secret-key-123")
    const captured: { url: string; init: RequestInit } = { url: "", init: {} }
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      captured.url = url
      captured.init = init
      return { ok: true, status: 200, json: async () => ({ uuid: "55555555-5555-4555-8555-555555555555" }) }
    })
    vi.stubGlobal("fetch", fetchMock)

    const xml = "<Invoice><cac:Signature><ds:SignatureValue></ds:SignatureValue></cac:Signature></Invoice>"
    await transmitToZatca({ xml, pipeline: "reporting", docRef: "INV-2026-000016" })

    // No private key → the placeholder is left untouched (unsigned payload).
    expect(captured.init.body).toBe(xml)
  })

  it("stays in sandbox with explicit credentials but no gateway base URL", async () => {
    vi.stubEnv("ZATCA_API_BASE_URL", "")
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    vi.stubGlobal("fetch", fetchMock)

    const res = await transmitToZatca({
      xml: "<Invoice/>",
      pipeline: "reporting",
      docRef: "INV-2026-000014",
      credentials: { csidBase64: "DB-CERT", secret: "DB-SECRET" },
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.raw.sandbox).toBe(true)
  })

  it("throws with the HTTP status + body on a non-OK response", async () => {
    vi.stubEnv("ZATCA_API_BASE_URL", "https://zatca.example.test")
    vi.stubEnv("ZATCA_CSID_CERT", "cert-b64")
    vi.stubEnv("ZATCA_CSID_SECRET", "secret-key-123")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => "unauthorized",
      }))
    )

    await expect(
      transmitToZatca({ xml: "<Invoice/>", pipeline: "reporting", docRef: "INV-2026-000012" })
    ).rejects.toThrow("ZATCA transport error 401: unauthorized")
  })

  it("isSandboxTransport() flips to false only when base + CSID cert + secret are all configured", () => {
    vi.stubEnv("ZATCA_API_BASE_URL", "https://zatca.example.test")
    expect(isSandboxTransport()).toBe(true)
    vi.stubEnv("ZATCA_CSID_CERT", "cert-b64")
    expect(isSandboxTransport()).toBe(true)
    vi.stubEnv("ZATCA_CSID_SECRET", "secret-key-123")
    expect(isSandboxTransport()).toBe(false)
  })
})
