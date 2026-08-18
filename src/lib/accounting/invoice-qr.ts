// Financial Phase 6 — invoice verification QR helpers.
//
// The QR embeds the standard simplified-tax-invoice TLV field set so the
// payload can later be reused verbatim by a ZATCA adapter (Phase 15). This
// QR is a VERIFICATION QR today — NOT a ZATCA tax QR (ZATCA-BOUNDARY.md §3).
//
// TLV tags (standard simplified tax invoice field set):
//   1  seller name
//   2  seller VAT registration number
//   3  timestamp (ISO 8601, UTC)
//   4  invoice total (with VAT)
//   5  VAT amount
//
// Server-side rendering module (the `qrcode` Node API is used for the PNG
// data URL); the pure TLV helpers above the QR renderer are import-safe
// anywhere.

import QRCode from "qrcode"

export interface TaxQrPayload {
  sellerName: string
  sellerVatNumber: string
  /** ISO 8601 UTC timestamp, e.g. 2026-08-12T10:30:00.000Z */
  timestamp: string
  total: number
  vatAmount: number
}

function toBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

/** TLV-encode one field: 1-byte tag, 1-byte length, UTF-8 value bytes.
 * The standard format uses a single-byte length, so values longer than 255
 * UTF-8 bytes cannot be represented (all five standard fields are short). */
export function tlvField(tag: number, value: string): Uint8Array {
  const bytes = toBytes(value)
  if (bytes.length > 255) {
    throw new Error(`TLV field ${tag} exceeds the 255-byte single-byte length limit`)
  }
  const out = new Uint8Array(2 + bytes.length)
  out[0] = tag
  out[1] = bytes.length
  out.set(bytes, 2)
  return out
}

/** Concatenate the standard 5-field TLV payload in tag order (1..5). */
export function buildTaxQrPayload(p: TaxQrPayload): Uint8Array {
  const fields = [
    tlvField(1, p.sellerName),
    tlvField(2, p.sellerVatNumber),
    tlvField(3, p.timestamp),
    tlvField(4, p.total.toFixed(2)),
    tlvField(5, p.vatAmount.toFixed(2)),
  ]
  const length = fields.reduce((n, f) => n + f.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const f of fields) {
    out.set(f, offset)
    offset += f.length
  }
  return out
}

/** Render text (typically the TLV payload) as a PNG data URL (Node API).
 * Passed as a byte-mode segment so binary TLV bytes survive verbatim. */
export async function qrPngDataUrl(text: Uint8Array | string): Promise<string> {
  return QRCode.toDataURL([{ data: text }], {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 180,
  })
}
