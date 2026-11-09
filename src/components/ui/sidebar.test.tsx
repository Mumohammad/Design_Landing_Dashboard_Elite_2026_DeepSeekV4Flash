import { beforeEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { SidebarMenuButton, SidebarProvider } from "./sidebar"

const scope = vi.hoisted(() => ({ mobile: false }))
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => scope.mobile }))

function renderButton(defaultOpen: boolean) {
  return renderToStaticMarkup(createElement(SidebarProvider, { defaultOpen },
    createElement(SidebarMenuButton, { tooltip: "Drivers" }, "Drivers")))
}

describe("sidebar tooltip layers", () => {
  beforeEach(() => { scope.mobile = false })

  it.each([true, false])("does not mount an invisible tooltip trigger in the mobile sheet (desktop open=%s)", defaultOpen => {
    scope.mobile = true
    const html = renderButton(defaultOpen)
    expect(html).toContain('data-sidebar="menu-button"')
    expect(html).not.toContain('data-state="closed"')
  })

  it("does not mount an invisible tooltip for an expanded desktop label", () => {
    expect(renderButton(true)).not.toContain('data-state="closed"')
  })

  it("retains tooltips for collapsed desktop navigation", () => {
    expect(renderButton(false)).toContain('data-state="closed"')
  })
})
