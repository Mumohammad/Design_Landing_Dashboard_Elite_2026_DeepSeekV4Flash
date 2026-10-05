import { describe, expect, it } from "vitest"
import {
  dailyEntryImportRowSchema,
} from "@/types/platforms-module"
import {
  parseDailyRowsCsv,
  paymentBalance,
  periodKey,
  rollupDaily,
  rollupMonthly,
  splitCsvRows,
} from "./module-utils"

describe("dailyEntryImportRowSchema (transport contract)", () => {
  it("accepts a valid CSV row carrying driver_code + rowNumber", () => {
    const res = dailyEntryImportRowSchema.safeParse({
      rowNumber: 3,
      driver_code: "DRV-1",
      entry_date: "2026-10-01",
      orders_delivered: 10,
      gross_revenue: 350.5,
    })
    expect(res.success).toBe(true)
  })

  it("rejects a missing driver_code (previously smuggled through driver_id)", () => {
    const res = dailyEntryImportRowSchema.safeParse({
      driver_code: "",
      entry_date: "2026-10-01",
      orders_delivered: 1,
    })
    expect(res.success).toBe(false)
  })

  it("rejects a non-ISO entry_date", () => {
    const res = dailyEntryImportRowSchema.safeParse({
      driver_code: "DRV-1",
      entry_date: "01/10/2026",
    })
    expect(res.success).toBe(false)
  })
})

describe("splitCsvRows (RFC-4180)", () => {
  it("splits simple rows", () => {
    expect(splitCsvRows("a,b\nc,d")).toEqual([["a", "b"], ["c", "d"]])
  })

  it("keeps commas inside quoted fields and un-doubles quotes", () => {
    expect(splitCsvRows('"a,b","c""d"')).toEqual([["a,b", 'c"d']])
  })

  it("handles CRLF and drops trailing empty lines", () => {
    expect(splitCsvRows("a,b\r\nc,d\r\n")).toEqual([["a", "b"], ["c", "d"]])
  })
})

describe("parseDailyRowsCsv", () => {
  const pid = "00000000-0000-0000-0000-000000000001"

  it("rejects a missing required column", () => {
    const res = parseDailyRowsCsv("foo,bar\n1,2", pid)
    expect(res.errorCount).toBe(1)
    expect(res.rows[0].error).toContain("driver_code")
  })

  it("parses good rows and flags bad ones (partial-failure)", () => {
    const csv = [
      "driver_code,entry_date,shift_label,orders_delivered,orders_failed,orders_returned,gross_revenue,notes",
      "DRV-1,2026-10-01,morning,10,2,1,350.50,ok",
      ",2026-10-01,,1,0,0,10,missing code",
      "DRV-2,01/10/2026,,1,0,0,10,bad date",
    ].join("\n")
    const res = parseDailyRowsCsv(csv, pid)
    expect(res.okCount).toBe(1)
    expect(res.errorCount).toBe(2)
    expect(res.rows[0].ok).toBe(true)
    expect(res.rows[0].orders_delivered).toBe(10)
    expect(res.rows[0].gross_revenue).toBe(350.5)
    expect(res.rows[1].error).toContain("driver_code is required")
    expect(res.rows[2].error).toContain("yyyy-mm-dd")
  })

  it("strips BOM", () => {
    const res = parseDailyRowsCsv("\uFEFFdriver_code,entry_date,gross_revenue\nDRV-1,2026-10-01,50", pid)
    expect(res.okCount).toBe(1)
  })

  it("accepts rows with only revenue", () => {
    const res = parseDailyRowsCsv("driver_code,entry_date,gross_revenue\nDRV-1,2026-10-02,99", pid)
    expect(res.okCount).toBe(1)
  })
})

describe("paymentBalance (invoiced − paid)", () => {
  it("derives paid when received ≥ expected", () => {
    expect(paymentBalance(100, 100, null)).toEqual({ outstanding: 0, status: "paid" })
    expect(paymentBalance(100, 120, "pending")).toEqual({ outstanding: 0, status: "paid" })
  })

  it("derives partial for 0 < received < expected", () => {
    expect(paymentBalance(100, 40, null)).toEqual({ outstanding: 60, status: "partial" })
  })

  it("keeps pending at zero received", () => {
    expect(paymentBalance(100, 0, null)).toEqual({ outstanding: 100, status: "pending" })
  })

  it("never reports a negative outstanding", () => {
    expect(paymentBalance(50, 120, "paid").outstanding).toBe(0)
  })

  it("respects disputed/overdue declarations", () => {
    expect(paymentBalance(100, 10, "disputed").status).toBe("disputed")
    expect(paymentBalance(100, 10, "overdue").status).toBe("overdue")
  })
})

describe("periodKey", () => {
  it("zero-pads the month", () => {
    expect(periodKey(2026, 3)).toBe("2026-03")
    expect(periodKey(2026, 12)).toBe("2026-12")
  })
})

describe("rollupDaily", () => {
  it("aggregates by date and computes delivered %", () => {
    const out = rollupDaily([
      { entry_date: "2026-10-02", orders_delivered: 8, orders_failed: 2, orders_returned: 0, orders_cancelled: 0, gross_revenue: 100 },
      { entry_date: "2026-10-02", orders_delivered: 12, orders_failed: 3, orders_returned: 0, orders_cancelled: 0, gross_revenue: 200 },
      { entry_date: "2026-10-01", orders_delivered: 5, orders_failed: 5, orders_returned: 0, orders_cancelled: 0, gross_revenue: 50 },
    ])
    expect(out).toHaveLength(2)
    expect(out[0].entry_date).toBe("2026-10-01")
    expect(out[0].deliveredPct).toBe(50)
    expect(out[1].orders).toBe(25)
    expect(out[1].delivered).toBe(20)
    expect(out[1].grossRevenue).toBe(300)
  })

  it("leaves deliveredPct null when no orders (absent, not zero-filled)", () => {
    const out = rollupDaily([{ entry_date: "2026-10-03", orders_delivered: 0, orders_failed: 0, orders_returned: 0, orders_cancelled: 0, gross_revenue: 0 }])
    expect(out[0].deliveredPct).toBeNull()
  })
})

describe("rollupMonthly", () => {
  it("maps and sorts by period", () => {
    const out = rollupMonthly([
      { period_year: 2026, period_month: 10, total_delivered: 90, total_revenue: 900 },
      { period_year: 2026, period_month: 9, total_delivered: 80, total_revenue: 800 },
    ])
    expect(out.map((o) => o.period)).toEqual(["2026-09", "2026-10"])
    expect(out[1].delivered).toBe(90)
  })
})
