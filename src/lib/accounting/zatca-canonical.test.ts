import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { canonicalizeZatcaInvoice } from "./zatca-canonical"
import { computeInvoiceHash } from "./zatca-crypto"

const invoice = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
const cac = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
const cbc = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
const ext = "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
const wrap = (body: string, attributes = "") => `<Invoice xmlns="${invoice}" xmlns:cac="${cac}" xmlns:cbc="${cbc}" xmlns:ext="${ext}"${attributes}>${body}</Invoice>`

describe("restricted ZATCA canonical invoice hash", () => {
  it("matches an independent canonical byte vector, including namespace/attribute ordering and empty tags", () => {
    const xml = `<Invoice z='2' xmlns:ext='${ext}' xmlns:cbc='${cbc}' a='1' xmlns:cac='${cac}' xmlns='${invoice}'><cbc:ID>A&amp;B</cbc:ID><cbc:Note/></Invoice>`
    const expected = `<Invoice xmlns="${invoice}" xmlns:cac="${cac}" xmlns:cbc="${cbc}" xmlns:ext="${ext}" a="1" z="2"><cbc:ID>A&amp;B</cbc:ID><cbc:Note></cbc:Note></Invoice>`
    expect(canonicalizeZatcaInvoice(xml)).toBe(expected)
    expect(computeInvoiceHash(xml)).toBe(createHash("sha256").update(expected).digest("base64"))
  })

  it("excludes extensions, signature references and QR documents but preserves adjacent whitespace and other references", () => {
    const pih = "<cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cbc:Note>previous hash</cbc:Note></cac:AdditionalDocumentReference>"
    const nodes = "<ext:UBLExtensions><ext:UBLExtension>stamp</ext:UBLExtension></ext:UBLExtensions>\n<cbc:ID>INV-1</cbc:ID>\n<cac:Signature><cbc:ID>signature</cbc:ID></cac:Signature>\n<cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cbc:Note>qr</cbc:Note></cac:AdditionalDocumentReference>\n" + pih
    expect(canonicalizeZatcaInvoice(wrap(nodes))).toBe(canonicalizeZatcaInvoice(wrap("\n<cbc:ID>INV-1</cbc:ID>\n\n\n" + pih)))
    expect(computeInvoiceHash(wrap(nodes))).not.toBe(computeInvoiceHash(wrap("<cbc:ID>INV-1</cbc:ID>" + pih)))
  })

  it("recognizes only a direct QR ID, preserving a nested QR-valued field in another reference", () => {
    const xml = wrap("<cac:AdditionalDocumentReference><cbc:ID>OTHER</cbc:ID><cac:Attachment><cbc:ID>QR</cbc:ID></cac:Attachment></cac:AdditionalDocumentReference>")
    expect(canonicalizeZatcaInvoice(xml)).toContain("<cbc:ID>OTHER</cbc:ID>")
  })

  it("canonicalizes entities, CDATA, CRLF, Arabic and supplementary Unicode consistently", () => {
    const a = wrap("\r\n<cbc:Note><![CDATA[خدمة & خدمة 🚚]]>&#xD;</cbc:Note>\r\n")
    const b = wrap("\n<cbc:Note>خدمة &amp; خدمة &#128666;&#13;</cbc:Note>\n")
    expect(computeInvoiceHash(a)).toBe(computeInvoiceHash(b))
    expect(canonicalizeZatcaInvoice(a)).toContain("خدمة &amp; خدمة 🚚&#xD;")
  })

  it("ignores XML declaration, internal comments and whitespace outside the root", () => {
    const body = "<cbc:ID>INV-1</cbc:ID>"
    expect(computeInvoiceHash(wrap(body))).toBe(computeInvoiceHash('\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n' + wrap(body + "<!--inside-->") + "\n"))
  })

  it.each([
    '<!DOCTYPE Invoice [<!ENTITY x SYSTEM "https://example.invalid/private">]>' + wrap("&x;"),
    '<?xml version="1.1"?>' + wrap(""),
    '<?xml version="1.0" encoding="UTF-16"?>' + wrap(""),
    '<?processing value?>' + wrap(""),
    wrap("<?processing value?>"),
    wrap("&unknown;"),
    wrap("&#0;"),
    wrap("\u0000"),
    wrap("\ud800"),
    wrap("&#xD800;"),
    wrap("<cbc:Note></cbc:ID>"),
    wrap("<cbc:Note>"),
    wrap('<cbc:Note a="one" a="two"/>'),
    wrap('<cbc:Note xml:base="../"/>'),
    wrap('<cbc:Note xml:id="untrusted"/>'),
    wrap('<cbc:Note xml:lang="ar"/>'),
    wrap('<cbc:Note xml:space="preserve"/>'),
    wrap('<cbc:Note xmlns:cbc="urn:other"/>'),
    wrap('<cbc:Note xmlns=""/>'),
    wrap('<other:Note xmlns:other="urn:relative"/>'),
    wrap('<cbc:Note xmlns:custom="relative"/>'),
    wrap('<cbc:Note xmlnsOther="not-a-namespace"/>'),
    wrap('<cbc:Note العربية="unsupported-attribute"/>'),
    wrap("<undeclared:Note/>"),
    wrap("<!--bad--comment-->"),
    wrap("") + wrap(""),
    "outside" + wrap(""),
    "\u00a0" + wrap(""),
    wrap("") + "\u00a0",
    "<!--outside-->" + wrap(""),
    '<?XML version="1.0"?>' + wrap(""),
    '<NotInvoice xmlns="' + invoice + '"/>',
  ])("rejects unsupported/malformed XML without disclosing its contents (case %#)", (xml) => {
    expect(() => canonicalizeZatcaInvoice(xml)).toThrow("Unsupported or malformed ZATCA invoice XML")
  })

  it("bounds input size and depth before recursive canonicalization", () => {
    expect(() => canonicalizeZatcaInvoice(wrap("x".repeat(2 * 1024 * 1024)))).toThrow("Unsupported or malformed")
    expect(() => canonicalizeZatcaInvoice(wrap("<cbc:Note>".repeat(130) + "</cbc:Note>".repeat(130)))).toThrow("Unsupported or malformed")
  })
})
