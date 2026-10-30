// Certificate-bound XAdES stamp for ZATCA Phase 2 (simplified and standard).
//
// Builds the enveloped UBL signature exactly as the official SDK lays it out:
//   1. invoice hash  = SHA-256 of the canonical invoice without UBLExtensions,
//      cac:Signature and the QR reference (zatca-canonical.ts);
//   2. SignatureValue = ECDSA-secp256k1/SHA-256 over the 32 digest bytes
//      (the behaviour of the SDK signer and validator);
//   3. certificate digest = Base64(hex(SHA-256(certificate Base64 text)));
//   4. SignedProperties digest = Base64(hex(SHA-256(SignedProperties text,
//      with the xades/ds namespace declarations the validator restores)));
//   5. Phase 2 QR (tags 1-9) bound to that hash, signature, key and the CA
//      signature of the certificate (tag 9, simplified documents only).
//
// Verified offline with the official SDK validator (scripts/verify-zatca-
// app-signer.mjs). It never decides authority acceptance; only the reporting
// or clearance response does. Production stays blocked in zatca-config.ts.
import { X509Certificate, createPrivateKey, createPublicKey, createHash } from "node:crypto"
import { X509 } from "jsrsasign"
import { buildSigningInput, computeInvoiceHash, signZatcaPayload } from "./zatca-crypto"
import { buildZatcaPhase2QrCandidate, type ZatcaQrKind } from "./zatca-phase2-qr"
import { escXml } from "./zatca-ubl"
import { DOMParser } from "@xmldom/xmldom"

export interface ZatcaSigningCredentials {
  /** Base64 DER X.509 certificate (the CSID binarySecurityToken, decoded once). */
  certificateBase64: string
  /** PEM private key (SEC1 or PKCS#8) bound to the certificate. */
  privateKeyPem: string
}

export interface ZatcaSignInput {
  environment: "sandbox" | "simulation" | "production"
  kind: ZatcaQrKind
  unsignedXml: string
  credentials: ZatcaSigningCredentials
  /** Local signing time, YYYY-MM-DDTHH:mm:ss (as the SDK writes it). */
  signingTime: string
}

export interface ZatcaQrSource {
  sellerName: string
  sellerVatNumber: string
  timestamp: string
  total: string
  vatAmount: string
}

export interface ZatcaSignedInvoice {
  signedXml: string
  invoiceHash: string
  signatureValue: string
  qrBase64: string
  certificateHash: string
  signedPropertiesHash: string
}

const DS = "http://www.w3.org/2000/09/xmldsig#"
const XADES = "http://uri.etsi.org/01903/v1.3.2#"

export class ZatcaSigningError extends Error {
  constructor(readonly code: "CERTIFICATE" | "KEY_MISMATCH" | "XML" | "TIME" | "CERT_EXPIRED") {
    super(`ZATCA signing failed: ${code}`)
  }
}

/** Base64 of the lowercase hex SHA-256, the digest encoding ZATCA uses. */
function hexDigestBase64(text: string): string {
  return Buffer.from(createHash("sha256").update(text, "utf8").digest("hex"), "utf8").toString("base64")
}

export function certificateDigest(certificateBase64: string): string {
  return hexDigestBase64(certificateBase64)
}

function loadCertificate(certificateBase64: string): X509Certificate {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(certificateBase64)) throw new ZatcaSigningError("CERTIFICATE")
  try {
    return new X509Certificate(Buffer.from(certificateBase64, "base64"))
  } catch {
    throw new ZatcaSigningError("CERTIFICATE")
  }
}

/** RFC 4514 style issuer, most specific first, as the SDK serialises it. */
export function certificateIssuerName(cert: X509Certificate): string {
  return cert.issuer.split("\n").filter(Boolean).reverse().join(", ")
}

function signedPropertiesXml(p: { signingTime: string; certHash: string; issuer: string; serial: string }, withNamespaces: boolean): string {
  const dsNs = withNamespaces ? ` xmlns:ds="${DS}"` : ""
  const xadesNs = withNamespaces ? ` xmlns:xades="${XADES}"` : ""
  const i = (n: number) => " ".repeat(n)
  return [
    `<xades:SignedProperties${xadesNs} Id="xadesSignedProperties">`,
    `${i(36)}<xades:SignedSignatureProperties>`,
    `${i(40)}<xades:SigningTime>${p.signingTime}</xades:SigningTime>`,
    `${i(40)}<xades:SigningCertificate>`,
    `${i(44)}<xades:Cert>`,
    `${i(48)}<xades:CertDigest>`,
    `${i(52)}<ds:DigestMethod${dsNs} Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>`,
    `${i(52)}<ds:DigestValue${dsNs}>${p.certHash}</ds:DigestValue>`,
    `${i(48)}</xades:CertDigest>`,
    `${i(48)}<xades:IssuerSerial>`,
    `${i(52)}<ds:X509IssuerName${dsNs}>${escXml(p.issuer)}</ds:X509IssuerName>`,
    `${i(52)}<ds:X509SerialNumber${dsNs}>${p.serial}</ds:X509SerialNumber>`,
    `${i(48)}</xades:IssuerSerial>`,
    `${i(44)}</xades:Cert>`,
    `${i(40)}</xades:SigningCertificate>`,
    `${i(36)}</xades:SignedSignatureProperties>`,
    `${i(32)}</xades:SignedProperties>`,
  ].join("\n")
}

function extensionXml(p: {
  invoiceHash: string
  signedPropertiesHash: string
  signatureValue: string
  certificateBase64: string
  signedProperties: string
}): string {
  const i = (n: number) => " ".repeat(n)
  const transform = (xpath: string) =>
    [
      `${i(36)}<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">`,
      `${i(40)}<ds:XPath>${xpath}</ds:XPath>`,
      `${i(36)}</ds:Transform>`,
    ].join("\n")
  return [
    `<ext:UBLExtensions>`,
    `${i(4)}<ext:UBLExtension>`,
    `${i(8)}<ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>`,
    `${i(8)}<ext:ExtensionContent>`,
    `${i(12)}<sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2">`,
    `${i(16)}<sac:SignatureInformation>`,
    `${i(20)}<cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>`,
    `${i(20)}<sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>`,
    `${i(20)}<ds:Signature xmlns:ds="${DS}" Id="signature">`,
    `${i(24)}<ds:SignedInfo>`,
    `${i(28)}<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>`,
    `${i(28)}<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>`,
    `${i(28)}<ds:Reference Id="invoiceSignedData" URI="">`,
    `${i(32)}<ds:Transforms>`,
    transform("not(//ancestor-or-self::ext:UBLExtensions)"),
    transform("not(//ancestor-or-self::cac:Signature)"),
    transform("not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])"),
    `${i(36)}<ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>`,
    `${i(32)}</ds:Transforms>`,
    `${i(32)}<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>`,
    `${i(32)}<ds:DigestValue>${p.invoiceHash}</ds:DigestValue>`,
    `${i(28)}</ds:Reference>`,
    `${i(28)}<ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">`,
    `${i(32)}<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>`,
    `${i(32)}<ds:DigestValue>${p.signedPropertiesHash}</ds:DigestValue>`,
    `${i(28)}</ds:Reference>`,
    `${i(24)}</ds:SignedInfo>`,
    `${i(24)}<ds:SignatureValue>${p.signatureValue}</ds:SignatureValue>`,
    `${i(24)}<ds:KeyInfo>`,
    `${i(28)}<ds:X509Data>`,
    `${i(32)}<ds:X509Certificate>${p.certificateBase64}</ds:X509Certificate>`,
    `${i(28)}</ds:X509Data>`,
    `${i(24)}</ds:KeyInfo>`,
    `${i(24)}<ds:Object>`,
    `${i(28)}<xades:QualifyingProperties xmlns:xades="${XADES}" Target="signature">`,
    `${i(32)}${p.signedProperties}`,
    `${i(28)}</xades:QualifyingProperties>`,
    `${i(24)}</ds:Object>`,
    `${i(20)}</ds:Signature>`,
    `${i(16)}</sac:SignatureInformation>`,
    `${i(12)}</sig:UBLDocumentSignatures>`,
    `${i(8)}</ext:ExtensionContent>`,
    `${i(4)}</ext:UBLExtension>`,
    `</ext:UBLExtensions>`,
  ].join("\n")
}

const CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
const CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"

function child(parent: Element | null | undefined, ns: string, name: string): Element | null {
  if (!parent) return null
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === 1 && (node as Element).namespaceURI === ns && (node as Element).localName === name) return node as Element
  }
  return null
}

function text(el: Element | null): string {
  const value = el?.textContent?.trim()
  if (!value) throw new ZatcaSigningError("XML")
  return value
}

/**
 * QR fields read back from the invoice itself, so the stamp can never
 * disagree with the signed content (seller, time, totals).
 */
export function readZatcaQrSource(xml: string): ZatcaQrSource {
  let root: Element | null
  try {
    root = new DOMParser({ errorHandler: () => { throw new ZatcaSigningError("XML") } }).parseFromString(xml, "application/xml").documentElement
  } catch {
    throw new ZatcaSigningError("XML")
  }
  const party = child(child(root, CAC, "AccountingSupplierParty"), CAC, "Party")
  const sellerName = text(child(child(party, CAC, "PartyLegalEntity"), CBC, "RegistrationName"))
  const sellerVatNumber = text(child(child(party, CAC, "PartyTaxScheme"), CBC, "CompanyID"))
  const issueDate = text(child(root, CBC, "IssueDate"))
  const issueTime = text(child(root, CBC, "IssueTime"))
  const total = text(child(child(root, CAC, "LegalMonetaryTotal"), CBC, "TaxInclusiveAmount"))
  const currency = text(child(root, CBC, "DocumentCurrencyCode"))
  const taxTotal = Array.from(root?.childNodes ?? []).find(
    (node) => node.nodeType === 1 && (node as Element).namespaceURI === CAC && (node as Element).localName === "TaxTotal" &&
      child(node as Element, CBC, "TaxAmount")?.getAttribute("currencyID") === currency && child(node as Element, CAC, "TaxSubtotal")
  ) as Element | undefined
  const vatAmount = text(child(taxTotal, CBC, "TaxAmount"))
  return { sellerName, sellerVatNumber, timestamp: zatcaQrTimestamp(issueDate, issueTime), total, vatAmount }
}

const QR_REFERENCE =
  /(<cac:AdditionalDocumentReference>\s*<cbc:ID>QR<\/cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject mimeCode="text\/plain">)[^<]*(<\/cbc:EmbeddedDocumentBinaryObject>)/

/**
 * Stamp an unsigned invoice produced by buildZatcaUblInvoice. Throws rather
 * than returning a partially signed document.
 */
export function signZatcaInvoice(input: ZatcaSignInput): ZatcaSignedInvoice {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(input.signingTime)) throw new ZatcaSigningError("TIME")
  const xml = input.unsignedXml
  if (xml.includes("<ext:UBLExtensions") || !QR_REFERENCE.test(xml) || !/<cac:Signature>/.test(xml)) {
    throw new ZatcaSigningError("XML")
  }

  const cert = loadCertificate(input.credentials.certificateBase64)
  // signingTime is Riyadh-local wall-clock time (UTC+3, no DST). A CSID
  // outside its validity window must be renewed, never used to stamp.
  const signedAt = Date.parse(`${input.signingTime}+03:00`)
  if (!(signedAt >= Date.parse(cert.validFrom) && signedAt <= Date.parse(cert.validTo))) {
    throw new ZatcaSigningError("CERT_EXPIRED")
  }
  let certificateKeyDer: Buffer
  try {
    const privateKey = createPrivateKey(input.credentials.privateKeyPem)
    const derivedPublic = createPublicKey(privateKey).export({ type: "spki", format: "der" })
    certificateKeyDer = cert.publicKey.export({ type: "spki", format: "der" })
    if (!derivedPublic.equals(certificateKeyDer)) throw new ZatcaSigningError("KEY_MISMATCH")
  } catch (error) {
    if (error instanceof ZatcaSigningError) throw error
    throw new ZatcaSigningError("KEY_MISMATCH")
  }

  const invoiceHash = computeInvoiceHash(xml)
  const signatureValue = signZatcaPayload(buildSigningInput(invoiceHash), input.credentials.privateKeyPem)
  const certificateHash = certificateDigest(input.credentials.certificateBase64)
  const props = {
    signingTime: input.signingTime,
    certHash: certificateHash,
    issuer: certificateIssuerName(cert),
    serial: BigInt(`0x${cert.serialNumber}`).toString(10),
  }
  const signedPropertiesHash = hexDigestBase64(signedPropertiesXml(props, true))

  let certificateSignatureDer: Buffer | undefined
  if (input.kind === "simplified") {
    const parsed = new X509()
    parsed.readCertHex(Buffer.from(input.credentials.certificateBase64, "base64").toString("hex"))
    certificateSignatureDer = Buffer.from(parsed.getSignatureValueHex(), "hex")
  }
  const qr = readZatcaQrSource(xml)
  const qrBase64 = buildZatcaPhase2QrCandidate(input.environment, "base64-text-digest-signature", {
    kind: input.kind,
    timeProfile: "offsetless-plus03",
    ...qr,
    invoiceHashBase64: invoiceHash,
    signatureBase64: signatureValue,
    publicKeySpkiDer: certificateKeyDer,
    certificateSignatureDer,
  })

  const extension = extensionXml({
    invoiceHash,
    signedPropertiesHash,
    signatureValue,
    certificateBase64: input.credentials.certificateBase64,
    signedProperties: signedPropertiesXml(props, false),
  })
  const withQr = xml.replace(QR_REFERENCE, `$1${qrBase64}$2`)
  const rootStart = withQr.indexOf("<Invoice")
  const rootEnd = rootStart < 0 ? -1 : withQr.indexOf(">", rootStart) + 1
  if (rootEnd <= 0) throw new ZatcaSigningError("XML")
  // Insert with no surrounding text: removing the extension for hashing must
  // leave exactly the original character data behind.
  const signedXml = `${withQr.slice(0, rootEnd)}${extension}${withQr.slice(rootEnd)}`

  // The stamp must not change the signed content.
  if (computeInvoiceHash(signedXml) !== invoiceHash) throw new ZatcaSigningError("XML")
  return { signedXml, invoiceHash, signatureValue, qrBase64, certificateHash, signedPropertiesHash }
}

/** QR timestamp for an invoice issue date/time (offset-less Saudi time). */
export function zatcaQrTimestamp(issueDate: string, issueTime: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate) || !/^\d{2}:\d{2}:\d{2}Z?$/.test(issueTime)) throw new ZatcaSigningError("TIME")
  if (/Z$/.test(issueTime)) {
    const utc = new Date(`${issueDate}T${issueTime}`)
    return new Date(utc.getTime() + 3 * 3600_000).toISOString().slice(0, 19)
  }
  return `${issueDate}T${issueTime}`
}
