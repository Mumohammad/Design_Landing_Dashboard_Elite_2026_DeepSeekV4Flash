// Restricted canonicalization for XML produced by our UBL builder.
// ZATCA requires C14N 1.1. xml-crypto implements 1.0, so this module rejects
// xml:* attributes, namespace changes and other constructs outside the common
// 1.0/1.1 subset. It is NOT a general C14N 1.1 implementation or XML validator.
// https://www.w3.org/TR/xml-c14n11/ (XML attribute inheritance/base URI changes)
import { DOMParser } from "@xmldom/xmldom"
import { C14nCanonicalization } from "xml-crypto"

const namespaces: Record<string, string> = {
  "": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
  ds: "http://www.w3.org/2000/09/xmldsig#",
  sig: "urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2",
  sac: "urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2",
  sbc: "urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2",
  xades: "http://uri.etsi.org/01903/v1.3.2#",
}
const XMLNS = "http://www.w3.org/2000/xmlns/"
const MAX_XML_BYTES = 2 * 1024 * 1024
const invalid = () => new Error("Unsupported or malformed ZATCA invoice XML")

function validXmlCharacters(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0)!
    if (point !== 9 && point !== 10 && point !== 13 &&
        !(point >= 0x20 && point <= 0xd7ff) &&
        !(point >= 0xe000 && point <= 0xfffd) &&
        !(point >= 0x10000 && point <= 0x10ffff)) return false
  }
  return true
}

/**
 * Apply the three ZATCA invoice transforms and canonicalize without comments.
 * Only the controlled namespace/prefix profile above is supported. Reject
 * arbitrary external XML rather than silently hashing it with a different
 * canonicalization algorithm. Parser errors never echo invoice contents.
 */
export function canonicalizeZatcaInvoice(xml: string): string {
  if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES || !validXmlCharacters(xml)) throw invalid()
  // No DTD, external entities, processing instructions or XML 1.1. The XML
  // declaration, if present, must describe the UTF-8 XML 1.0 string we accept.
  const content = xml.replace(/^\uFEFF/, "").replace(
    /^<\?xml[\t\r\n ]+version=(?:"1\.0"|'1\.0')(?:[\t\r\n ]+encoding=(?:"UTF-8"|'UTF-8'))?(?:[\t\r\n ]+standalone=(?:"(?:yes|no)"|'(?:yes|no)'))?[\t\r\n ]*\?>/,
    "",
  )
  const body = content.replace(/^[\t\r\n ]+|[\t\r\n ]+$/g, "")
  if (/<\?|<!DOCTYPE|<!ENTITY/i.test(content) ||
      !/^<Invoice(?=[\t\r\n />])/.test(body) || !/(?:<\/Invoice>|\/>)$/.test(body)) throw invalid()
  let document: Document
  try {
    document = new DOMParser({ errorHandler: () => { throw invalid() } }).parseFromString(content, "application/xml")
  } catch { throw invalid() }
  const root = document.documentElement
  if (!root || root.localName !== "Invoice" || root.prefix || root.namespaceURI !== namespaces[""]) throw invalid()
  for (const child of Array.from(document.childNodes)) {
    if (child !== root && !(child.nodeType === 3 && /^[\t\r\n ]*$/.test(child.textContent ?? ""))) throw invalid()
  }

  const excluded: Element[] = []
  const stack: { node: Node; depth: number }[] = [{ node: root, depth: 0 }]
  let count = 0
  while (stack.length) {
    const { node, depth } = stack.pop()!
    if (++count > 50_000 || depth > 128) throw invalid()
    if (!validXmlCharacters(node.nodeValue ?? "")) throw invalid()
    if (node.nodeType === 8 && node.nodeValue?.includes("--")) throw invalid()
    if (node.nodeType === 1) {
      const element = node as Element
      const prefix = element.prefix ?? ""
      if (!Object.prototype.hasOwnProperty.call(namespaces, prefix) || element.namespaceURI !== namespaces[prefix]) throw invalid()
      for (const attribute of Array.from(element.attributes)) {
        if (!validXmlCharacters(attribute.value)) throw invalid()
        if (attribute.namespaceURI === XMLNS) {
          const declared = attribute.name === "xmlns" ? "" : attribute.localName
          if (!Object.prototype.hasOwnProperty.call(namespaces, declared) || attribute.value !== namespaces[declared]) throw invalid()
        } else if (attribute.prefix || attribute.namespaceURI) {
          // Includes xml:id/base/lang/space: no C14N 1.1 subset fixup needed.
          throw invalid()
        } else if (attribute.name.startsWith("xmlns") || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(attribute.name)) {
          // xml-crypto treats names beginning "xmlns" as declarations; such
          // ordinary attributes are outside our generated UBL profile.
          throw invalid()
        }
      }
      if ((element.namespaceURI === namespaces.ext && element.localName === "UBLExtensions") ||
          (element.namespaceURI === namespaces.cac && element.localName === "Signature") ||
          (element.namespaceURI === namespaces.cac && element.localName === "AdditionalDocumentReference" &&
            Array.from(element.childNodes).some((child) => child.nodeType === 1 &&
              (child as Element).namespaceURI === namespaces.cbc && (child as Element).localName === "ID" && child.textContent === "QR"))) {
        excluded.push(element)
      }
    } else if (![3, 4, 8].includes(node.nodeType)) throw invalid()
    for (const child of Array.from(node.childNodes ?? [])) stack.push({ node: child, depth: depth + 1 })
  }
  // Keep surrounding text nodes. Removing indentation with an excluded
  // element changes the digest; SDK differential tests cover that boundary.
  for (const element of excluded) element.parentNode?.removeChild(element)
  return new C14nCanonicalization().process(root, {})
}
