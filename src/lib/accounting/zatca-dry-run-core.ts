import "server-only"
// ZATCA offline dry run ("production rehearsal"). Takes real finalized
// documents, runs the exact production preparation steps — UBL 2.1 build,
// ICV/PIH hash chain, XAdES signing, Phase-2 QR — with a throwaway LOCAL test
// certificate, then validates the result locally.
//
// SAFETY: this module never talks to ZATCA. It deliberately imports nothing
// from zatca-transport / zatca-submission / zatca-onboarding / zatca-issuance,
// never reads stored CSIDs or private keys, and writes nothing to the
// issuance ledger. zatca-dry-run.test.ts enforces both properties.
import { randomUUID } from "node:crypto"
import { DOMParser } from "@xmldom/xmldom"
import { KEYUTIL, KJUR } from "jsrsasign"
import { buildZatcaUblInvoice, type ZatcaDocType, type ZatcaLine, type ZatcaParty } from "./zatca-ubl"
import { signZatcaInvoice } from "./zatca-signer"
import { buildSigningInput, computeInvoiceHash, generateZatcaKeyPair, genesisPiH, verifyZatcaPayload } from "./zatca-crypto"
import { decodeZatcaPhase2Qr } from "./zatca-phase2-qr"
import { invoiceKindFor, missingNationalAddress, ZATCA_VAT_RE } from "./zatca-adapter-input"
import { riyadhLocal } from "./zatca-issuance-time"

export interface DryRunDocument {
  sourceId: string
  docType: ZatcaDocType
  docRef: string
  issueDate: string
  /** When the document was finalized (used as the rehearsal issue time). */
  finalizedAt: string
  currency: string
  subtotal: number
  discount: number
  vatAmount: number
  total: number
  lines: ZatcaLine[]
  buyer: ZatcaParty
  referenceInvoiceNumber?: string
  noteReason?: string
}

export type DryRunCheckId =
  | "seller_vat" | "seller_address" | "buyer_standard" | "currency" | "lines" | "line_vat" | "totals"
  | "note_reference" | "ubl_build" | "ubl_fields" | "signature" | "hash_stable" | "qr" | "chain"

export interface DryRunCheck { id: DryRunCheckId; pass: boolean; detail?: string }

export interface DryRunDocumentResult {
  sourceId: string
  docRef: string
  docType: ZatcaDocType
  kind: "standard" | "simplified"
  pipeline: "clearance" | "reporting"
  counter: number
  invoiceHash: string | null
  passed: boolean
  checks: DryRunCheck[]
  /** Signed rehearsal XML (test certificate — NOT a legal tax document). */
  signedXml: string | null
}

export interface DryRunSummary {
  passed: boolean
  documents: DryRunDocumentResult[]
  networkCalls: 0
  certificate: "local-test"
}

export interface DryRunCredential { certificateBase64: string; privateKeyPem: string; publicKeyPem: string }

/** Throwaway self-signed certificate for the rehearsal — never sent anywhere. */
export function dryRunCredential(): DryRunCredential {
  const kp = generateZatcaKeyPair()
  const cert = new KJUR.asn1.x509.Certificate({
    version: 3,
    serial: { int: 1 },
    issuer: { str: "/C=SA/O=EliteDev/CN=DRY-RUN-LOCAL-TEST-CA" },
    subject: { str: "/C=SA/O=EliteDev/CN=DRY-RUN-NOT-A-ZATCA-CERTIFICATE" },
    notbefore: "20250101000000Z",
    notafter: "20350101000000Z",
    sbjpubkey: KEYUTIL.getKey(kp.publicKeyPem),
    sigalg: "SHA256withECDSA",
    cakey: KEYUTIL.getKey(kp.privateKeyPem),
  } as unknown as ConstructorParameters<typeof KJUR.asn1.x509.Certificate>[0])
  return { certificateBase64: cert.getPEM().replace(/-----[^-]+-----|\s/g, ""), privateKeyPem: kp.privateKeyPem, publicKeyPem: kp.publicKeyPem }
}

const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol
const money = (n: number) => n.toFixed(2)
const REQUIRED_UBL = ["cbc:ProfileID", "cbc:ID", "cbc:UUID", "cbc:IssueDate", "cbc:IssueTime", "cbc:InvoiceTypeCode", "cbc:DocumentCurrencyCode", "cac:AccountingSupplierParty", "cac:AccountingCustomerParty", "cac:TaxTotal", "cac:LegalMonetaryTotal", "cac:InvoiceLine"]

function ublFieldIssues(xml: string): string[] {
  const errors: string[] = []
  const doc = new DOMParser({ onError: (_l: string, m: string) => { errors.push(m) } } as never).parseFromString(xml, "text/xml")
  if (errors.length || !doc?.documentElement) return ["malformed XML"]
  const missing = REQUIRED_UBL.filter((tag) => doc.getElementsByTagName(tag).length === 0)
  const refs = Array.from(doc.getElementsByTagName("cbc:ID") as unknown as ArrayLike<{ textContent: string | null }>).map((n) => n.textContent)
  for (const r of ["ICV", "PIH", "QR"]) if (!refs.includes(r)) missing.push(r)
  return missing
}

/**
 * Rehearse a batch on a private chain that starts after `chainStart`
 * (the tenant's current ledger position, read-only) — the real stream is
 * never advanced.
 */
export function runZatcaDryRunBatch(input: {
  seller: ZatcaParty
  documents: DryRunDocument[]
  chainStart?: { counter: number; previousHash: string | null }
  credential?: DryRunCredential
  includeXml?: boolean
}): DryRunSummary {
  const cred = input.credential ?? dryRunCredential()
  let counter = input.chainStart?.counter ?? 0
  let pih = input.chainStart?.previousHash || genesisPiH()
  const seller = input.seller
  const sellerVatOk = ZATCA_VAT_RE.test(seller.vatNumber ?? "")
  const documents: DryRunDocumentResult[] = []

  for (const d of input.documents) {
    counter++
    const kind = invoiceKindFor(d.buyer)
    const checks: DryRunCheck[] = []
    const add = (id: DryRunCheckId, pass: boolean, detail?: string) => checks.push({ id, pass, ...(detail ? { detail } : {}) })

    add("seller_vat", sellerVatOk, sellerVatOk ? undefined : "Seller VAT number must be 15 digits starting and ending with 3.")
    const sMissing = missingNationalAddress(seller, "seller", kind)
    add("seller_address", sMissing.length === 0, sMissing.length ? `Missing: ${sMissing.join(", ")}` : undefined)
    if (kind === "standard") {
      const bMissing = missingNationalAddress(d.buyer, "buyer", kind)
      add("buyer_standard", bMissing.length === 0, bMissing.length ? `Buyer missing: ${bMissing.join(", ")}` : undefined)
    }
    add("currency", d.currency === "SAR", d.currency === "SAR" ? undefined : `Currency ${d.currency}: the SAR VAT amount must be supplied separately.`)
    add("lines", d.lines.length > 0 && d.lines.every((l) => l.quantity > 0 && Number.isFinite(l.amount)), d.lines.length ? undefined : "Document has no lines.")
    const badLine = d.lines.find((l) => !near(l.amount * (l.vat_rate / 100), l.vat_amount))
    add("line_vat", !badLine, badLine ? `Line ${badLine.line_no}: VAT ${money(badLine.vat_amount)} ≠ ${money(badLine.amount * badLine.vat_rate / 100)}` : undefined)
    const lineVat = d.lines.reduce((s, l) => s + l.vat_amount, 0)
    const totalsOk = near(lineVat, d.vatAmount, 0.011 * Math.max(1, d.lines.length)) && near(d.subtotal - d.discount + d.vatAmount, d.total)
    add("totals", totalsOk, totalsOk ? undefined : `Subtotal ${money(d.subtotal)} − discount ${money(d.discount)} + VAT ${money(d.vatAmount)} should equal total ${money(d.total)} (lines VAT ${money(lineVat)}).`)
    if (d.docType !== "invoice") { const ok = !!d.referenceInvoiceNumber && !!d.noteReason; add("note_reference", ok, ok ? undefined : "Credit/debit notes need the original invoice number and a reason.") }

    let signedXml: string | null = null
    let invoiceHash: string | null = null
    try {
      const local = riyadhLocal(d.finalizedAt)
      const unsigned = buildZatcaUblInvoice({
        docType: d.docType, invoiceKind: kind, invoiceNumber: d.docRef, uuid: randomUUID(), invoiceCounter: counter, previousInvoiceHash: pih,
        issueDate: local.slice(0, 10), issueTime: local.slice(11, 19), deliveryDate: d.issueDate.slice(0, 10), currency: d.currency, paymentMeansCode: "1",
        ...(d.docType !== "invoice" ? { referenceInvoiceNumber: d.referenceInvoiceNumber, noteReason: d.noteReason } : {}),
        seller, buyer: d.buyer, lines: d.lines, subtotal: d.subtotal, discount: d.discount, vatAmount: d.vatAmount, total: d.total,
        qr: { sellerName: seller.name, sellerVatNumber: seller.vatNumber ?? "", timestamp: local, total: d.total, vatAmount: d.vatAmount },
      })
      add("ubl_build", true)
      const signed = signZatcaInvoice({ environment: "simulation", kind, unsignedXml: unsigned, credentials: { certificateBase64: cred.certificateBase64, privateKeyPem: cred.privateKeyPem }, signingTime: local })
      const fieldIssues = ublFieldIssues(signed.signedXml)
      add("ubl_fields", fieldIssues.length === 0, fieldIssues.length ? `Missing: ${fieldIssues.join(", ")}` : undefined)
      add("signature", verifyZatcaPayload(buildSigningInput(signed.invoiceHash), signed.signatureValue, cred.publicKeyPem))
      add("hash_stable", computeInvoiceHash(signed.signedXml) === signed.invoiceHash && computeInvoiceHash(unsigned) === signed.invoiceHash)
      try {
        const qr = decodeZatcaPhase2Qr(signed.qrBase64, kind, "base64-text-digest-signature", "offsetless-plus03")
        const ok = qr.sellerVatNumber === seller.vatNumber && qr.total === money(d.total) && qr.vatAmount === money(d.vatAmount) && qr.invoiceHashBase64 === signed.invoiceHash
        add("qr", ok, ok ? undefined : "QR fields do not match the document.")
      } catch (e) { add("qr", false, e instanceof Error ? e.message : "QR decode failed") }
      add("chain", unsigned.includes(pih), `ICV ${counter}`)
      invoiceHash = signed.invoiceHash
      signedXml = signed.signedXml
      pih = signed.invoiceHash
    } catch (e) {
      add("ubl_build", false, e instanceof Error ? e.message : "Could not build the document.")
    }
    documents.push({
      sourceId: d.sourceId, docRef: d.docRef, docType: d.docType, kind, pipeline: kind === "standard" ? "clearance" : "reporting",
      counter, invoiceHash, passed: checks.every((c) => c.pass), checks, signedXml: input.includeXml === false ? null : signedXml,
    })
  }
  return { passed: documents.length > 0 && documents.every((d) => d.passed), documents, networkCalls: 0, certificate: "local-test" }
}
