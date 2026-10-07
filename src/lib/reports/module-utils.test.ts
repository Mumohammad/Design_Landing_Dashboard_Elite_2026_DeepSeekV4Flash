import { describe, expect, it } from "vitest"
import {
  REPORT_CATALOG,
  canArchiveDoc,
  canPrintDoc,
  formatBytes,
  isCatalogReportType,
  isReportExpired,
  monthRange,
} from "./module-utils"

describe("REPORT_CATALOG", () => {
  it("offers the eight live-table reports and never the legacy custom echo", () => {
    expect(REPORT_CATALOG).toHaveLength(8)
    const types = REPORT_CATALOG.map((e) => e.type as string)
    expect(types).not.toContain("custom")
    expect(new Set(types).size).toBe(8)
  })

  it("marks the period-filtered reports", () => {
    const byType = Object.fromEntries(REPORT_CATALOG.map((e) => [e.type, e.requiresPeriod]))
    expect(byType.payroll_summary).toBe(true)
    expect(byType.revenue).toBe(true)
    expect(byType.attendance_summary).toBe(true)
    expect(byType.executive_dashboard).toBe(true)
    expect(byType.hs_reconciliation).toBe(true)
    expect(byType.driver_performance).toBe(false)
    expect(byType.fleet_cost).toBe(false)
    expect(byType.violations_report).toBe(false)
  })

  it("isCatalogReportType narrows correctly", () => {
    expect(isCatalogReportType("payroll_summary")).toBe(true)
    expect(isCatalogReportType("custom")).toBe(false)
    expect(isCatalogReportType("nope")).toBe(false)
  })
})

describe("monthRange", () => {
  it("returns the first to the real last day of a 31-day month", () => {
    expect(monthRange(2026, 1)).toEqual({ start: "2026-01-01", end: "2026-01-31" })
  })

  it("returns 30 days for September (the regression: no -31 literal)", () => {
    expect(monthRange(2026, 9)).toEqual({ start: "2026-09-01", end: "2026-09-30" })
  })

  it("returns 28 days for a non-leap February and 29 for a leap one", () => {
    expect(monthRange(2026, 2)).toEqual({ start: "2026-02-01", end: "2026-02-28" })
    expect(monthRange(2024, 2)).toEqual({ start: "2024-02-01", end: "2024-02-29" })
  })

  it("wraps December correctly (no month 13)", () => {
    expect(monthRange(2026, 12)).toEqual({ start: "2026-12-01", end: "2026-12-31" })
  })
})

describe("isReportExpired", () => {
  const now = new Date("2026-10-07T12:00:00Z")

  it("is expired when the expiry instant has passed", () => {
    expect(isReportExpired("2026-10-07T11:59:59Z", now)).toBe(true)
  })

  it("is live while the signed URL window is open", () => {
    expect(isReportExpired("2026-10-07T12:00:01Z", now)).toBe(false)
  })

  it("treats missing or unparseable expiry as expired (fail closed)", () => {
    expect(isReportExpired(null, now)).toBe(true)
    expect(isReportExpired(undefined, now)).toBe(true)
    expect(isReportExpired("not-a-date", now)).toBe(true)
  })
})

describe("formatBytes", () => {
  it("formats the empty/zero case as an em-dash", () => {
    expect(formatBytes(null)).toBe("—")
    expect(formatBytes(0)).toBe("—")
  })

  it("formats bytes, KB and MB", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2048)).toBe("2.0 KB")
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB")
  })
})

describe("document status transitions", () => {
  it("printing is allowed from draft/generated only", () => {
    expect(canPrintDoc("draft")).toBe(true)
    expect(canPrintDoc("generated")).toBe(true)
    expect(canPrintDoc("printed")).toBe(false)
    expect(canPrintDoc("archived")).toBe(false)
    expect(canPrintDoc(null)).toBe(false)
  })

  it("archiving is allowed for any live status except archived", () => {
    expect(canArchiveDoc("draft")).toBe(true)
    expect(canArchiveDoc("generated")).toBe(true)
    expect(canArchiveDoc("printed")).toBe(true)
    expect(canArchiveDoc("archived")).toBe(false)
    expect(canArchiveDoc(null)).toBe(false)
  })
})
