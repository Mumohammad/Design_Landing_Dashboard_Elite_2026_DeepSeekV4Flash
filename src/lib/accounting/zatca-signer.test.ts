import { describe, expect, it } from "vitest"
import { X509Certificate, createHash } from "node:crypto"
import { KEYUTIL, KJUR } from "jsrsasign"
import { buildZatcaUblInvoice, type ZatcaInvoiceData } from "./zatca-ubl"
import { buildSigningInput, computeInvoiceHash, generateZatcaKeyPair, genesisPiH, verifyZatcaPayload } from "./zatca-crypto"
import { decodeZatcaPhase2Qr } from "./zatca-phase2-qr"
import { certificateDigest, certificateIssuerName, readZatcaQrSource, signZatcaInvoice, zatcaQrTimestamp, ZatcaSigningError } from "./zatca-signer"

function syntheticCredential() {
  const kp = generateZatcaKeyPair()
  const cert = new KJUR.asn1.x509.Certificate({
    version: 3,
    serial: { int: 4242 },
    issuer: { str: "/DC=local/DC=gov/CN=SYNTHETIC-CA" },
    subject: { str: "/C=SA/O=Synthetic/CN=EGS-1" },
    notbefore: "20260101000000Z",
    notafter: "20300101000000Z",
    sbjpubkey: KEYUTIL.getKey(kp.publicKeyPem),
    sigalg: "SHA256withECDSA",
    cakey: KEYUTIL.getKey(kp.privateKeyPem),
  } as unknown as ConstructorParameters<typeof KJUR.asn1.x509.Certificate>[0])
  const certificateBase64 = cert.getPEM().replace(/-----[^-]+-----|\s/g, "")
  return { kp, certificateBase64 }
}

const party = { name: "Synthetic seller", vatNumber: "399999999900003", crNumber: "1010010000", address: "Synthetic Street", buildingNumber: "1234", district: "Olaya", city: "Riyadh", postalCode: "12345", countryCode: "SA" }
function invoice(kind: "simplified" | "standard"): ZatcaInvoiceData {
  return {
    docType: "invoice", invoiceKind: kind, invoiceNumber: "SYN-1", uuid: "00000000-0000-4000-8000-000000000001",
    invoiceCounter: 1, previousInvoiceHash: genesisPiH(), issueDate: "2026-10-18", issueTime: "09:30:00", currency: "SAR",
    seller: party, buyer: { ...party, name: "Synthetic buyer", vatNumber: "399999999800003" },
    lines: [{ line_no: 1, description: "Delivery", quantity: 1, unit_price: 100, amount: 100, vat_rate: 15, vat_amount: 15 }],
    subtotal: 100, discount: 0, vatAmount: 15, total: 115,
    qr: { sellerName: party.name, sellerVatNumber: party.vatNumber, timestamp: "2026-10-18T09:30:00Z", total: 115, vatAmount: 15 },
  }
}

describe("ZATCA XAdES signer", () => {
  it("stamps a simplified invoice without changing its hash and binds the QR", () => {
    const { kp, certificateBase64 } = syntheticCredential()
    const unsigned = buildZatcaUblInvoice(invoice("simplified"))
    const signed = signZatcaInvoice({ environment: "sandbox", kind: "simplified", unsignedXml: unsigned, credentials: { certificateBase64, privateKeyPem: kp.privateKeyPem }, signingTime: "2026-10-18T09:31:00" })
    expect(signed.invoiceHash).toBe(computeInvoiceHash(unsigned))
    expect(computeInvoiceHash(signed.signedXml)).toBe(signed.invoiceHash)
    expect(signed.signedXml).toContain(`<ds:DigestValue>${signed.invoiceHash}</ds:DigestValue>`)
    expect(signed.signedXml).toContain(`<ds:X509Certificate>${certificateBase64}</ds:X509Certificate>`)
    expect(signed.signedXml).toContain("<ds:X509IssuerName>CN=SYNTHETIC-CA, DC=gov, DC=local</ds:X509IssuerName>")
    expect(signed.signedXml).toContain("<ds:X509SerialNumber>4242</ds:X509SerialNumber>")
    expect(verifyZatcaPayload(buildSigningInput(signed.invoiceHash), signed.signatureValue, kp.publicKeyPem)).toBe(true)
    const qr = decodeZatcaPhase2Qr(signed.qrBase64, "simplified", "base64-text-digest-signature", "offsetless-plus03")
    expect(qr).toMatchObject({ sellerName: party.name, sellerVatNumber: party.vatNumber, timestamp: "2026-10-18T09:30:00", total: "115.00", vatAmount: "15.00", invoiceHashBase64: signed.invoiceHash, signatureBase64: signed.signatureValue })
    expect(signed.signedXml).toContain(signed.qrBase64)
  })

  it("uses the SDK digest encodings for the certificate and signed properties", () => {
    const { kp, certificateBase64 } = syntheticCredential()
    expect(certificateDigest(certificateBase64)).toBe(Buffer.from(createHash("sha256").update(certificateBase64).digest("hex")).toString("base64"))
    const signed = signZatcaInvoice({ environment: "sandbox", kind: "standard", unsignedXml: buildZatcaUblInvoice(invoice("standard")), credentials: { certificateBase64, privateKeyPem: kp.privateKeyPem }, signingTime: "2026-10-18T09:31:00" })
    const span = signed.signedXml.slice(signed.signedXml.indexOf("<xades:SignedProperties"), signed.signedXml.indexOf("</xades:SignedProperties>") + 25)
    const withNs = span
      .replace("<xades:SignedProperties ", '<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" ')
      .replace(/<ds:(DigestMethod|DigestValue|X509IssuerName|X509SerialNumber)/g, '<ds:$1 xmlns:ds="http://www.w3.org/2000/09/xmldsig#"')
    expect(signed.signedPropertiesHash).toBe(Buffer.from(createHash("sha256").update(withNs).digest("hex")).toString("base64"))
    expect(signed.signedXml).toContain(`<ds:DigestValue>${signed.signedPropertiesHash}</ds:DigestValue>`)
    expect(certificateIssuerName(new X509Certificate(Buffer.from(certificateBase64, "base64")))).toBe("CN=SYNTHETIC-CA, DC=gov, DC=local")
  })

  it("refuses a key that does not belong to the certificate, a signed input and bad times", () => {
    const { certificateBase64 } = syntheticCredential()
    const other = generateZatcaKeyPair()
    const unsigned = buildZatcaUblInvoice(invoice("simplified"))
    const base = { environment: "sandbox" as const, kind: "simplified" as const, unsignedXml: unsigned, signingTime: "2026-10-18T09:31:00" }
    expect(() => signZatcaInvoice({ ...base, credentials: { certificateBase64, privateKeyPem: other.privateKeyPem } })).toThrow(ZatcaSigningError)
    expect(() => signZatcaInvoice({ ...base, credentials: { certificateBase64: "not-a-cert", privateKeyPem: other.privateKeyPem } })).toThrow("CERTIFICATE")
    expect(() => signZatcaInvoice({ ...base, signingTime: "2026-10-18 09:31", credentials: { certificateBase64, privateKeyPem: other.privateKeyPem } })).toThrow("TIME")
    const { kp, certificateBase64: cert2 } = syntheticCredential()
    const once = signZatcaInvoice({ ...base, credentials: { certificateBase64: cert2, privateKeyPem: kp.privateKeyPem } })
    expect(() => signZatcaInvoice({ ...base, unsignedXml: once.signedXml, credentials: { certificateBase64: cert2, privateKeyPem: kp.privateKeyPem } })).toThrow("XML")
  })

  it("reads QR fields from the document and converts UTC issue times to Saudi time", () => {
    expect(readZatcaQrSource(buildZatcaUblInvoice(invoice("standard")))).toEqual({ sellerName: party.name, sellerVatNumber: party.vatNumber, timestamp: "2026-10-18T09:30:00", total: "115.00", vatAmount: "15.00" })
    expect(zatcaQrTimestamp("2026-10-18", "22:30:00Z")).toBe("2026-10-19T01:30:00")
    expect(() => zatcaQrTimestamp("18/10/2026", "09:30:00")).toThrow("TIME")
  })
})
