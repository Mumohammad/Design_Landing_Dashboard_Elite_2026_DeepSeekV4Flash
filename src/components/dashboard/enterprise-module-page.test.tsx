import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { LocaleProvider } from "@/contexts/locale-context"
import { EnterpriseModulePage, reconcileModuleSelection } from "./enterprise-module-page"

describe("module selection across pages and filters", () => {
  it("forgets removed selections when a previous page is revisited", () => {
    const selected = { pageKey: JSON.stringify(["invoice-a", "invoice-b"]), ids: new Set(["invoice-a", "invoice-b"]) }
    const filtered = reconcileModuleSelection(["invoice-b", "invoice-c"], selected)
    expect([...filtered.ids]).toEqual(["invoice-b"])
    const revisited = reconcileModuleSelection(["invoice-a", "invoice-b"], filtered)
    expect([...revisited.ids]).toEqual(["invoice-b"])
    expect(revisited.ids.has("invoice-a")).toBe(false)
  })

  it("retains a selection while the same records refresh or reorder", () => {
    const selected = { pageKey: JSON.stringify(["driver-a", "driver-b"]), ids: new Set(["driver-b"]) }
    expect(reconcileModuleSelection(["driver-a", "driver-b"], selected)).toBe(selected)
    expect([...reconcileModuleSelection(["driver-b", "driver-a"], selected).ids]).toEqual(["driver-b"])
  })

  it("clears selections when a filter returns an empty page", () => {
    const selected = { pageKey: JSON.stringify(["record-a"]), ids: new Set(["record-a"]) }
    const empty = reconcileModuleSelection([], selected)
    expect(empty.ids.size).toBe(0)
    expect(reconcileModuleSelection(["record-a"], empty).ids.size).toBe(0)
  })
})

const rows = [{ id: "invoice-a", name: "January invoice", amount: 125.5 }]
const columns = [{ key: "name", header: "Name" }, { key: "amount", header: "Amount" }]

function renderPage(props: Partial<React.ComponentProps<typeof EnterpriseModulePage<(typeof rows)[number]>>> = {}, locale: "ar" | "en" = "en") {
  return renderToStaticMarkup(<LocaleProvider initialLocale={locale}>
    <EnterpriseModulePage title="Invoices" columns={columns} data={rows} {...props} />
  </LocaleProvider>)
}

describe("module table selection affordances", () => {
  it.each(["en", "ar"] as const)("names the %s selection controls while preserving a single nested heading", locale => {
    const html = renderPage({ headingLevel: "h2", onRowClick: () => {}, rowActions: () => <button type="button">Review invoice</button> }, locale)
    expect(html).toContain("<h2")
    expect(html).not.toContain("<h1")
    expect(html).toContain(`aria-label="${locale === "ar" ? "تحديد الكل" : "Select all"}"`)
    expect(html).toContain(`aria-label="${locale === "ar" ? "تحديد الصف" : "Select row"}"`)
    expect(html).toContain('tabindex="0"')
    expect(html).toContain("Review invoice")
    expect(html).toContain("max-sm:start-11")
  })

  it.each([{ isLoading: true }, { loadError: "Unable to load invoices" }, { selectable: false }])("does not offer bulk actions for unavailable or unselectable data: %j", props => {
    const html = renderPage(props)
    expect(html).not.toContain('type="checkbox"')
    expect(html).not.toContain('data-testid="bulk-action-bar"')
  })

  it("does not add a selection column to records without IDs", () => {
    const html = renderPage({ data: [{ name: "Unidentified invoice", amount: 20 }] as typeof rows })
    expect(html).not.toContain('type="checkbox"')
    expect(html).toContain("Unidentified invoice")
    expect(html).toContain("max-sm:start-0")
  })
})
