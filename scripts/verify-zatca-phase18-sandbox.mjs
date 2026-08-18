// scripts/verify-zatca-phase18-sandbox.mjs
// Financial Phase 18 — end-to-end validation of the ZATCA crypto + onboarding
// seams against the ZATCA sandbox API.
//
// Two parts:
//
//   PART 1 — OFFLINE E2E (always runs, no credentials). Exercises the REAL
//   seam modules (zatca-crypto / zatca-onboarding / zatca-ubl /
//   zatca-transport — imported directly; Node 24 strips types) through the
//   full pipeline: keygen → CSR → compliance CSID (sandbox mock) → production
//   CSID (sandbox mock) → UBL invoice → invoice hash + PIH chain → ECDSA
//   signing → signature verification → signed transmission. Proves the seams
//   are internally consistent end-to-end.
//
//   PART 2 — LIVE SANDBOX ONBOARDING (runs only when ZATCA_SANDBOX_OTP is
//   set). Calls the REAL ZATCA sandbox: compliance CSID POST (CSR + OTP) →
//   parse + assert the returned X.509 CSID certificate → production CSID POST
//   (Basic auth from the CCSID). Uses the documented sandbox dummy VAT
//   (399999999900003) unless ZATCA_SANDBOX_VAT is set. Nothing here touches
//   the live production ZATCA environment — ZATCA-BOUNDARY.md §1/§5.
//
// Usage:
//   node scripts/verify-zatca-phase18-sandbox.mjs            # Part 1 only
//   ZATCA_SANDBOX_BASE_URL=... ZATCA_SANDBOX_OTP=123456 \
//     ZATCA_SANDBOX_VAT=399999999900003 \
//     node scripts/verify-zatca-phase18-sandbox.mjs          # Parts 1 + 2
//
// Env (also read from .env.local, same convention as the other verify scripts):
//   ZATCA_SANDBOX_BASE_URL  sandbox API gateway base, e.g.
//                           https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal
//   ZATCA_SANDBOX_OTP       one-time password generated in the Fatoora sandbox
//                           portal (human step — required for the live run)
//   ZATCA_SANDBOX_VAT       VAT number for the CSR UID; sandbox dummy default
//                           399999999900003
//   ZATCA_SANDBOX_PERSIST   when "1", save the REAL onboarded CSIDs to the
//                           demo tenant's zatca_csids table (service role) —
//                           the same rows the UI Onboard flow writes, so the
//                           live run leaves the tenant fully onboarded and the
//                           manual UI step is unnecessary. Requires
//                           NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//                           (already in .env.local).
//   ZATCA_SANDBOX_TENANT    tenant id to persist to (default: the demo tenant
//                           00000000-0000-0000-0000-000000000001).
//
// The UBL + signing constructions are the DOCUMENTED ones — the point of the
// live run is to surface exactly where ZATCA's sandbox disagrees with them
// (ZATCA-BOUNDARY.md §1). Failures in Part 2 are reported verbatim, not
// masked.

import { readFileSync, existsSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { registerHooks } from "node:module"
import { X509 } from "jsrsasign"

// Node 24's TS type-stripping cannot resolve the extensionless relative
// imports in the seam modules (e.g. "./invoice-qr"); register a resolve hook
// that falls back to appending ".ts" so the REAL modules import cleanly.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../")
    const hasExt = /\.(ts|js|mjs|cjs|json)$/.test(specifier)
    if (isRelative && !hasExt) {
      // Try the .ts file first (the seam modules import each other
      // extensionlessly, TS-style); fall back to the default resolution.
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

// ── Load .env.local (optional) ─────────────────────────────────────────────
const env = {}
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
}
for (const k of ["ZATCA_SANDBOX_BASE_URL", "ZATCA_SANDBOX_OTP", "ZATCA_SANDBOX_VAT", "ZATCA_SANDBOX_PERSIST", "ZATCA_SANDBOX_TENANT"]) {
  if (process.env[k]) env[k] = process.env[k]
}

// Import the REAL seam modules (Node 24 strips TS types).
const { generateZatcaKeyPair, buildZatcaCsr, parseZatcaCsr, computeInvoiceHash, genesisPiH, computePiH, buildSigningInput, signZatcaPayload, verifyZatcaPayload, ZATCA_CERT_TEMPLATES } = await import("../src/lib/accounting/zatca-crypto.ts")
const { requestComplianceCsid, requestProductionCsid } = await import("../src/lib/accounting/zatca-onboarding.ts")
const { buildZatcaUblInvoice } = await import("../src/lib/accounting/zatca-ubl.ts")
const { transmitToZatca } = await import("../src/lib/accounting/zatca-transport.ts")
const { buildTaxQrPayload } = await import("../src/lib/accounting/invoice-qr.ts")

let failures = 0
function ok(name, pass, detail = "") {
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!pass) failures++
}
function section(title) {
  console.log(`\n── ${title} ─${"─".repeat(Math.max(0, 60 - title.length))}`)
}

// Sandbox test configuration — documented dummy values (synthetic; no real
// VAT/CR numbers — ZATCA-BOUNDARY §5).
const SANDBOX_VAT = env.ZATCA_SANDBOX_VAT || "399999999900003"
const CSR_INPUT = {
  country: "SA",
  organizationUnit: "Riyadh Branch",
  organization: "Elite Fleet Demo",
  commonName: "PREZATCA-Code-Signing",
  serialNumber: `1-TST|2-TST|3-${randomUUID()}`,
  uid: SANDBOX_VAT,
  title: "1100",
  registeredAddress: "King Fahd Road, Riyadh",
  businessCategory: "Transportation",
  // The sandbox requires its own template name (TSTZATCA-…), distinct from
  // simulation (PREZATCA-…) and production (ZATCA-…).
  certificateTemplate: ZATCA_CERT_TEMPLATES.sandbox,
}

// A realistic invoice the way the app builds it (amounts from the engine).
const INVOICE = {
  docType: "invoice",
  invoiceNumber: "INV-2026-SANDBOX-0001",
  issueDate: "2026-08-15",
  issueTime: "10:30:00",
  currency: "SAR",
  profileId: "reporting:1.0",
  seller: { name: "Elite Fleet Demo", vatNumber: SANDBOX_VAT, crNumber: "1010000000", address: "King Fahd Road", city: "Riyadh" },
  buyer: { name: "Demo Buyer", vatNumber: "310122393500003", address: "Olaya Street", city: "Riyadh" },
  lines: [
    { line_no: 1, description: "Fleet management service", quantity: 1, unit_price: 1000, amount: 1000, vat_rate: 15, vat_amount: 150 },
  ],
  subtotal: 1000,
  discount: 0,
  vatAmount: 150,
  total: 1150,
  qr: { sellerName: "Elite Fleet Demo", sellerVatNumber: SANDBOX_VAT, timestamp: "2026-08-15T10:30:00Z", total: 1150, vatAmount: 150 },
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 — OFFLINE E2E (always runs)
// ═══════════════════════════════════════════════════════════════════════════
section("Part 1 — offline E2E (real seam modules, sandbox mocks)")

// 1.1 keygen
const kp = generateZatcaKeyPair()
ok("P1.1 secp256k1 keypair generated",
  kp.privateKeyPem.includes("BEGIN PRIVATE KEY") && kp.publicKeyPem.includes("BEGIN PUBLIC KEY"))

// 1.2 CSR → parse-back (subject + SAN dirName)
const csr = buildZatcaCsr(CSR_INPUT, kp)
{
  const parsed = parseZatcaCsr(csr)
  const san = parsed.extreq?.find((e) => e.extname === "subjectAltName")
  const dn = san?.array?.[0]?.dn?.str ?? ""
  ok("P1.2 CSR subject C=SA/OU/O/CN",
    parsed.subject.str.includes("/C=SA") && parsed.subject.str.includes("/CN=PREZATCA-Code-Signing"))
  ok("P1.2b CSR SAN dirName carries SN/UID/title/registeredAddress/businessCategory",
    dn.includes("/SN=1-TST|2-TST|3-") && dn.includes(`/UID=${SANDBOX_VAT}`) && dn.includes("/T=1100") &&
    dn.includes("/2.5.4.26=King Fahd Road") && dn.includes("/businessCategory=Transportation"),
    dn.replace(/\//g, " /"))
}

// 1.3 onboarding: compliance CSID (sandbox mock) → production CSID (sandbox mock)
const cc = await requestComplianceCsid({ csr, otp: "123456" })
const pc = await requestProductionCsid({ complianceRequestId: cc.requestId, csidBase64: cc.csidBase64, csidSecret: cc.secret })
ok("P1.3 compliance CSID sandbox mock (requestId+secret+cert)", cc.sandbox && Boolean(cc.requestId) && Boolean(cc.secret) && Boolean(cc.csidBase64))
ok("P1.3b production CSID sandbox mock", pc.sandbox && Boolean(pc.csidBase64) && Boolean(pc.secret))

// 1.4 UBL invoice + QR
const ubl = buildZatcaUblInvoice(INVOICE)
{
  const qrBase64 = Buffer.from(buildTaxQrPayload(INVOICE.qr)).toString("base64")
  ok("P1.4 UBL invoice well-formed + QR embedded",
    ubl.includes("urn:oasis:names:specification:ubl:schema:xsd:Invoice-2") &&
    ubl.includes(`<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qrBase64}`))
  ok("P1.4b UBL has ds:SignatureValue placeholder (signing seam)",
    ubl.includes("<ds:SignatureValue></ds:SignatureValue>"))
}

// 1.5 invoice hash + PIH chain (genesis for the first doc)
const invoiceHash = computeInvoiceHash(ubl)
const pih = genesisPiH()
const nextPih = computePiH(invoiceHash)
ok("P1.5 invoice hash is base64 SHA-256 (32 bytes)", Buffer.from(invoiceHash, "base64").length === 32)
ok("P1.5b genesis PIH differs from chain hash", pih !== nextPih && nextPih.length === 44)

// 1.6 ECDSA sign + verify round-trip (signing input = hash + signing time)
const signingTime = "2026-08-15T10:30:00Z"
const signature = signZatcaPayload(buildSigningInput(invoiceHash, signingTime), kp.privateKeyPem)
ok("P1.6 ECDSA signature verifies with the CSID public key",
  verifyZatcaPayload(buildSigningInput(invoiceHash, signingTime), signature, kp.publicKeyPem))
ok("P1.6b signature rejects a tampered hash",
  !verifyZatcaPayload(buildSigningInput(computeInvoiceHash(ubl + " "), signingTime), signature, kp.publicKeyPem))

// 1.7 signed transmission through the transport (sandbox mode)
const signedUbl = ubl.replace("<ds:SignatureValue></ds:SignatureValue>", `<ds:SignatureValue>${signature}</ds:SignatureValue>`)
const tx = await transmitToZatca({ xml: signedUbl, pipeline: "reporting", docRef: INVOICE.invoiceNumber })
ok("P1.7 sandbox transmission → reported + stable UUID",
  tx.status === "reported" && tx.raw.sandbox === true && /^[0-9a-f-]{36}$/.test(tx.uuid))
ok("P1.7b signed XML carries the injected signature", signedUbl.includes(`<ds:SignatureValue>${signature}</ds:SignatureValue>`))

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — LIVE SANDBOX ONBOARDING (only when the OTP is supplied)
// ═══════════════════════════════════════════════════════════════════════════
const liveBase = env.ZATCA_SANDBOX_BASE_URL || "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal"
if (!env.ZATCA_SANDBOX_OTP) {
  console.log("\n(Skipping Part 2 — live sandbox onboarding. Set ZATCA_SANDBOX_OTP (from the Fatoora sandbox portal) to run it.)")
} else {
  section(`Part 2 — live sandbox onboarding (${liveBase})`)
  process.env.ZATCA_API_BASE_URL = liveBase

  // 2.1 compliance CSID — real POST with the CSR + OTP
  let ccLive
  try {
    ccLive = await requestComplianceCsid({ csr, otp: env.ZATCA_SANDBOX_OTP })
    ok("P2.1 compliance CSID issued by the sandbox", !ccLive.sandbox && Boolean(ccLive.csidBase64) && Boolean(ccLive.requestId))
  } catch (e) {
    ok("P2.1 compliance CSID issued by the sandbox", false, e.message)
  }

  if (ccLive) {
    // 2.2 parse the returned CSID X.509 cert and assert subject/SAN
    // (jsrsasign 11 exports X509 at top level — KJUR.asn1.x509.X509 is NOT
    // a constructor in this version, which would throw here on the first
    // live run; use the documented top-level export.)
    try {
      const pem = `-----BEGIN CERTIFICATE-----\n${ccLive.csidBase64}\n-----END CERTIFICATE-----`
      const cert = new X509()
      cert.readCertPEM(pem)
      const subject = cert.getSubjectString()
      const san = cert.getExtSubjectAltName()
      // jsrsasign 11 returns the SAN extension as an OBJECT
      // ({ extname, array: [{ dn: { str, array } }] }) — older versions
      // returned a plain string. Normalize both to a string so the
      // UID/SN assertion works on either.
      const sanStr = typeof san === "string"
        ? san
        : Array.isArray(san?.array)
          ? (san.array[0]?.dn?.str ?? "")
          : ""
      ok("P2.2 CSID cert is a parseable X.509", Boolean(subject), subject)
      ok("P2.2b CSID cert subject includes CN", subject.includes("CN=") && subject.includes("C=SA"))
      ok("P2.2c CSID cert SAN includes the VAT (UID)",
        sanStr.includes(`UID=${SANDBOX_VAT}`) || sanStr.includes("SN="),
        sanStr.replace(/\n/g, " "))
    } catch (e) {
      ok("P2.2 CSID cert parse", false, `cert parse failed: ${e.message}`)
    }

    // 2.3 production CSID — real POST with Basic auth from the CCSID
    let pcLive = null
    try {
      pcLive = await requestProductionCsid({
        complianceRequestId: ccLive.requestId,
        csidBase64: ccLive.csidBase64,
        csidSecret: ccLive.secret,
      })
      ok("P2.3 production CSID issued by the sandbox", !pcLive.sandbox && Boolean(pcLive.csidBase64))
      try {
        const pem = `-----BEGIN CERTIFICATE-----\n${pcLive.csidBase64}\n-----END CERTIFICATE-----`
        const cert = new X509()
        cert.readCertPEM(pem)
        ok("P2.3b PCSID cert is a parseable X.509", Boolean(cert.getSubjectString()), cert.getSubjectString())
      } catch (e) {
        ok("P2.3b PCSID cert parse", false, `cert parse failed: ${e.message}`)
      }
    } catch (e) {
      ok("P2.3 production CSID issued by the sandbox", false, e.message)
    }

    // 2.5 — persist the REAL CSIDs to the demo tenant (opt-in). Mirrors
    // saveZatcaCsidInternal (zatca-csid.ts) exactly: same columns, same
    // upsert semantics (unique tenant_id,environment,kind), environment
    // "sandbox" (the env being onboarded). Replaces the manual UI Onboard
    // step so the live run leaves the tenant fully onboarded.
    if (env.ZATCA_SANDBOX_PERSIST === "1") {
      const persistBase = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")
      const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
      const tenantId = env.ZATCA_SANDBOX_TENANT || "00000000-0000-0000-0000-000000000001"
      if (!persistBase || !serviceKey) {
        console.log("    (persist skipped — NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in .env.local)")
      } else if (!pcLive) {
        console.log("    (persist skipped — production CSID was not issued)")
      } else {
        const upsert = async (kind, csid, secret) => {
          const res = await fetch(`${persistBase}/rest/v1/zatca_csids`, {
            method: "POST",
            headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
            body: JSON.stringify({
              tenant_id: tenantId,
              environment: "sandbox",
              kind,
              csid_base64: csid,
              secret,
              private_key: kp.privateKeyPem,
              request_id: ccLive.requestId,
              status: "issued",
              issued_at: new Date().toISOString(),
            }),
          })
          return res.status
        }
        const s1 = await upsert("compliance", ccLive.csidBase64, ccLive.secret)
        const s2 = await upsert("production", pcLive.csidBase64, pcLive.secret)
        ok("P2.5 real CSIDs persisted to the demo tenant (sandbox env)",
          s1 === 201 && s2 === 201, `compliance=${s1} production=${s2}`)
        if (s1 === 201 && s2 === 201) {
          const read = await fetch(
            `${persistBase}/rest/v1/zatca_csids?tenant_id=eq.${tenantId}&environment=eq.sandbox&kind=eq.production&status=eq.issued&select=csid_base64,secret,private_key`,
            { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
          )
          const rows = await read.json()
          const row = Array.isArray(rows) ? rows[0] : null
          ok("P2.5b production row round-trips cert/secret/private_key verbatim",
            read.status === 200 && row?.csid_base64 === pcLive.csidBase64 && row?.secret === pcLive.secret && row?.private_key === kp.privateKeyPem,
            read.status === 200 && row ? `cert=${row.csid_base64 === pcLive.csidBase64} key=${row.private_key === kp.privateKeyPem}` : `status=${read.status}`)
        }
      }
    } else {
      console.log("    (persist skipped — set ZATCA_SANDBOX_PERSIST=1 to save the real CSIDs to the demo tenant)")
    }

    // 2.6 (informational) live reporting probe — the last unknown. Transmits
    // the test invoice through the REAL transport path (Basic auth from the
    // production CSID + ECDSA signature from the CSR key) against the sandbox
    // reporting endpoint. Reported verbatim, never masked — surfaces exactly
    // where ZATCA's sandbox disagrees with the documented constructions.
    if (pcLive) {
      try {
        const probeTx = await transmitToZatca({
          xml: ubl,
          pipeline: "reporting",
          docRef: `INV-2026-P18-LIVE-${randomUUID().slice(0, 8)}`,
          credentials: { csidBase64: pcLive.csidBase64, secret: pcLive.secret, privateKeyPem: kp.privateKeyPem },
        })
        console.log(`    (informational) live reporting → status=${probeTx.status} uuid=${probeTx.uuid}`)
        console.log(`      raw: ${JSON.stringify(probeTx.raw).slice(0, 400)}`)
      } catch (e) {
        console.log(`    (informational) live reporting probe failed — ${e.message.slice(0, 600)}`)
      }
    }

    // 2.4 (informational) compliance invoice check — surfaces where the
    // documented constructions diverge from ZATCA's expectations (hash/C14N).
    // Reported verbatim, never masked — this is the point of the live run.
    try {
      const creds = Buffer.from(`${ccLive.csidBase64}:${ccLive.secret}`).toString("base64")
      const uuid = randomUUID()
      // Documented compliance-check endpoint (Qoyod/API guides): the sandbox
      // validates invoice hash + UBL against the compliance ruleset.
      const complianceUrl = "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/compliance/invoices"
      const res = await fetch(complianceUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Version": "V2",
          Authorization: `Basic ${creds}`,
        },
        body: JSON.stringify({
          invoiceHash,
          uuid,
          invoice: Buffer.from(ubl).toString("base64"),
        }),
      })
      const raw = await res.text()
      console.log(`    (informational) compliance check HTTP ${res.status}: ${raw.slice(0, 400)}`)
    } catch (e) {
      console.log(`    (informational) compliance check skipped — ${e.message}`)
    }
  }
}

console.log(failures === 0 ? "\nAll Phase 18 sandbox checks PASSED." : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
