// SSRF guard for outbound webhook URLs (audit fix H3).
//
// String-checking the hostname is NOT sufficient: a public domain can
// A-record to 169.254.169.254, and a public URL can 302 into the cloud
// metadata endpoint. This module therefore:
//   1. requires https (webhooks carry HMAC-signed payloads),
//   2. blocklists known cloud-metadata hostnames,
//   3. resolves the hostname with dns.lookup(all) and rejects if ANY
//      resolved address is private / loopback / link-local / reserved
//      (IPv4 and IPv6, including IPv4-mapped and NAT64-embedded IPv4).
//
// The dispatcher follows redirects with `redirect: "manual"` and re-validates
// EVERY Location hop through assertSafeWebhookUrl.
//
// Residual risk (documented, accepted for this minimal-diff pass): DNS
// rebinding TOCTOU — the guard resolves the hostname, then fetch() resolves
// it again. Pinning the validated IP onto the connection requires a custom
// undici dispatcher / http.Agent (new dependency → out of scope). The
// registration-time + delivery-time + per-hop checks close the reported
// vector (attacker-controlled webhook URL pointing at private space).

import dns from "dns"

export class WebhookUrlBlockedError extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(`Webhook URL blocked: ${reason}`)
    this.name = "WebhookUrlBlockedError"
    this.reason = reason
  }
}

/** Known cloud metadata endpoints — blocked by hostname as belt-and-braces (the DNS checks catch them too). */
const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
  "instance-data",
  "instance-data.ec2.internal",
  "metadata.ec2.internal",
  "169.254.169.254",
  "fd00:ec2::254",
])

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
]

// ── IPv4 ───────────────────────────────────────────────────────────────────

function parseIPv4(ip: string): number | null {
  const parts = ip.split(".")
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    value = value * 256 + n
  }
  return value >>> 0
}

const BLOCKED_IPV4_RANGES = [
  "0.0.0.0/8", // "this network" (incl. 0.0.0.0)
  "10.0.0.0/8", // private
  "100.64.0.0/10", // CGNAT
  "127.0.0.0/8", // loopback
  "169.254.0.0/16", // link-local (cloud metadata: 169.254.169.254)
  "172.16.0.0/12", // private
  "192.0.0.0/24", // IETF protocol assignments
  "192.0.2.0/24", // TEST-NET-1
  "192.168.0.0/16", // private
  "198.18.0.0/15", // benchmarking
  "198.51.100.0/24", // TEST-NET-2
  "203.0.113.0/24", // TEST-NET-3
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved (incl. 255.255.255.255)
]

function ipv4InRange(ip: string, cidr: string): boolean {
  const value = parseIPv4(ip)
  if (value === null) return false
  const [baseStr, bitsStr] = cidr.split("/")
  const base = parseIPv4(baseStr)
  if (base === null) return false
  const bits = Number(bitsStr)
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (value & mask) === (base & mask)
}

// ── IPv6 ───────────────────────────────────────────────────────────────────

/** Expand an IPv6 address to its 32-hex-char form ("::1" → 31 zeros + "1"). */
function expandIPv6(ip: string): string | null {
  let s = ip.split("%")[0].toLowerCase()
  if (!s.includes(":")) return null
  // IPv4-embedded tail (::ffff:1.2.3.4) → convert the tail to hex groups.
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":")
    const v4 = parseIPv4(s.slice(lastColon + 1))
    if (v4 === null) return null
    s = `${s.slice(0, lastColon + 1)}${(v4 >> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`
  }
  const dbl = s.split("::")
  if (dbl.length > 2) return null
  let groups: string[]
  if (dbl.length === 2) {
    const left = dbl[0] ? dbl[0].split(":") : []
    const right = dbl[1] ? dbl[1].split(":") : []
    const fill = 8 - left.length - right.length
    if (fill < 0) return null
    groups = [...left, ...Array<string>(fill).fill("0"), ...right]
  } else {
    groups = s.split(":")
  }
  if (groups.length !== 8) return null
  return groups.map((g) => g.padStart(4, "0")).join("")
}

/** Extract the embedded IPv4 (last 8 hex chars) for v4-embedded v6 ranges. */
function embeddedIPv4(expanded: string): string {
  const bytes = []
  for (let i = 24; i < 32; i += 2) {
    bytes.push(parseInt(expanded.slice(i, i + 2), 16))
  }
  return bytes.join(".")
}

/**
 * True when the (expanded) IPv6 address is private / loopback / link-local /
 * reserved, or embeds a blocked IPv4 address.
 */
function isBlockedIPv6(expanded: string): boolean {
  // :: (unspecified) and ::1 (loopback)
  if (expanded === "00000000000000000000000000000000") return true
  if (expanded === "00000000000000000000000000000001") return true
  // ::ffff:0:0/96 — IPv4-mapped → check the embedded IPv4
  if (expanded.startsWith("00000000000000000000ffff")) {
    return isBlockedAddress(embeddedIPv4(expanded))
  }
  // 64:ff9b::/96 — NAT64 → check the embedded IPv4
  if (expanded.startsWith("0064ff9b") && expanded.slice(8, 24) === "0000000000000000") {
    return isBlockedAddress(embeddedIPv4(expanded))
  }
  // 2002::/16 — 6to4 (deprecated): block outright. The embedded IPv4 sits at
  // hex offset 4-12, not the last 32 bits, so extraction here is error-prone
  // for no benefit — no legitimate webhook target uses 6to4.
  if (expanded.startsWith("2002")) return true
  // 100::/64 — discard-only
  if (expanded.startsWith("0100000000000000")) return true
  // 2001::/32 — Teredo
  if (expanded.startsWith("20010000")) return true
  // 2001:db8::/32 — documentation
  if (expanded.startsWith("20010db8")) return true
  // fc00::/7 — unique local addresses (incl. EC2 IPv6 metadata fd00:ec2::254)
  if (expanded[0] === "f" && (expanded[1] === "c" || expanded[1] === "d")) return true
  // fe80::/10 — link-local
  if (expanded[0] === "f" && expanded[1] === "e" && "89ab".includes(expanded[2])) return true
  // fec0::/10 — deprecated site-local
  if (expanded.startsWith("fec")) return true
  // ff00::/8 — multicast
  if (expanded[0] === "f" && expanded[1] === "f") return true
  return false
}

/**
 * True when the (expanded) IPv6 address (v4 or v6) falls in a blocked
 * private/loopback/link-local/reserved range. Unknown formats fail CLOSED.
 */
export function isBlockedAddress(ip: string): boolean {
  if (parseIPv4(ip) !== null) {
    return BLOCKED_IPV4_RANGES.some((cidr) => ipv4InRange(ip, cidr))
  }
  const expanded = expandIPv6(ip)
  if (expanded === null) return true // unparseable → fail closed
  return isBlockedIPv6(expanded)
}

// ── Public API ─────────────────────────────────────────────────────────────

export type UrlGuardVerdict =
  | { ok: true; url: string }
  | { ok: false; reason: string }

/**
 * Validate a webhook URL for SSRF safety: https-only scheme, no metadata
 * hostnames, and (for hostnames) every resolved address must be public.
 * Used at REGISTRATION time, at DELIVERY time, and on every redirect hop.
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<UrlGuardVerdict> {
  if (!rawUrl || rawUrl.length > 2048) {
    return { ok: false, reason: "URL missing or too long" }
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, reason: "URL is not parseable" }
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "only https:// URLs are accepted" }
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "")

  if (!hostname) {
    return { ok: false, reason: "URL has no hostname" }
  }
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: `hostname is a known metadata endpoint (${hostname})` }
  }
  if (hostname === "localhost" || BLOCKED_HOSTNAME_SUFFIXES.some((s) => hostname.endsWith(s))) {
    return { ok: false, reason: `hostname is not allowed (${hostname})` }
  }

  // IP-literal hosts are checked directly; hostnames are resolved and EVERY
  // resolved address is validated (a public domain can A-record to a
  // link-local metadata address).
  const isIpLiteral = parseIPv4(hostname) !== null || hostname.includes(":")
  if (isIpLiteral) {
    if (isBlockedAddress(hostname)) {
      return { ok: false, reason: `IP ${hostname} is in a blocked (private/loopback/link-local) range` }
    }
    return { ok: true, url: parsed.toString() }
  }

  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true })
  } catch (err) {
    return {
      ok: false,
      reason: `hostname does not resolve (${err instanceof Error ? err.message : "dns error"})`,
    }
  }
  if (!addresses || addresses.length === 0) {
    return { ok: false, reason: "hostname does not resolve" }
  }
  const blocked = addresses.find((a) => isBlockedAddress(a.address))
  if (blocked) {
    return {
      ok: false,
      reason: `hostname ${hostname} resolves to a blocked address (${blocked.address})`,
    }
  }
  return { ok: true, url: parsed.toString() }
}
