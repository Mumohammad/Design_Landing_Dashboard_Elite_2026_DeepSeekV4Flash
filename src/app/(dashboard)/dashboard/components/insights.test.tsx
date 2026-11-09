import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { LocaleProvider } from "@/contexts/locale-context"
import { Insights } from "./insights"

describe("dashboard change descriptions", () => {
  it("does not describe zero change as an increase, including cached positive classifications", () => {
    const html = renderToStaticMarkup(<LocaleProvider initialLocale="en"><Insights insights={[
      { id: "zero", kind: "positive", key: "orders", value: 0 },
      { id: "increase", kind: "positive", key: "orders", value: 25 },
      { id: "decrease", kind: "negative", key: "orders", value: 12 },
    ]} /></LocaleProvider>)
    expect(html).toContain("Orders are unchanged from the previous period.")
    expect(html).not.toContain("Orders up 0%")
    expect(html).toContain("Orders up 25%")
    expect(html).toContain("Orders down 12%")
  })

  it("describes unchanged metrics in Arabic", () => {
    const html = renderToStaticMarkup(<LocaleProvider initialLocale="ar"><Insights insights={[
      { id: "zero", kind: "positive", key: "orders", value: 0 },
    ]} /></LocaleProvider>)
    expect(html).toContain("الطلبات لم تتغير مقارنة بالفترة السابقة.")
    expect(html).not.toContain("الطلبات ارتفعت")
  })
})
