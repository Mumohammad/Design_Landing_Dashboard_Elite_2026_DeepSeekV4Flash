// Trusted worker program; receipt bytes arrive only over IPC, never argv/files.
// It runs in a separate Node process without application credentials.
const MAX_PAGES = 3
const MAX_DOCUMENT_PAGES = 100
const MAX_TEXT = 60000
const MAX_XML = 262144
const MAX_INPUT_PIXELS = 24000000
const MAX_PDF_PIXELS = 12000000
const EMPTY = () => ({ text: '', xml: null, qr: null })

function qrCandidate(value) {
  // Match the minimum eligibility of decodeZatcaQr before stopping the image
  // search. A base64 coupon must not hide a later receipt. This checks only TLV
  // shape/required values; it does not authenticate a signature or authority.
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/=\s]{20,4000}$/.test(value.trim())) return false
  let bytes
  try { bytes = Uint8Array.from(atob(value.replace(/\s/g, '')), char => char.charCodeAt(0)) } catch { return false }
  const tags = new Map()
  for (let i = 0; i + 2 <= bytes.length;) {
    const tag = bytes[i], length = bytes[i + 1]
    if (tag < 1 || tag > 9 || i + 2 + length > bytes.length) return false
    tags.set(tag, bytes.subarray(i + 2, i + 2 + length))
    i += 2 + length
  }
  const decoder = new TextDecoder('utf-8')
  const field = tag => tags.has(tag) ? decoder.decode(tags.get(tag)).trim() : ''
  return !!field(1) && /^\d{15}$/.test(field(2)) && /^\d+(\.\d+)?$/.test(field(4))
}

async function readPrimitive(bytes, mime) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) return EMPTY()
  if (mime === 'application/xml' || mime === 'text/xml') {
    if (bytes.byteLength > MAX_XML) return EMPTY()
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return /<!DOCTYPE|<!ENTITY/i.test(xml) ? EMPTY() : { ...EMPTY(), xml }
  }
  const qrModule = await import('jsqr'), jsQR = qrModule.default?.default ?? qrModule.default
  const { default: sharp } = await import('sharp')
  sharp.cache(false)
  sharp.concurrency(1)
  const decode = (data, width, height) => {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 21 || height < 21 || width * height > 6000000 || data.byteLength !== width * height * 4) return null
    const hit = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height, { inversionAttempts: 'attemptBoth' })
    return qrCandidate(hit?.data) ? hit.data : null
  }
  async function imageQr(input, raw) {
    for (const size of [1600, 1000, 2400]) {
      const image = sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS, ...(raw ? { raw } : {}) })
      const { data, info } = await image.rotate().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: size <= 1600 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      if (info.channels !== 4) continue
      const qr = decode(data, info.width, info.height)
      if (qr) return qr
    }
    return null
  }
  if (mime.startsWith('image/')) {
    const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).metadata()
    if (!meta.width || !meta.height || meta.width * meta.height > MAX_INPUT_PIXELS || (meta.pages ?? 1) > 1) return EMPTY()
    return { ...EMPTY(), qr: await imageQr(input) }
  }
  if (mime !== 'application/pdf') return EMPTY()
  const { getDocumentProxy, extractImages } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { maxImageSize: MAX_PDF_PIXELS, isEvalSupported: false, useSystemFonts: false, stopAtErrors: true, useWorkerFetch: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false })
  try {
    if (!Number.isSafeInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > MAX_DOCUMENT_PAGES) return EMPTY()
    let text = '', qr = null
    for (let number = 1; number <= Math.min(pdf.numPages, MAX_PAGES); number++) {
      const page = await pdf.getPage(number)
      try {
        const content = await page.getTextContent()
        for (const item of content.items) {
          if (typeof item.str !== 'string') continue
          text += item.str.slice(0, MAX_TEXT - text.length) + (item.hasEOL ? '\n' : ' ')
          if (text.length >= MAX_TEXT) { text = text.slice(0, MAX_TEXT); break }
        }
        // Image decoding is isolated and subject to the parent's RSS/deadline
        // guard, since extractImages can allocate before returning its array.
        if (!qr) {
          const images = await extractImages(pdf, number).catch(() => [])
          for (const image of images.slice(0, 12)) {
            if (image.width < 60 || image.height < 60 || image.width * image.height > MAX_PDF_PIXELS || Math.abs(image.width - image.height) > Math.max(image.width, image.height) * 0.35 || image.data.byteLength !== image.width * image.height * 4) continue
            qr = decode(image.data, image.width, image.height)
            if (!qr) qr = await imageQr(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), { width: image.width, height: image.height, channels: 4 }).catch(() => null)
            if (qr) break
          }
        }
      } finally { page.cleanup() }
      if (text.length >= MAX_TEXT && qr) break
    }
    return { text: text.replace(/\u0000/g, '').normalize('NFKC').slice(0, MAX_TEXT), xml: null, qr }
  } finally { await pdf.destroy?.().catch(() => {}) }
}

module.exports = { readPrimitive }
if (require.main === module) {
  // No raw errors, receipt content or provider tokens go to stdout/stderr.
  process.once('message', async message => {
    process.send?.({ type: 'ready', rss: process.memoryUsage().rss })
    const memory = setInterval(() => {
      const rss = process.memoryUsage().rss
      process.send?.({ type: 'usage', rss })
      if (rss > 256 * 1024 * 1024) process.exit(75)
    }, 25)
    try {
      const value = await readPrimitive(message?.bytes, message?.mime ?? '')
      process.send?.({ type: 'result', value }, () => process.exit(0))
    } catch { process.send?.({ type: 'failed' }, () => process.exit(1)) }
    finally { clearInterval(memory) }
  })
}
