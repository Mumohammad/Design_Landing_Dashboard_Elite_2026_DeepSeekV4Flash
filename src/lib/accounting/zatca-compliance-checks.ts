import "server-only"
// ZATCA onboarding compliance checks. Between the compliance CSID and the
// production CSID, the EGS must pass the compliance API for every document
// type it will issue (standard/simplified × invoice/credit/debit). These are
// test documents signed with the COMPLIANCE certificate on a private ICV/PIH
// chain — they never touch the tenant's legal issuance stream or ledger.
import { randomUUID } from "node:crypto"
import { buildZatcaUblInvoice, type ZatcaDocType, type ZatcaParty } from "./zatca-ubl"
import { signZatcaInvoice } from "./zatca-signer"
import { computeInvoiceHash, genesisPiH } from "./zatca-crypto"
import { transmitToZatca, ZatcaTransportError, type ZatcaValidationMessage } from "./zatca-transport"
import { riyadhLocal } from "./zatca-issuance-time"

export type ComplianceCheckResult = {
  kind: "standard" | "simplified"
  docType: ZatcaDocType
  status: "reported" | "cleared" | "rejected" | "failed"
  warnings: number
  errors: ZatcaValidationMessage[]
}

export type ComplianceChecksSummary = { passed: boolean; results: ComplianceCheckResult[] }

/** Synthetic B2B buyer for the standard-invoice checks (test data, not a customer). */
const CHECK_BUYER: ZatcaParty = {
  name: "Compliance check buyer", vatNumber: "399999999800003", address: "Compliance Street",
  buildingNumber: "1111", additionalNumber: "2222", district: "Compliance District", city: "Riyadh",
  postalCode: "12345", region: "Riyadh", countryCode: "SA",
}

export function complianceCheckMatrix(): { kind: "standard" | "simplified"; docType: ZatcaDocType }[] {
  const out: { kind: "standard" | "simplified"; docType: ZatcaDocType }[] = []
  for (const kind of ["standard", "simplified"] as const) for (const docType of ["invoice", "credit_note", "debit_note"] as const) out.push({ kind, docType })
  return out
}

export async function runZatcaComplianceChecks(input: {
  seller: ZatcaParty
  environment: "sandbox" | "simulation"
  certificateBase64: string
  privateKeyPem: string
  credentials: { csidBase64: string; secret: string }
  now?: Date
}): Promise<ComplianceChecksSummary> {
  const local = riyadhLocal((input.now ?? new Date()).toISOString())
  let pih = genesisPiH()
  let counter = 0
  const results: ComplianceCheckResult[] = []
  for (const { kind, docType } of complianceCheckMatrix()) {
    counter++
    const uuid = randomUUID()
    const ref = `CMP-${counter}`
    const xml = buildZatcaUblInvoice({
      docType, invoiceKind: kind, invoiceNumber: ref, uuid, invoiceCounter: counter, previousInvoiceHash: pih,
      issueDate: local.slice(0, 10), issueTime: local.slice(11, 19), deliveryDate: local.slice(0, 10), currency: "SAR",
      paymentMeansCode: "10",
      ...(docType !== "invoice" ? { referenceInvoiceNumber: "CMP-1", noteReason: "Compliance check adjustment" } : {}),
      seller: input.seller,
      buyer: kind === "standard" ? CHECK_BUYER : { name: "Compliance check customer", vatNumber: null, countryCode: "SA" },
      lines: [{ line_no: 1, description: "Compliance check service", quantity: 1, unit_price: 100, discount: 0, amount: 100, vat_rate: 15, vat_amount: 15 }],
      subtotal: 100, discount: 0, vatAmount: 15, total: 115,
      qr: { sellerName: input.seller.name, sellerVatNumber: input.seller.vatNumber ?? "", timestamp: local, total: 115, vatAmount: 15 },
    })
    const signed = signZatcaInvoice({
      environment: input.environment, kind, unsignedXml: xml,
      credentials: { certificateBase64: input.certificateBase64, privateKeyPem: input.privateKeyPem },
      signingTime: local,
    })
    try {
      const res = await transmitToZatca({ xml: signed.signedXml, pipeline: "compliance", docRef: ref, invoiceHash: signed.invoiceHash, uuid, credentials: input.credentials })
      const v = (res.raw.validationResults ?? {}) as { warningMessages?: ZatcaValidationMessage[]; errorMessages?: ZatcaValidationMessage[] }
      results.push({ kind, docType, status: res.status, warnings: v.warningMessages?.length ?? 0, errors: v.errorMessages ?? [] })
    } catch (e) {
      results.push({ kind, docType, status: "failed", warnings: 0, errors: [{ code: e instanceof ZatcaTransportError ? e.code : "UNEXPECTED" } as ZatcaValidationMessage] })
    }
    pih = computeInvoiceHash(signed.signedXml)
  }
  const passed = results.every((r) => r.status === (r.kind === "standard" ? "cleared" : "reported"))
  return { passed, results }
}
