// Unit tests for the SSRF url-guard (audit fix H3) and the dispatcher's
// manual-redirect hop validation.
//
// Run: pnpm exec vitest run src/lib/webhooks/url-guard.test.ts

import { describe, expect, it, vi, afterEach } from "vitest"
import dns from "dns"
import {
  assertSafeWebhookUrl,
  isBlockedAddress,
  WebhookUrlBlockedError,
} from "./url-guard"
import { postFollowingRedirects } from "./dispatcher"

// ── isBlockedAddress — IPv4 ────────────────────────────────────────────────

describe("isBlockedAddress — IPv4", () => {
  it.each([
    "127.0.0.1", // loopback
    "127.8.8.8", // loopback range
    "10.1.2.3", // private
    "172.16.0.1", // private
    "172.31.255.255", // private upper bound
    "192.168.1.1", // private
    "169.254.169.254", // AWS/GCP metadata
    "169.254.1.1", // link-local
    "0.0.0.0", // unspecified
    "100.64.0.1", // CGNAT
    "224.0.0.1", // multicast
    "240.0.0.1", // reserved
    "255.255.255.255", // broadcast
    "198.18.0.5", // benchmarking
    "192.0.2.9", // TEST-NET-1
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true)
  })

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1", // just outside 172.16/12
    "172.15.255.255", // just below
    "192.169.0.1", // just outside 192.168/16
    "100.128.0.1", // just outside 100.64/10
    "9.9.9.9",
  ])("allows public %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false)
  })

  it("fails closed on unparseable input", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true)
    expect(isBlockedAddress("")).toBe(true)
    expect(isBlockedAddress("1.2.3.4.5")).toBe(true)
  })
})

// ── isBlockedAddress — IPv6 ────────────────────────────────────────────────

describe("isBlockedAddress — IPv6", () => {
  it.each([
    "::1", // loopback
    "::", // unspecified
    "fe80::1", // link-local
    "fc00::1", // unique local
    "fd00::1", // unique local
    "fd00:ec2::254", // EC2 IPv6 metadata endpoint
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:169.254.169.254", // IPv4-mapped metadata
    "::ffff:10.0.0.1", // IPv4-mapped private
    "64:ff9b::a00:1", // NAT64-embedded 10.0.0.1
    "2002:7f00:1::", // 6to4-embedded 127.0.0.1
    "2001:db8::1", // documentation range
    "ff02::1", // multicast
    "100::1", // discard-only
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true)
  })

  it.each([
    "2606:4700::1111",
    "2001:4860:4860::8888",
    "::ffff:8.8.8.8", // IPv4-mapped public
  ])("allows public %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false)
  })
})

// ── assertSafeWebhookUrl — static checks ──────────────────────────────────

describe("assertSafeWebhookUrl — scheme and hostname checks", () => {
  it.each([
    "http://example.com/hook", // plain http
    "ftp://example.com/hook",
    "javascript:alert(1)",
    "file:///etc/passwd",
  ])("rejects non-https scheme %s", async (url) => {
    const verdict = await assertSafeWebhookUrl(url)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toMatch(/https/i)
  })

  it.each([
    "https://localhost/hook",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://metadata.goog/",
    "https://instance-data.ec2.internal/latest/meta-data/",
    "https://169.254.169.254/latest/meta-data/", // IP literal, no DNS needed
    "https://fd00:ec2::254/latest/meta-data/", // IPv6 metadata literal
    "https://10.0.0.5/hook",
    "https://127.0.0.1/hook",
    "https://internal.example.local/hook",
    "https://host.internal/hook",
    "https://[::1]/hook",
    "https://[fd00::1]/hook",
  ])("rejects blocked host %s", async (url) => {
    const verdict = await assertSafeWebhookUrl(url)
    expect(verdict.ok).toBe(false)
  })

  it("rejects unparseable / missing URLs", async () => {
    expect((await assertSafeWebhookUrl("")).ok).toBe(false)
    expect((await assertSafeWebhookUrl("not a url")).ok).toBe(false)
  })

  it("rejects hostname that does not resolve", async () => {
    const verdict = await assertSafeWebhookUrl("https://no-such-host-elite-dev-invalid.example/hook")
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toMatch(/resolve/i)
  })

  it("error class carries the reason", () => {
    const e = new WebhookUrlBlockedError("test reason")
    expect(e.reason).toBe("test reason")
    expect(e).toBeInstanceOf(Error)
  })
})

// ── DNS resolution checks ─────────────────────────────────────────────────

describe("assertSafeWebhookUrl — resolves hostnames (H3 amendment 3)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("blocks a PUBLIC-looking hostname that RESOLVES to a private IP", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.9", family: 4 },
    ] as never)
    const verdict = await assertSafeWebhookUrl("https://rebind.example.com/hook")
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toMatch(/10\.0\.0\.9/)
  })

  it("blocks a hostname resolving to the cloud metadata address", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "169.254.169.254", family: 4 },
    ] as never)
    const verdict = await assertSafeWebhookUrl("https://evil.example.com/hook")
    expect(verdict.ok).toBe(false)
  })

  it("blocks a hostname resolving to a private IPv6", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "fd00::99", family: 6 },
    ] as never)
    const verdict = await assertSafeWebhookUrl("https://v6.example.com/hook")
    expect(verdict.ok).toBe(false)
  })

  it("allows a hostname that resolves to public addresses only", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ] as never)
    const verdict = await assertSafeWebhookUrl("https://real.example.com/hook")
    expect(verdict.ok).toBe(true)
  })
})

// ── Dispatcher redirect handling ──────────────────────────────────────────

describe("postFollowingRedirects — manual redirects with per-hop guard", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeResponse(status: number, location?: string): Response {
    const headers = new Headers()
    if (location) headers.set("location", location)
    return new Response(null, { status, headers })
  }

  it("returns 2xx responses untouched", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(makeResponse(200))
    const result = await postFollowingRedirects(
      "https://hooks.example.com/x",
      {},
      "{}",
      new AbortController().signal
    )
    expect(result.kind).toBe("response")
    if (result.kind === "response") expect(result.response.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("follows a 307 hop to a VALID public target", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never)
    vi.spyOn(globalThis, "fetch").mockResolvedValue(makeResponse(200))
    const result = await postFollowingRedirects(
      "https://hooks.example.com/x",
      {},
      "{}",
      new AbortController().signal
    )
    expect(result.kind).toBe("response")
    expect(result.kind === "response" && result.response.status).toBe(200)
  })

  it("does NOT follow 301/302/303 (signed POST is never replayed as GET)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(makeResponse(302, "https://metadata.google.internal/"))
    const result = await postFollowingRedirects(
      "https://hooks.example.com/x",
      {},
      "{}",
      new AbortController().signal
    )
    // Returned as the final response → handled as a normal failure by the
    // caller; no second fetch, no metadata request.
    expect(result.kind).toBe("response")
    if (result.kind === "response") expect(result.response.status).toBe(302)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("blocks a 307 chain that redirects INTO the metadata endpoint", async () => {
    // First request returns the 307; the guarded hop is rejected by the
    // url-guard (dns mock) BEFORE any second fetch is attempted.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeResponse(307, "https://169.254.169.254/latest/meta-data/")
    )
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "169.254.169.254", family: 4 },
    ] as never)
    const result = await postFollowingRedirects(
      "https://hooks.example.com/x",
      {},
      "{}",
      new AbortController().signal
    )
    expect(result.kind).toBe("blocked")
    if (result.kind === "blocked") expect(result.reason).toMatch(/169\.254\.169\.254/)
  })

  it("blocks a 307 chain that redirects to a non-resolving host", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeResponse(307, "https://no-such-host-elite-dev-invalid.example/redirect")
    )
    const result = await postFollowingRedirects(
      "https://hooks.example.com/x",
      {},
      "{}",
      new AbortController().signal
    )
    expect(result.kind).toBe("blocked")
  })

  it("blocks a 307 chain that redirects to plain http", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeResponse(307, "http://internal.example.com/hook")
    )
    const result = await postFollowingRedirects(
      "https://hooks.example.com/x",
      {},
      "{}",
      new AbortController().signal
    )
    expect(result.kind).toBe("blocked")
    if (result.kind === "blocked") expect(result.reason).toMatch(/https/i)
  })

  it("caps the redirect chain at MAX_REDIRECT_HOPS", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never)
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => makeResponse(308, "https://loop.example.com/again"))
    const result = await postFollowingRedirects(
      "https://hooks.example.com/x",
      {},
      "{}",
      new AbortController().signal
    )
    expect(result.kind).toBe("response")
    // 1 initial request + 3 followed hops (307/308) = 4 fetches max.
    expect(fetchSpy).toHaveBeenCalledTimes(4)
  })
})
