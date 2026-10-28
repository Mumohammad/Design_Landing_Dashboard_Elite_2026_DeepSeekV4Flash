// LIVE check against the public ZATCA developer-portal sandbox (non-production).
// Generates a throwaway key + CSR, requests a sandbox compliance CSID with the
// portal's published test OTP, stamps synthetic documents with the application
// signer and submits them to /compliance/invoices. No tenant data, no database,
// no production endpoint. Run only with explicit approval:
//   ZATCA_LIVE_SANDBOX=yes node scripts/verify-zatca-sandbox-live.mjs
import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import ts from "typescript"

if (process.env.ZATCA_LIVE_SANDBOX !== "yes") throw new Error("Set ZATCA_LIVE_SANDBOX=yes to call the public ZATCA sandbox")
const BASE = "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal"
const OTP = process.env.ZATCA_SANDBOX_OTP || "123345"
process.env.ZATCA_MODE = "sandbox"
process.env.ZATCA_API_BASE_URL = BASE

const requireDependency = createRequire(import.meta.url)
const modules = new Map()
function loadModule(file) {
  file = path.resolve(file)
  if (modules.has(file)) return modules.get(file)
  const exports = {}; modules.set(file, exports)
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function("exports", "require", code)(exports, (name) => {
    if (["node:crypto", "jsrsasign", "xml-crypto", "@xmldom/xmldom"].includes(name)) return requireDependency(name)
    if (name === "@/lib/logger") return { moduleLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) }
    if (!name.startsWith("./")) throw new Error(`Unexpected dependency ${name}`)
    return loadModule(path.resolve(path.dirname(file), name + ".ts"))
  })
  return exports
}
const { buildZatcaUblInvoice } = loadModule("src/lib/accounting/zatca-ubl.ts")
const { generateZatcaKeyPair, buildZatcaCsr, computeInvoiceHash } = loadModule("src/lib/accounting/zatca-crypto.ts")
const { requestComplianceCsid } = loadModule("src/lib/accounting/zatca-onboarding.ts")
const { signZatcaInvoice } = loadModule("src/lib/accounting/zatca-signer.ts")
const { transmitToZatca } = loadModule("src/lib/accounting/zatca-transport.ts")

const vat = "399999999900003"
const keyPair = generateZatcaKeyPair()
const csr = buildZatcaCsr({
  country: "SA", organizationUnit: "Riyadh Branch", organization: "Synthetic Sandbox Co", commonName: "TST-886431145-399999999900003",
  serialNumber: "1-Elite|2-Dashboard|3-" + crypto.randomUUID(), uid: vat, title: "1100", registeredAddress: "Riyadh", businessCategory: "Logistics",
  certificateTemplate: "TSTZATCA-Code-Signing",
}, keyPair)
const ccsid = await requestComplianceCsid({ csr, otp: OTP })
console.log("PASS: sandbox compliance CSID issued")
const certificateBase64 = Buffer.from(ccsid.csidBase64, "base64").toString("utf8")
const credentials = { csidBase64: ccsid.csidBase64, secret: ccsid.secret }

const party = { name: "Synthetic Sandbox Co", vatNumber: vat, crNumber: "1010010000", address: "Synthetic Street", buildingNumber: "1234", additionalNumber: "1234", district: "Olaya", city: "Riyadh", region: "Riyadh", postalCode: "12345", countryCode: "SA" }
let pih = Buffer.from(createHash("sha256").update("0").digest("hex"), "utf8").toString("base64")
const now = new Date(Date.now() + 3 * 3600_000).toISOString()
let failures = 0, counter = 0
for (const kind of ["standard", "simplified"]) for (const docType of ["invoice", "credit_note", "debit_note"]) {
  counter++
  const uuid = crypto.randomUUID()
  const xml = buildZatcaUblInvoice({
    docType, invoiceKind: kind, invoiceNumber: `SBX-${counter}`, uuid, invoiceCounter: counter, previousInvoiceHash: pih,
    issueDate: now.slice(0, 10), issueTime: now.slice(11, 19), deliveryDate: now.slice(0, 10), currency: "SAR", paymentMeansCode: "10",
    ...(docType !== "invoice" ? { referenceInvoiceNumber: "SBX-1", noteReason: "Synthetic adjustment" } : {}),
    seller: party, buyer: { ...party, name: "Synthetic Buyer", vatNumber: "399999999800003" },
    lines: [{ line_no: 1, description: "Synthetic delivery", quantity: 1, unit_price: 100, amount: 100, vat_rate: 15, vat_amount: 15 }],
    subtotal: 100, discount: 0, vatAmount: 15, total: 115,
    qr: { sellerName: party.name, sellerVatNumber: vat, timestamp: now.slice(0, 19) + "Z", total: 115, vatAmount: 15 },
  })
  const signed = signZatcaInvoice({ environment: "sandbox", kind, unsignedXml: xml, credentials: { certificateBase64, privateKeyPem: keyPair.privateKeyPem }, signingTime: now.slice(0, 19) })
  const res = await transmitToZatca({ xml: signed.signedXml, pipeline: "compliance", docRef: `SBX-${counter}`, invoiceHash: signed.invoiceHash, uuid, credentials })
  const v = res.raw.validationResults
  const ok = res.status !== "rejected"
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}: ${kind} ${docType} -> ${res.status} (validation ${v.status}; ${v.warningMessages.length} warnings, ${v.errorMessages.length} errors)`)
  for (const m of [...v.errorMessages, ...v.warningMessages]) console.log(`   ${m.type ?? ""} ${m.code ?? ""}: ${m.message ?? ""}`)
  pih = computeInvoiceHash(signed.signedXml)
}
console.log("Sandbox compliance only — not production onboarding or authority approval.")
if (failures) process.exitCode = 1
