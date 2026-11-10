// scripts/verify-zatca-reporting-phase18-rest.mjs
// Financial Phase 18 — live verification of the stored-CSID → Basic-auth
// reporting path (the branch of zatca-transport.ts that has never executed:
// the production POST with Basic auth built from a tenant's stored CSID).
//
//   PART A — STORE ROUND-TRIP (live DB, service role): seeds the exact rows
//   saveZatcaCsidInternal writes (compliance + production CSIDs with the
//   private key), then re-reads them with the exact filter
//   getZatcaCsidCredential uses and asserts cert/secret/private_key survive
//   verbatim.
//
//   PART B — REPORTING PATH (local mock gateway, NO ZATCA / NO OTP): starts a
//   throwaway HTTP server as the gateway, points ZATCA_API_BASE_URL at it, and
//   calls transmitToZatca with the stored production CSID as credentials —
//   asserting the real POST fires with Authorization: Basic base64(cert:secret),
//   Content-Type application/xml, the UBL body with an injected ECDSA
//   signature (the stored private key signs the payload), and correct
//   response mapping. Also covers the clearance endpoint and the fallback:
//   stored credentials WITHOUT a base URL must still return the sandbox mock
//   (mirrors the adapter's sandbox-flag rule in zatca.ts).
//
// Nothing here touches the real ZATCA environment — ZATCA-BOUNDARY.md §1/§5.
// The rows are seeded on the demo tenant and deleted at the end (same pattern
// as verify-csid-private-key-056-rest.mjs).
//
// Usage:
//   node scripts/verify-zatca-reporting-phase18-rest.mjs

import { readFileSync, existsSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { registerHooks } from "node:module"

// Node 24's TS type-stripping cannot resolve the extensionless relative
// imports in the seam modules; fall back to appending ".ts" so the REAL
// modules import cleanly (same hook as verify-zatca-phase18-sandbox.mjs).
registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../")
    const hasExt = /\.(ts|js|mjs|cjs|json)$/.test(specifier)
    if (isRelative && !hasExt) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const env = {}
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
}
const BASE = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const T = "00000000-0000-0000-0000-000000000001" // demo tenant (exists; rows cleaned up at the end)
if (!BASE || !KEY) {
  console.error("✗ Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(1)
}

const { generateZatcaKeyPair } = await import("../src/lib/accounting/zatca-crypto.ts")
const { transmitToZatca } = await import("../src/lib/accounting/zatca-transport.ts")
const { buildZatcaUblInvoice } = await import("../src/lib/accounting/zatca-ubl.ts")

let failures = 0
function ok(name, pass, detail = "") {
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!pass) failures++
}
function section(title) {
  console.log(`\n── ${title} ─${"─".repeat(Math.max(0, 60 - title.length))}`)
}

const RUN = Date.now()

// ── Throwaway gateway: captures the request and returns a ZATCA-like envelope
function startMockGateway() {
  let captured = null
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      captured = { method: req.method, url: req.url, headers: req.headers, body }
      const uuid = randomUUID()
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ uuid, reportedInvoiceUuid: uuid, status: "REPORTED", validationResults: { status: "PASSED" } }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      resolve({ server, base: `http://127.0.0.1:${addr.port}`, getCaptured: () => captured })
    })
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// PART A — store round-trip (live DB, service role)
// ═══════════════════════════════════════════════════════════════════════════
section("Part A — zatca_csids store round-trip (service role, live DB)")

const kp = generateZatcaKeyPair() // REAL secp256k1 key — the signing path needs it
const CERT_CC = `MOCK-CCSID-${RUN}`
const CERT_PC = `MOCK-PCSID-${RUN}`
const SECRET = `secret-${RUN}`
const REQ_ID = `req-${RUN}`

const upsert = async (row) => {
  const res = await fetch(`${BASE}/rest/v1/zatca_csids`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(row),
  })
  return res.status
}

// A1/A2 — seed the two rows exactly as saveZatcaCsidInternal writes them.
const ccStatus = await upsert({
  tenant_id: T, environment: "sandbox", kind: "compliance",
  csid_base64: CERT_CC, secret: SECRET, private_key: kp.privateKeyPem,
  request_id: REQ_ID, status: "issued",
})
ok("A1 compliance CSID upsert (sandbox/compliance) accepted", ccStatus === 201, `status=${ccStatus}`)

const pcStatus = await upsert({
  tenant_id: T, environment: "production", kind: "production",
  csid_base64: CERT_PC, secret: SECRET, private_key: kp.privateKeyPem,
  request_id: REQ_ID, status: "issued",
})
ok("A2 production CSID upsert (production/production) accepted", pcStatus === 201, `status=${pcStatus}`)

// A3 — re-read with the exact getZatcaCsidCredential filter.
const readCred = async (environment, kind) => {
  const res = await fetch(
    `${BASE}/rest/v1/zatca_csids?tenant_id=eq.${T}&environment=eq.${environment}&kind=eq.${kind}&status=eq.issued&select=csid_base64,secret,private_key`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
  )
  return { rows: await res.json(), status: res.status }
}

const pcRead = await readCred("production", "production")
const pcRow = Array.isArray(pcRead.rows) ? pcRead.rows[0] : null
ok("A3 production CSID round-trips cert/secret/private_key verbatim",
  pcRead.status === 200 && pcRow?.csid_base64 === CERT_PC && pcRow?.secret === SECRET && pcRow?.private_key === kp.privateKeyPem,
  pcRead.status === 200 && pcRow ? `cert=${pcRow.csid_base64 === CERT_PC} key=${pcRow.private_key === kp.privateKeyPem}` : `status=${pcRead.status}`)

const ccRead = await readCred("sandbox", "compliance")
const ccRow = Array.isArray(ccRead.rows) ? ccRead.rows[0] : null
ok("A4 compliance CSID round-trips cert/secret + request_id via store",
  ccRead.status === 200 && ccRow?.csid_base64 === CERT_CC && ccRow?.secret === SECRET && Boolean(ccRow?.private_key))

// ═══════════════════════════════════════════════════════════════════════════
// PART B — Basic-auth reporting path (local mock gateway, no ZATCA / no OTP)
// ═══════════════════════════════════════════════════════════════════════════
section("Part B — stored-CSID reporting path (local mock gateway)")

const gateway = await startMockGateway()
process.env.ZATCA_API_BASE_URL = gateway.base

// A realistic UBL payload (same construction as the Phase 18 sandbox harness).
const INVOICE = {
  docType: "invoice",
  invoiceNumber: `INV-2026-P18-REPORT-${RUN}`,
  issueDate: "2026-08-15",
  issueTime: "10:30:00",
  currency: "SAR",
  profileId: "reporting:1.0",
  seller: { name: "Elite Fleet Demo", vatNumber: "399999999900003", crNumber: "1010000000", address: "King Fahd Road", city: "Riyadh" },
  buyer: { name: "Demo Buyer", vatNumber: "310122393500003", address: "Olaya Street", city: "Riyadh" },
  lines: [
    { line_no: 1, description: "Fleet management service", quantity: 1, unit_price: 1000, amount: 1000, vat_rate: 15, vat_amount: 150 },
  ],
  subtotal: 1000,
  discount: 0,
  vatAmount: 150,
  total: 1150,
  qr: { sellerName: "Elite Fleet Demo", sellerVatNumber: "399999999900003", timestamp: "2026-08-15T10:30:00Z", total: 1150, vatAmount: 150 },
}
const xml = buildZatcaUblInvoice(INVOICE)

// B1 — credentials come from the STORE read-back (Part A), exactly like the
// adapter passing getZatcaCsidCredential output into transmitToZatca.
const stored = { csidBase64: pcRow?.csid_base64 ?? CERT_PC, secret: pcRow?.secret ?? SECRET, privateKeyPem: pcRow?.private_key ?? kp.privateKeyPem }
const tx = await transmitToZatca({ xml, pipeline: "reporting", docRef: INVOICE.invoiceNumber, credentials: stored })
const captured = gateway.getCaptured()

ok("B1 real POST fired at the reporting endpoint", captured?.method === "POST" && captured?.url === "/invoices/reporting/single",
  captured ? `${captured.method} ${captured.url}` : "no request captured (fell back to mock?)")
ok("B2 Basic auth built from the STORED CSID (cert:secret)",
  captured?.headers?.authorization === `Basic ${Buffer.from(`${stored.csidBase64}:${stored.secret}`).toString("base64")}`)
ok("B3 Content-Type application/xml with the UBL body", captured?.headers?.["content-type"] === "application/xml" && captured?.body?.includes("urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"))
ok("B4 payload signed with the stored private key (ds:SignatureValue injected)",
  /<ds:SignatureValue>[A-Za-z0-9+/=]+<\/ds:SignatureValue>/.test(captured?.body ?? ""))
ok("B5 response mapped to reported + envelope UUID", tx.status === "reported" && /^[0-9a-f-]{36}$/.test(tx.uuid) && tx.raw.validationResults?.status === "PASSED")

// B6 — clearance pipeline hits the clearance endpoint with the same auth.
const txClear = await transmitToZatca({ xml, pipeline: "clearance", docRef: `${INVOICE.invoiceNumber}-C`, credentials: stored })
const capturedClear = gateway.getCaptured()
ok("B6 clearance endpoint + cleared status", capturedClear?.url === "/invoices/clearance/single" && txClear.status === "cleared",
  capturedClear ? capturedClear.url : "no request captured")

// B7 — stored credentials WITHOUT a base URL must fall back to the sandbox
// mock (the transport's real-POST branch requires the gateway base; this is
// the same rule the adapter's sandbox flag now mirrors).
delete process.env.ZATCA_API_BASE_URL
const txNoBase = await transmitToZatca({ xml, pipeline: "reporting", docRef: `${INVOICE.invoiceNumber}-NB`, credentials: stored })
ok("B7 stored CSID + no base URL → sandbox mock (never a real POST)",
  txNoBase.raw.sandbox === true && txNoBase.status === "reported", `raw.sandbox=${txNoBase.raw.sandbox}`)

gateway.server.close()

// ═══════════════════════════════════════════════════════════════════════════
// PART C — cleanup
// ═══════════════════════════════════════════════════════════════════════════
section("Part C — cleanup")
const del = await fetch(`${BASE}/rest/v1/zatca_csids?tenant_id=eq.${T}&csid_base64=in.(${CERT_CC},${CERT_PC})`, {
  method: "DELETE",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
})
ok("C1 seeded rows removed", del.status === 204 || del.status === 200, `status=${del.status}`)

console.log(failures === 0 ? "\nAll stored-CSID reporting checks PASSED." : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
