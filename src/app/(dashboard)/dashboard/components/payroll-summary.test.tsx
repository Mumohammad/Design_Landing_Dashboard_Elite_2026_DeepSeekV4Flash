import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { LocaleProvider } from "@/contexts/locale-context"
import type { DashboardSnapshot } from "@/lib/analytics/types"
import { translations } from "@/lib/i18n/translations"
import { PayrollSummary } from "./payroll-summary"

const approved = { period: "2026-11", gross: 0, bonuses: 0, deductions: 0, net: 0,
  avgNet: 0, aboveTarget: 0, belowTarget: 0, negativeBalance: 0, available: true }

describe.each(["en", "ar"] as const)("dashboard payroll in %s", locale => {
  const render = (payroll: DashboardSnapshot["payroll"]) => renderToStaticMarkup(
    <LocaleProvider initialLocale={locale}><PayrollSummary payroll={payroll} onRetry={() => {}} /></LocaleProvider>,
  )
  it("shows an approved zero-value period and its payroll link", () => {
    expect(render(approved)).toContain('href="/payroll"')
    expect(render(approved)).toContain(translations[locale].dashboard.netPayroll)
  })
  it("shows fractional riyals", () => {
    expect(render({ ...approved, gross: 20.75, net: 20.75 })).toContain("20.75")
  })
  it("distinguishes a missing period from a failed payroll read", () => {
    expect(render({ ...approved, period: null })).toContain(translations[locale].dashboard.emptyDashboard)
    const unavailable = render({ ...approved, period: null, available: false })
    expect(unavailable).toContain(translations[locale].common.retry)
    expect(unavailable).not.toContain(translations[locale].dashboard.emptyDashboard)
  })
})
