import { Writable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import pino from "pino"
import { scrubSentryTelemetry, scrubTelemetry, scrubTelemetryLogLine, scrubTelemetrySpan, scrubTelemetryText } from "./telemetry-privacy"

const fabricated = "fabricated-private-value-8462"
const jwt = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.fabricatedSignature"
const sentry = vi.hoisted(() => ({ configurations: [] as Record<string, unknown>[] }))
vi.mock("@sentry/nextjs", () => ({
  init: (configuration: Record<string, unknown>) => { sentry.configurations.push(configuration) },
  replayIntegration: () => ({ name: "Replay" }),
  captureRouterTransitionStart: vi.fn(),
}))

describe("outbound telemetry privacy", () => {
  it.each(["password", "access_token", "refreshToken", "api-key", "x-vercel-protection-bypass", "x-vercel-trusted-oidc-idp-token", "service_role_key", "Authorization", "Cookie", "Set-Cookie", "private_key", "clientSecret", "credential", "bank_account", "iban", "national_id", "iqama", "email", "phone", "salary", "netAmount", "userAgent", "ipAddress"])("filters nested %s through arrays without changing input", (key) => {
    const input = { contexts: { nested: [{ [key]: fabricated, status: 403 }] } }
    const output = scrubTelemetry(input)
    expect(JSON.stringify(output)).not.toContain(fabricated)
    expect(output.contexts.nested[0][key]).toBe("[Filtered]")
    expect(output.contexts.nested[0].status).toBe(403)
    expect(input.contexts.nested[0][key]).toBe(fabricated)
  })

  it("omits complete request bodies/headers/query strings, user and local variable data", () => {
    const output = scrubTelemetry({ request: { data: { arbitrary: fabricated }, headers: { "x-custom": fabricated }, cookies: fabricated, env: { VALUE: fabricated }, method: "POST" }, query_string: fabricated, user: { username: fabricated }, exception: { values: [{ stacktrace: { frames: [{ vars: { value: fabricated } }] } }] } })
    expect(JSON.stringify(output)).not.toContain(fabricated)
    expect(output.request.method).toBe("POST")
  })

  it.each([
    "https://user:" + fabricated + "@example.test/storage/v1/object/sign/private/business.pdf?token=" + fabricated + "#" + fabricated,
    "POST https://api.telegram.org/bot123456789:" + fabricated + "/sendDocument",
    "postgresql://postgres:" + fabricated + "@example.test:5432/postgres",
    "redis://default:" + fabricated + "@example.test:6379",
    "C:\\Users\\" + fabricated + "\\Downloads\\invoice.pdf",
    "Bearer " + fabricated,
    "Basic " + fabricated,
    jwt,
    "password=" + fabricated,
    "access_token: '" + fabricated + "'",
    "{\"api_key\":\"" + fabricated + "\"}",
    "x-vercel-protection-bypass: " + fabricated,
    "GET /storage/sign/customer/private.pdf?download=" + fabricated,
    "sb_secret_" + fabricated,
    "-----BEGIN EC PRIVATE KEY-----\n" + fabricated + "\n-----END EC PRIVATE KEY-----",
  ])("scrubs credentials in error text: case %#", (text) => {
    const output = scrubTelemetryText(text)
    expect(output).not.toContain(fabricated)
    expect(output).not.toContain(jwt)
  })

  it("drops relative URL capabilities and preserves only absolute HTTP origins", () => {
    const result = scrubTelemetry({ url: "/auth/callback?code=" + fabricated, request: { url: "https://app.example.test/invoices/private?download=" + fabricated }, data: { "http.url": "https://api.example.test/private/customer#" + fabricated, filename: "business-private.pdf" } })
    expect(result.url).toBe("[Filtered]")
    expect(result.request.url).toBe("https://app.example.test/[Filtered]")
    expect(result.data["http.url"]).toBe("https://api.example.test/[Filtered]")
    expect(result.data.filename).toBe("[Filtered]")
    expect(JSON.stringify(result)).not.toContain(fabricated)
  })

  it("masks recognizable contact/bank values in text", () => {
    const text = "contact person@example.test at 0501234567 / +966501234567; SA0380000000608010167519"
    const result = scrubTelemetryText(text)
    expect(result).not.toMatch(/person@|0501234567|966501234567|SA0380000000608010167519/)
  })

  it("does not invoke getters, toJSON, custom instances or inherited properties", () => {
    const getter = vi.fn(() => fabricated)
    const input = { get unsafe() { return getter() }, toJSON: vi.fn(() => ({ leak: fabricated })), object: new URL("https://example.test/?" + fabricated) }
    const result = scrubTelemetry(input)
    expect(getter).not.toHaveBeenCalled()
    expect(input.toJSON).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain(fabricated)
    expect(result.unsafe).toBe("[Filtered]")
    expect(scrubTelemetry(Object.create({ inherited: fabricated }))).toBe("[Filtered]")
  })

  it("bounds cycles, depth, width, text and nodes and fails closed for hostile proxies", () => {
    const cyclic: { child?: unknown } = {}; cyclic.child = cyclic
    expect(scrubTelemetry(cyclic).child).toBe("[Filtered]")
    let deep: unknown = { token: fabricated }
    for (let i = 0; i < 100; i++) deep = { child: deep }
    expect(JSON.stringify(scrubTelemetry(deep))).not.toContain(fabricated)
    expect(scrubTelemetryText("x".repeat(4096) + fabricated)).toBe("[Truncated]")
    expect(scrubTelemetry(Array.from({ length: 1000 }, () => "safe"))).toHaveLength(65)
    expect(JSON.stringify(scrubTelemetry(Object.fromEntries(Array.from({ length: 100 }, (_, i) => ["field" + i, "safe"]))))).toContain("[Truncated]")
    const broad = Array.from({ length: 64 }, () => Object.fromEntries(Array.from({ length: 64 }, (_, i) => ["field" + i, "safe"])))
    expect(JSON.stringify(scrubTelemetry(broad)).length).toBeLessThan(20000)
    expect(scrubTelemetry(new Proxy({}, { ownKeys() { throw Error(fabricated) } }))).toBe("[Filtered]")
  })

  it("does not preserve prototype-pollution keys or credentials carried in keys", () => {
    const input = JSON.parse('{"__proto__":{"polluted":true},"constructor":"unsafe","prototype":"unsafe","safe":1}')
    input[jwt] = fabricated
    const output = scrubTelemetry(input)
    expect(Object.getPrototypeOf(output)).toBeNull()
    expect(Object.keys(output)).toEqual(["safe"])
    expect(Object.prototype.hasOwnProperty.call({}, "polluted")).toBe(false)
  })

  it("scrubs actual Pino output after child bindings, error serialization and interpolation", async () => {
    const chunks: string[] = []
    const stream = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback() } })
    const log = pino({ hooks: { streamWrite: scrubTelemetryLogLine } }, stream)
      .child({ module: "privacy-test", nested: { authorization: fabricated } })
    log.error({ err: new Error("request failed: Bearer " + fabricated), code: "TEST403", status: 403 }, "request failed %s", "https://example.test/?token=" + fabricated)
    log.info({ details: [{ privateKey: fabricated }] }, "retry complete")
    await new Promise<void>((resolve) => stream.end(resolve))
    expect(chunks).toHaveLength(2)
    expect(chunks.join("")).not.toContain(fabricated)
    const error = JSON.parse(chunks[0])
    expect(error.module).toBe("privacy-test")
    expect(error.code).toBe("TEST403")
    expect(error.status).toBe(403)
    expect(error.err.type).toBe("Error")
    expect(error.err.stack).toContain("Error:")
    expect(error.msg).toContain("https://example.test/[Filtered]")
  })

  it("never emits an unsanitized invalid or oversized log line", () => {
    for (const value of [fabricated, "{bad:" + fabricated, JSON.stringify([fabricated]), JSON.stringify({ msg: "x".repeat(65536) + fabricated })]) {
      const result = scrubTelemetryLogLine(value)
      expect(result).not.toContain(fabricated)
      expect(JSON.parse(result).level).toBe(40)
    }
  })

  it("keeps valid SDK protocol fields and omits optional undefined fields", () => {
    const event = { event_id: "a".repeat(32), type: "transaction", user: { email: fabricated }, request: { method: "POST", headers: { Authorization: fabricated }, data: { value: fabricated } }, spans: [{ trace_id: "a".repeat(32), span_id: "b".repeat(16), start_timestamp: 123, data: { "http.status_code": 403 }, timestamp: undefined }] }
    const result = scrubSentryTelemetry(event)
    expect(result).not.toBeNull()
    expect(result).not.toHaveProperty("user")
    expect(result?.request).toEqual({ method: "POST" })
    expect(result?.spans[0].data).toEqual({ "http.status_code": 403 })
    expect(JSON.parse(JSON.stringify(result)).spans[0]).not.toHaveProperty("timestamp")
  })

  it("drops over-budget SDK events and keeps a schema-valid minimal span", () => {
    const spans = Array.from({ length: 1000 }, () => ({ data: { value: fabricated } }))
    expect(scrubSentryTelemetry({ spans })).toBeNull()
    const span = { trace_id: "a".repeat(32), span_id: "b".repeat(16), start_timestamp: 123, timestamp: 124, data: Object.fromEntries(Array.from({ length: 100 }, (_, i) => ["key" + i, fabricated])) }
    const result = scrubTelemetrySpan(span)
    expect(result).toEqual({ trace_id: "a".repeat(32), span_id: "b".repeat(16), start_timestamp: 123, timestamp: 124, description: "[Filtered]", data: {} })
    expect(JSON.stringify(result)).not.toContain(fabricated)
  })

  it("initializes every Sentry runtime with effective privacy hooks and default PII disabled", async () => {
    await import("../../sentry.server.config")
    await import("../../sentry.edge.config")
    await import("../instrumentation-client")
    expect(sentry.configurations).toHaveLength(3)
    const input = { event_id: "a".repeat(32), trace_id: "a".repeat(32), span_id: "b".repeat(16), start_timestamp: 123, data: { nested: { accessToken: fabricated } }, message: "Bearer " + fabricated }
    for (const configuration of sentry.configurations) {
      expect(configuration.sendDefaultPii).toBe(false)
      for (const hook of ["beforeSend", "beforeSendTransaction", "beforeSendSpan", "beforeBreadcrumb", "beforeSendLog"]) {
        expect(configuration[hook]).toBeTypeOf("function")
        const result = (configuration[hook] as (input: object) => object | null)(input)
        expect(result).not.toBeNull()
        expect(JSON.stringify(result)).not.toContain(fabricated)
        expect(result).toHaveProperty("event_id", input.event_id)
      }
    }
  })
})
