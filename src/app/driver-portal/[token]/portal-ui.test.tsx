import { renderToStaticMarkup } from "react-dom/server"
import { Children, isValidElement } from "react"
import { describe, expect, it, vi } from "vitest"
import { LocaleProvider } from "@/contexts/locale-context"
import type { PortalView } from "@/lib/driver-portal/server"
import { loadPortalView } from "@/lib/driver-portal/server"
import DriverPortalPage, { metadata } from "./page"
import { PortalContent, daysUntilExpiry } from "./portal-content"
import { performPortalUpload } from "./portal-upload-form"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/components/logo", () => ({ Logo: () => <span aria-hidden="true">ED</span> }))
vi.mock("@/lib/supabase/client", () => ({ createClient: () => { throw new Error("Unexpected storage call in local UI test") } }))
vi.mock("@/lib/driver-portal/server", () => ({ loadPortalView: vi.fn() }))
vi.mock("../actions", () => ({ startPortalUpload: vi.fn(), finishPortalUpload: vi.fn() }))

const now = Date.parse("2026-11-02T09:00:00+03:00")
const view: PortalView = {
  link: { id: "link", tenant_id: "tenant", driver_id: "driver", expires_at: "2026-12-01T00:00:00Z" },
  company: { name_ar: "شركة النقل", name_en: "Transport company" },
  driver: { id: "driver", full_name_ar: "السائق المسند", full_name_en: "Assigned driver", driver_code: "D-1", status: "active", nationality: null, iqama_last4: "1234", photo_url: null },
  documents: [{ id: "document", doc_type: "iqama", doc_number: null, expiry_date: "2026-11-20", is_verified: true }],
  platforms: [], cards: [], vehicle: null,
  submissions: [{ id: "submission", doc_type: "iqama", status: "unknown_internal_status", created_at: "2026-11-01T00:00:00Z", review_note: null }],
}

function render(locale: "ar" | "en", props: Partial<React.ComponentProps<typeof PortalContent>> = {}) {
  return renderToStaticMarkup(<LocaleProvider initialLocale={locale}><PortalContent token="local-only" view={view} now={now} {...props} /></LocaleProvider>)
}

describe("public portal language and accessibility", () => {
  it.each(["en", "ar"] as const)("server-renders the selected %s language with named controls", locale => {
    const html = render(locale)
    expect(html).toContain(`lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`)
    expect(html.match(/<h1\b/g)).toHaveLength(1)
    expect(html).toContain(locale === "ar" ? "السائق المسند" : "Assigned driver")
    expect(html).toContain(locale === "ar" ? "نوع المستند" : "Document type")
    expect(html).toContain(locale === "ar" ? "تحديث الحالة" : "Refresh status")
    expect(html).toContain(locale === "ar" ? "الحالة غير متاحة" : "Status unavailable")
    expect(html).not.toContain("unknown_internal_status")
    for (const id of ["portal-doc-type", "portal-file", "portal-doc-number", "portal-expiry", "portal-note"]) {
      expect(html).toContain(`for="${id}"`)
      expect(html).toContain(`id="${id}"`)
    }
    expect(html).not.toContain('placeholder=')
    expect(html).not.toContain("shadow-")
    expect(html).toContain("min-h-11")
    expect(html).toContain('type="submit" disabled=""')
    expect(html).not.toContain(locale === "ar" ? "Upload a renewed document" : "رفع مستند مجدد")
  })

  it("distinguishes temporary reads from invalid links and offers a read-only retry", () => {
    const invalid = render("en", { view: null })
    const failed = render("ar", { view: null, loadFailed: true })
    expect(invalid).toContain("Link expired or invalid")
    expect(invalid).not.toContain("Try again")
    expect(failed).toContain("البوابة غير متاحة")
    expect(failed).toContain('role="alert"')
    expect(failed).toContain("حاول مجددًا")
    expect(failed).not.toContain('type="submit"')
  })

  it("keeps public privacy metadata and requested-language SSR when reads fail", async () => {
    vi.mocked(loadPortalView).mockRejectedValueOnce(new Error("private backend detail"))
    const page = await DriverPortalPage({ params: Promise.resolve({ token: "local-only" }), searchParams: Promise.resolve({ lang: "en" }) })
    const html = renderToStaticMarkup(page)
    expect(html).toContain('lang="en" dir="ltr"')
    expect(html).toContain("Portal unavailable")
    expect(html).not.toContain("private backend detail")
    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata.referrer).toBe("no-referrer")
  })

  it("does not serialize full document numbers or unused driver/link scope to the client", async () => {
    vi.mocked(loadPortalView).mockResolvedValueOnce({ ...view, documents: [{ ...view.documents[0], doc_number: "private-full-number" }] })
    const page = await DriverPortalPage({ params: Promise.resolve({ token: "local-only" }), searchParams: Promise.resolve({ lang: "en" }) })
    const content = Children.toArray(page.props.children).find((child) => isValidElement(child) && child.type === PortalContent)
    if (!isValidElement<{ view: React.ComponentProps<typeof PortalContent>["view"] }>(content)) throw new Error("Portal content missing")
    expect(content.props.view?.link).toEqual({ expires_at: view.link.expires_at })
    expect(content.props.view?.driver).not.toHaveProperty("id")
    expect(content.props.view?.documents[0]).not.toHaveProperty("doc_number")
    expect(JSON.stringify(content.props.view)).not.toContain("private-full-number")
  })

  it("does not represent a missing or invalid expiry as valid", () => {
    expect(daysUntilExpiry(null, now)).toBeNull()
    expect(daysUntilExpiry("unavailable", now)).toBeNull()
    expect(daysUntilExpiry("2026-11-20", now)).toBe(18)
    expect(daysUntilExpiry("2026-11-01", now)).toBe(-1)
  })
})

const input = { token: "local-only", docType: "iqama", file: new File(["local UI test"], "document.pdf", { type: "application/pdf" }), docNumber: "123", expiry: "2027-01-01", note: "" }
function dependencies() {
  return {
    start: vi.fn(async (_input: unknown) => ({ ok: true as const, path: "owned/path.pdf", uploadToken: "local-only" })),
    upload: vi.fn(async (_path: string, _uploadToken: string, _file: File, _mime: string) => ({ error: null as unknown })),
    finish: vi.fn(async (_input: unknown): Promise<{ ok: true } | { ok: false; error: string; errorAr: string }> => ({ ok: true })),
  }
}

describe("one explicit signed portal upload attempt", () => {
  it("uses the reserved signed path and completes exactly once", async () => {
    const deps = dependencies()
    expect(await performPortalUpload(input, deps)).toEqual({ kind: "success" })
    expect(deps.start).toHaveBeenCalledTimes(1)
    expect(deps.upload).toHaveBeenCalledExactlyOnceWith("owned/path.pdf", "local-only", input.file, "application/pdf")
    expect(deps.finish).toHaveBeenCalledExactlyOnceWith({ token: "local-only", path: "owned/path.pdf", docType: "iqama", docNumber: "123", expiryDate: "2027-01-01", note: undefined })
  })

  it.each(["start", "upload"] as const)("catches a rejected %s call without continuing or retrying writes", async phase => {
    const deps = dependencies()
    deps[phase].mockRejectedValueOnce(new Error("network failure"))
    const result = await performPortalUpload(input, deps)
    expect(result.kind).toBe("error")
    expect(result).not.toHaveProperty("stack")
    expect(deps.start).toHaveBeenCalledTimes(1)
    expect(deps.finish).not.toHaveBeenCalled()
  })

  it.each(["throw", "unconfirmed response"] as const)("treats finalize %s as unknown and never automatically sends again", async mode => {
    const deps = dependencies()
    if (mode === "throw") deps.finish.mockRejectedValueOnce(new Error("connection lost after commit"))
    else deps.finish.mockResolvedValueOnce({ ok: false, error: "Could not confirm", errorAr: "تعذر التأكيد" })
    const result = await performPortalUpload(input, deps)
    expect(result.kind).toBe("unconfirmed")
    expect(deps.start).toHaveBeenCalledTimes(1)
    expect(deps.upload).toHaveBeenCalledTimes(1)
    expect(deps.finish).toHaveBeenCalledTimes(1)
  })

  it("rejects unsupported files before signing or saving", async () => {
    const deps = dependencies()
    expect((await performPortalUpload({ ...input, file: new File(["svg"], "document.svg", { type: "image/svg+xml" }) }, deps)).kind).toBe("error")
    expect(deps.start).not.toHaveBeenCalled()
    expect(deps.finish).not.toHaveBeenCalled()
  })
})
