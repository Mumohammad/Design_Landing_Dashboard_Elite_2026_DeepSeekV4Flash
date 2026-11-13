import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import QRCode from "qrcode"
import sharp from "sharp"
vi.mock("server-only", () => ({}))
import { runReceiptProcess } from "./extraction-process"

const bytes = new TextEncoder().encode("<Invoice>synthetic</Invoice>")
async function withWorker(source: string, test: (file: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "elite-receipt-test-"))
  const file = path.join(dir, "worker.cjs")
  await writeFile(file, source)
  try { await test(file) } finally { await unlink(file); await rmdir(dir) }
}

function textPdf(labels: string[]): Uint8Array {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [" + labels.map((_, i) => `${4 + i * 2} 0 R`).join(" ") + `] /Count ${labels.length} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
  for (const label of labels) {
    const content = `BT /F1 12 Tf 30 800 Td (${label}) Tj ET`
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`, `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`)
  }
  let pdf = "%PDF-1.4\n"
  const offsets = [0]
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new Uint8Array(Buffer.from(pdf))
}

async function qrPdf(payloads: string[]): Promise<Uint8Array> {
  const images = await Promise.all(payloads.map(async payload => sharp(await QRCode.toBuffer(payload, { width: 400 })).flatten({ background: "white" }).jpeg({ quality: 100 }).toBuffer()))
  const content = payloads.map((_, i) => `q 200 0 0 200 ${i * 220} 300 cm /Im${i} Do Q`).join("\n")
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << ${images.map((_, i) => `/Im${i} ${4 + i} 0 R`).join(" ")} >> >> /Contents ${4 + images.length} 0 R >>`),
    ...images.map(image => Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 400 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, Buffer.from("\nendstream")])),
    Buffer.from(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`),
  ]
  const chunks = [Buffer.from("%PDF-1.4\n")], offsets: number[] = []
  let length = chunks[0].length
  objects.forEach((object, i) => { offsets.push(length); const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]); chunks.push(chunk); length += chunk.length })
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${length}\n%%EOF`))
  return new Uint8Array(Buffer.concat(chunks))
}

describe("isolated receipt process lifecycle", () => {
  it("returns only after the worker exits and does not mutate input bytes", async () => {
    const before = new Uint8Array(bytes)
    const result = await runReceiptProcess(bytes, "application/xml")
    expect(result.status).toBe("complete")
    expect(result.processExited).toBe(true)
    expect(result.ready).toBe(true)
    expect(result.value).toEqual({ text: "", xml: "<Invoice>synthetic</Invoice>", qr: null })
    expect(bytes).toEqual(before)
  })

  it.each([
    [new Uint8Array(), "application/xml", 20000],
    [new Uint8Array(10 * 1024 * 1024 + 1), "application/pdf", 20000],
    [bytes, "image/svg+xml", 20000],
    [bytes, "application/xml", 0],
    [bytes, "application/xml", 25001],
    [bytes, "application/xml", NaN],
  ])("rejects invalid bytes/type/deadline before starting a process: case %#", async (data, mime, timeout) => {
    const result = await runReceiptProcess(data as Uint8Array, mime as string, timeout as number)
    expect(result.status).toBe("invalid")
    expect(result.processExited).toBe(false)
    expect(result.value).toBeNull()
  })

  it("actually kills synchronous busy work while the parent stays responsive, then releases its slot", async () => {
    await withWorker("process.once('message',()=>{process.send({type:'ready',rss:1024});while(true){}})", async file => {
      let ticks = 0
      const timer = setInterval(() => ticks++, 20)
      try {
        const pending = runReceiptProcess(bytes, "application/xml", 2500, file)
        expect((await runReceiptProcess(bytes, "application/xml")).status).toBe("busy")
        const result = await pending
        expect(result.status).toBe("timeout")
        expect(result.ready).toBe(true)
        expect(result.processExited).toBe(true)
        expect(result.value).toBeNull()
        expect(ticks).toBeGreaterThan(3)
      } finally { clearInterval(timer) }
    })
    expect((await runReceiptProcess(bytes, "application/xml")).status).toBe("complete")
  }, 15000)

  it("does not inherit application credentials or Node preload options", async () => {
    vi.stubEnv("RECEIPT_PRIVATE_TEST", "fabricated-private-value")
    vi.stubEnv("NODE_OPTIONS", "--require=fabricated-preload-that-must-not-run")
    try {
      await withWorker("process.once('message',()=>process.send({type:'result',value:{text:JSON.stringify({credential:!!process.env.RECEIPT_PRIVATE_TEST,preload:!!process.env.NODE_OPTIONS,argv:process.execArgv}),xml:null,qr:null}}))", async file => {
        const result = await runReceiptProcess(bytes, "application/xml", 20000, file)
        expect(result.status).toBe("complete")
        const received = JSON.parse(result.value!.text)
        expect(received.credential).toBe(false)
        expect(received.preload).toBe(false)
        expect(received.argv).toContain("--max-old-space-size=128")
      })
    } finally { vi.unstubAllEnvs() }
  })

  it.each([
    "{text:'unsafe',xml:null,qr:'bad-qr'}",
    "{text:'x'.repeat(60001),xml:null,qr:null}",
    "{text:'',xml:'<!DOCTYPE Invoice>',qr:null}",
    "{text:'',xml:null,qr:null,unexpected:true}",
  ])("rejects malformed or over-budget worker output and observes its exit: case %#", async value => {
    await withWorker(`process.once('message',()=>process.send({type:'result',value:${value}}))`, async file => {
      const result = await runReceiptProcess(bytes, "application/xml", 20000, file)
      expect(result.status).toBe("unavailable")
      expect(result.value).toBeNull()
      expect(result.processExited).toBe(true)
    })
  })

  it("retires a child reporting excessive memory before accepting a result", async () => {
    await withWorker("process.once('message',()=>{process.send({type:'ready',rss:268435457});setInterval(()=>{},1000)})", async file => {
      const result = await runReceiptProcess(bytes, "application/xml", 20000, file)
      expect(result.status).toBe("memory_limit")
      expect(result.processExited).toBe(true)
      expect(result.value).toBeNull()
    })
  })

  it("handles missing worker programs without inline parsing or occupied slots", async () => {
    const result = await runReceiptProcess(bytes, "application/xml", 20000, path.join(tmpdir(), "elite-missing-receipt-worker-84672.cjs"))
    expect(result.status).toBe("unavailable")
    expect(result.processExited).toBe(true)
    expect((await runReceiptProcess(bytes, "application/xml")).status).toBe("complete")
  })
})

describe("actual receipt decoders in the isolated process", () => {
  it("continues past an unrelated base64 QR to find a later receipt QR in the same PDF", async () => {
    const fields = ["Synthetic seller", "300000000000003", "2026-09-01T12:00:00+03:00", "115.00", "15.00"]
    const payload = Buffer.concat(fields.map((value, i) => { const text = Buffer.from(value); return Buffer.concat([Buffer.from([i + 1, text.length]), text]) })).toString("base64")
    const unrelated = Buffer.from("unrelated base64 coupon content").toString("base64")
    const result = await runReceiptProcess(await qrPdf([unrelated, payload]), "application/pdf")
    expect(result.status).toBe("complete")
    expect(result.value?.qr).toBe(payload)
  })

  it("extracts only the first three PDF pages", async () => {
    const result = await runReceiptProcess(textPdf(["FIRST page invoice 115.00 SAR", "SECOND page", "THIRD page", "OUTSIDE page must not be read"]), "application/pdf")
    expect(result.status).toBe("complete")
    expect(result.processExited).toBe(true)
    expect(result.value?.text).toContain("FIRST")
    expect(result.value?.text).toContain("THIRD")
    expect(result.value?.text).not.toContain("OUTSIDE")
  })

  it("rejects an excessive page count without walking those pages", async () => {
    const result = await runReceiptProcess(textPdf(Array.from({ length: 101 }, () => "outside budget")), "application/pdf")
    expect(result.status).toBe("complete")
    expect(result.value).toEqual({ text: "", xml: null, qr: null })
  })

  it("decodes a fabricated TLV QR image and preserves its exact payload", async () => {
    const fields = ["Synthetic seller", "300000000000003", "2026-09-01T12:00:00+03:00", "115.00", "15.00"]
    const payload = Buffer.concat(fields.map((value, i) => { const text = Buffer.from(value); return Buffer.concat([Buffer.from([i + 1, text.length]), text]) })).toString("base64")
    const image = await QRCode.toBuffer(payload, { type: "png", width: 400 })
    const result = await runReceiptProcess(new Uint8Array(image), "image/png")
    expect(result.status).toBe("complete")
    expect(result.value?.qr).toBe(payload)
  })

  it.each(["%PDF-1.4 malformed", "not a PDF"])("fails safely for malformed PDF: case %#", async input => {
    const result = await runReceiptProcess(new TextEncoder().encode(input), "application/pdf")
    expect(result.status).toBe("unavailable")
    expect(result.processExited).toBe(true)
    expect(result.value).toBeNull()
  })

  it("omits XML entities and over-budget XML without external resolution", async () => {
    for (const xml of ["<!DOCTYPE Invoice [<!ENTITY x SYSTEM 'file:///private'>]><Invoice>&x;</Invoice>", "x".repeat(262145)]) {
      const result = await runReceiptProcess(new TextEncoder().encode(xml), "application/xml")
      expect(result.status).toBe("complete")
      expect(result.value).toEqual({ text: "", xml: null, qr: null })
    }
  })
})
