import { describe, expect, it } from "vitest"
import { translateUi } from "./ui-copy"

describe("static UI language selection", () => {
  it("selects the requested language for legacy Arabic and English labels", () => {
    expect(translateUi("en", "سجّل شركتك")).toBe("Register your company")
    expect(translateUi("ar", "New expense")).toBe("مصروف جديد")
    expect(translateUi("en", "إجمالي الشركات")).toBe("Total companies")
    expect(translateUi("ar", "Check In")).toBe("تسجيل الحضور")
  })
  it("renders only the selected half of legacy bilingual interface copy", () => {
    expect(translateUi("en", "مصروف جديد / New expense")).toBe("New expense")
    expect(translateUi("ar", "مصروف جديد / New expense")).toBe("مصروف جديد")
  })
  it("preserves values absent from the static interface catalog", () => {
    expect(translateUi("en", "مؤسسة العميل ١٢٣")).toBe("مؤسسة العميل ١٢٣")
    expect(translateUi("ar", "INV-2026-001035")).toBe("INV-2026-001035")
  })
})
