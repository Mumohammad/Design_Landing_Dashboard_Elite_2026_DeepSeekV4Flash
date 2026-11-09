import { describe, expect, it } from "vitest"
import { normalizeHeader, toIsoDate, toNumber, westernDigits } from "./sheet"
import { parseFineRows } from "@/lib/violations/fines-import"
import { normalizeSaudiMobile, parseDriverRows } from "@/lib/drivers/import"
import { buildDriverReminderEmail, reminderDates } from "@/lib/notifications/driver-reminder-email"

describe("sheet helpers", () => {
  it("normalises headers and digits", () => {
    expect(normalizeHeader("Fine Ref.")).toBe("fineref")
    expect(westernDigits("١٢٣٤")).toBe("1234")
  })
  it("parses dates in common formats", () => {
    expect(toIsoDate("2026-03-14")).toBe("2026-03-14")
    expect(toIsoDate("14/03/2026")).toBe("2026-03-14")
    expect(toIsoDate(46095)).toBe("2026-03-14")
    expect(toIsoDate("31/02/2026")).toBeNull()
    expect(toIsoDate(new Date(Date.UTC(2026, 0, 2)))).toBe("2026-01-02")
  })
  it("parses money", () => {
    expect(toNumber("1,250.50 SAR")).toBe(1250.5)
    expect(toNumber("٣٠٠")).toBe(300)
    expect(toNumber("abc")).toBeNull()
  })
})

describe("fine import parser", () => {
  it("maps Arabic and English headers and flags problems", () => {
    const { rows, issues } = parseFineRows([
      { "رقم المخالفة": "F1", "رقم اللوحة": "أ ب ح ١٢٣٤", "تاريخ المخالفة": "2026-03-01", "المبلغ": "300" },
      { "Fine reference": "F2", "Plate number": "", "Violation date": "bad", Amount: 100 },
      { "Fine reference": "F1", "Plate number": "X 1", Amount: 5 },
      { "Fine reference": "F3", Amount: 150 },
    ])
    expect(rows.map((r) => r.external_ref)).toEqual(["F1", "F3"])
    expect(rows[0]).toMatchObject({ vehicle_plate: "أ ب ح 1234", violation_date: "2026-03-01", fine_amount: 300 })
    expect(issues.filter((i) => i.blocking)).toHaveLength(2)
    expect(issues.some((i) => !i.blocking && i.line === 5)).toBe(true)
  })
})

describe("driver import parser", () => {
  it("normalises Saudi mobiles", () => {
    expect(normalizeSaudiMobile("551234567")).toBe("0551234567")
    expect(normalizeSaudiMobile("966551234567")).toBe("+966551234567")
    expect(normalizeSaudiMobile("055 123 4567")).toBe("0551234567")
  })
  it("validates rows, defaults category/status and rejects duplicates", () => {
    const { rows, issues } = parseDriverRows([
      { "Full name (Arabic)*": "محمد", "Mobile*": "0551234567", Category: "عمل حر", "Iqama expiry": "31/05/2027" },
      { "الاسم": "أحمد", "الجوال": "0551234568", "Status": "unknown" },
      { "Full name (Arabic)*": "سالم", "Mobile*": "12345" },
      { "Full name (Arabic)*": "محمد 2", "Mobile*": "0551234567" },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].input).toMatchObject({ full_name_ar: "محمد", category: "freelancer", status: "draft", iqama_expiry_date: "2027-05-31" })
    expect(issues.map((i) => i.line)).toEqual([3, 4, 5])
  })
})

describe("driver reminder email", () => {
  it("targets 30/14/7/1 days", () => {
    const m = reminderDates("2026-01-01")
    expect(m.get("2026-01-31")).toBe(30)
    expect(m.get("2026-01-02")).toBe(1)
  })
  it("escapes names and builds a subject", () => {
    const mail = buildDriverReminderEmail({ name: "<b>x</b>", company: "Co", items: [{ labelAr: "الإقامة", labelEn: "Iqama", date: "2026-01-02", days: 1 }] })
    expect(mail.html).not.toContain("<b>x</b>")
    expect(mail.subject).toContain("tomorrow")
  })
})
