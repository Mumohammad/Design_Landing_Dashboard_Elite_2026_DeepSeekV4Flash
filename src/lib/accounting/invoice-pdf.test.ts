import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import path from "node:path"
const mocks = vi.hoisted(() => ({ launch: vi.fn(), executable: vi.fn(), context: vi.fn(), close: vi.fn(),
  route: vi.fn(), newPage: vi.fn(), timeout: vi.fn(), content: vi.fn(), evaluate: vi.fn(), media: vi.fn(), pdf: vi.fn(), read: vi.fn(), realpath: vi.fn(), stat: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("node:fs/promises", () => ({ readFile: mocks.read, realpath: mocks.realpath, stat: mocks.stat }))
vi.mock("@sparticuz/chromium", () => ({ default: { args: ["--fixture"], executablePath: mocks.executable } }))
vi.mock("playwright-core", () => ({ chromium: { launch: mocks.launch } }))
import { InvoicePdfBusyError, loadInvoiceReferenceFonts, renderInvoicePdf } from "./invoice-pdf"
const html = "<!DOCTYPE html><html><body>Invoice</body></html>"
const pdf = Buffer.from("%PDF-1.7\nfixture")
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("INVOICE_REFERENCE_FONT_DIR", undefined)
  mocks.realpath.mockImplementation(async (value: string) => path.resolve(value))
  mocks.stat.mockResolvedValue({ isFile: () => true, size: 12 })
  mocks.read.mockResolvedValue(Buffer.from([0,1,0,0,0,0,0,0,0,0,0,0]))
  mocks.executable.mockResolvedValue("/fixture/chromium")
  mocks.launch.mockResolvedValue({ newContext: mocks.context, close: mocks.close })
  mocks.context.mockResolvedValue({ route: mocks.route, newPage: mocks.newPage })
  mocks.newPage.mockResolvedValue({ setDefaultTimeout: mocks.timeout, setContent: mocks.content,
    evaluate: mocks.evaluate, emulateMedia: mocks.media, pdf: mocks.pdf })
  mocks.pdf.mockResolvedValue(pdf)
})
afterEach(() => vi.unstubAllEnvs())

describe("bounded invoice PDF rendering", () => {
  it("renders without browser headers, scripts or shared browser state, then closes the browser", async () => {
    expect(await renderInvoicePdf(html)).toEqual(Uint8Array.from(pdf))
    expect(mocks.context).toHaveBeenCalledWith(expect.objectContaining({ javaScriptEnabled: false }))
    expect(mocks.content).toHaveBeenCalledWith(html, expect.objectContaining({ timeout: 15_000 }))
    expect(mocks.pdf).toHaveBeenCalledWith(expect.objectContaining({ displayHeaderFooter: false, preferCSSPageSize: true, tagged: true }))
    expect(mocks.close).toHaveBeenCalledOnce()
  })
  it("blocks all external requests, including private network addresses", async () => {
    await renderInvoicePdf(html)
    const handler = mocks.route.mock.calls[0][1]
    for (const url of ["https://untrusted.test", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd"]) {
      const route = { request: () => ({ url: () => url }), continue: vi.fn(), abort: vi.fn() }
      await handler(route)
      expect(route.abort).toHaveBeenCalledWith("blockedbyclient")
      expect(route.continue).not.toHaveBeenCalled()
    }
  })
  it("waits for assets before printing and closes on asset failure", async () => {
    let reject!: (error: Error) => void
    mocks.evaluate.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const pending = renderInvoicePdf(html)
    const outcome = expect(pending).rejects.toThrow("Missing image")
    await vi.waitFor(() => expect(mocks.evaluate).toHaveBeenCalled())
    expect(mocks.pdf).not.toHaveBeenCalled()
    reject(new Error("Missing image")); await outcome
    expect(mocks.close).toHaveBeenCalledOnce()
  })
  it("rejects invalid/oversized HTML before starting a browser", async () => {
    await expect(renderInvoicePdf("not HTML")).rejects.toThrow()
    await expect(renderInvoicePdf("<!DOCTYPE html>" + "x".repeat(4 * 1024 * 1024))).rejects.toThrow()
    expect(mocks.launch).not.toHaveBeenCalled()
  })
  it("rejects invalid PDF bytes and recovers after launch failure", async () => {
    mocks.launch.mockRejectedValueOnce(new Error("Unavailable browser"))
    await expect(renderInvoicePdf(html)).rejects.toThrow("Unavailable browser")
    mocks.pdf.mockResolvedValueOnce(Buffer.from("HTML error"))
    await expect(renderInvoicePdf(html)).rejects.toThrow("Invalid invoice PDF")
    expect(await renderInvoicePdf(html)).toEqual(Uint8Array.from(pdf))
  })
  it("bounds simultaneous renderers and releases capacity after completion", async () => {
    const finish: Array<(value: Buffer) => void> = []
    mocks.pdf.mockImplementation(() => new Promise(resolve => { finish.push(resolve) }))
    const first = renderInvoicePdf(html), second = renderInvoicePdf(html)
    await vi.waitFor(() => expect(finish).toHaveLength(2))
    await expect(renderInvoicePdf(html)).rejects.toBeInstanceOf(InvoicePdfBusyError)
    for (const resolve of finish) resolve(pdf)
    await Promise.all([first, second])
    expect(mocks.close).toHaveBeenCalledTimes(2)
  })
})


describe("protected invoice reference fonts", () => {
  it("leaves the reference font optional unless configured by the operator", async () => {
    expect(await loadInvoiceReferenceFonts()).toEqual({})
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it("reads only fixed regular/bold filenames within the private configured directory", async () => {
    const root=path.resolve("private-invoice-fonts")
    vi.stubEnv("INVOICE_REFERENCE_FONT_DIR", root)
    expect(await loadInvoiceReferenceFonts()).toEqual({
      referenceFontDataUrl:"data:font/ttf;base64,AAEAAAAAAAAAAAAA",
      referenceBoldFontDataUrl:"data:font/ttf;base64,AAEAAAAAAAAAAAAA",
    })
    expect(mocks.read.mock.calls.map(call=>call[0]).sort()).toEqual([path.join(root,"bold.ttf"),path.join(root,"regular.ttf")].sort())
  })
  it("resolves the bundled operator mode to fixed private project files", async () => {
    vi.stubEnv("INVOICE_REFERENCE_FONT_DIR", "bundled")
    await loadInvoiceReferenceFonts()
    const root=path.join(process.cwd(),"private","invoice-fonts")
    expect(mocks.read.mock.calls.map(call=>call[0]).sort()).toEqual([path.join(root,"bold.ttf"),path.join(root,"regular.ttf")].sort())
  })
  it.each(["relative-fonts", "https://untrusted.test/fonts", path.resolve("public", "fonts")])("rejects unsafe font location %s", async configured => {
    vi.stubEnv("INVOICE_REFERENCE_FONT_DIR", configured)
    await expect(loadInvoiceReferenceFonts()).rejects.toThrow("Invoice reference fonts are unavailable or invalid")
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it("rejects symlink escapes before reading and rejects invalid/oversized font bytes", async () => {
    const root=path.resolve("private-invoice-fonts")
    vi.stubEnv("INVOICE_REFERENCE_FONT_DIR",root)
    mocks.realpath.mockImplementation(async (value:string)=>value.endsWith(".ttf") ? path.resolve("outside-fonts",path.basename(value)) : path.resolve(value))
    await expect(loadInvoiceReferenceFonts()).rejects.toThrow("Invoice reference fonts are unavailable or invalid")
    expect(mocks.read).not.toHaveBeenCalled()
    mocks.realpath.mockImplementation(async (value:string)=>path.resolve(value))
    mocks.read.mockResolvedValue(Buffer.from("untrusted-font-file"))
    await expect(loadInvoiceReferenceFonts()).rejects.toThrow("Invoice reference fonts are unavailable or invalid")
    mocks.read.mockClear()
    mocks.stat.mockResolvedValue({isFile:()=>true,size:2*1024*1024+1})
    await expect(loadInvoiceReferenceFonts()).rejects.toThrow("Invoice reference fonts are unavailable or invalid")
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
