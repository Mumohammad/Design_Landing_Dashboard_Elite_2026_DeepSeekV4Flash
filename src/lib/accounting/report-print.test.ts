import { afterEach, describe, expect, it, vi } from "vitest"
import { printReportFromGesture } from "./report-print"
import { printDocument } from "@/lib/print-document"
vi.mock("@/lib/print-document", () => ({ printDocument: vi.fn() }))
const render = vi.mocked(printDocument)
function setup() {
  const preview = { closed: false, close: vi.fn(), opener: {} } as unknown as Window
  const open = vi.fn().mockReturnValue(preview)
  vi.stubGlobal("window", { open })
  render.mockReset().mockResolvedValue(undefined)
  return { preview, open }
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
describe("VAT report print gesture", () => {
  it("reserves a same-gesture preview before awaiting server generation", async () => {
    const { preview, open } = setup()
    let complete!: (value: { success: boolean; html?: string }) => void
    const generated = new Promise<{ success: boolean; html?: string }>(resolve => { complete = resolve })
    const generate = vi.fn(() => { expect(open).toHaveBeenCalledOnce(); return generated })
    const pending = printReportFromGesture(generate)
    expect(open).toHaveBeenCalledWith("", "_blank")
    expect(preview.opener).toBeNull(); expect(render).not.toHaveBeenCalled()
    complete({ success: true, html: "<p>escaped report</p>" })
    expect(await pending).toBe("opened")
    expect(render).toHaveBeenCalledWith(preview, "<p>escaped report</p>")
    expect(preview.close).not.toHaveBeenCalled()
  })
  it("does not generate a document when the browser blocks the popup", async () => {
    const { open } = setup(); open.mockReturnValue(null)
    const generate = vi.fn()
    expect(await printReportFromGesture(generate)).toBe("blocked")
    expect(generate).not.toHaveBeenCalled(); expect(render).not.toHaveBeenCalled()
  })
  it("does not generate when opening the popup throws", async () => {
    const { open } = setup(); open.mockImplementation(() => { throw Error("browser policy") })
    const generate = vi.fn()
    expect(await printReportFromGesture(generate)).toBe("blocked")
    expect(generate).not.toHaveBeenCalled()
  })
  it.each([{ success: false }, { success: true }, { success: true, html: "" }])("closes only its owned blank preview for an unusable result %j", async result => {
    const { preview } = setup()
    expect(await printReportFromGesture(async () => result)).toBe("failed")
    expect(preview.close).toHaveBeenCalledOnce(); expect(render).not.toHaveBeenCalled()
  })
  it("closes the reserved window after a failed generation request", async () => {
    const { preview } = setup()
    expect(await printReportFromGesture(async () => { throw Error("network") })).toBe("failed")
    expect(preview.close).toHaveBeenCalledOnce(); expect(render).not.toHaveBeenCalled()
  })
  it("closes the reserved window after a font/image/print failure", async () => {
    const { preview } = setup(); render.mockRejectedValue(Error("assets"))
    expect(await printReportFromGesture(async () => ({ success: true, html: "<p>report</p>" }))).toBe("failed")
    expect(preview.close).toHaveBeenCalledOnce()
  })
  it("does not write to or close a preview the user already closed", async () => {
    const { preview } = setup(); Object.defineProperty(preview, "closed", { value: true })
    expect(await printReportFromGesture(async () => ({ success: true, html: "<p>report</p>" }))).toBe("failed")
    expect(render).not.toHaveBeenCalled(); expect(preview.close).not.toHaveBeenCalled()
  })
  it("keeps a failed result when the browser refuses to close its owned preview", async () => {
    const { preview } = setup()
    vi.mocked(preview.close).mockImplementation(() => { throw Error("browser close policy") })
    expect(await printReportFromGesture(async () => ({ success: false }))).toBe("failed")
    expect(preview.close).toHaveBeenCalledOnce()
  })
})
