import { describe, expect, it } from "vitest"
import { attendanceScore, buildScorecard, complianceScore, conductScore, gradeFor, productivityScore } from "./scorecard"

describe("scorecard pillars", () => {
  it("scores attendance ignoring leave and days off", () => {
    expect(attendanceScore([{ status: "present" }, { status: "late" }, { status: "day_off" }, { status: "absent_unexcused" }])).toBe(62)
    expect(attendanceScore([{ status: "on_leave" }])).toBeNull()
  })
  it("penalises violations by severity, ignoring waived", () => {
    expect(conductScore([{ severity: "major", status: "open" }, { severity: "minor", status: "waived" }])).toBe(80)
    expect(conductScore([{ severity: "critical", status: "open" }, { severity: "critical", status: "open" }, { severity: "critical", status: "open" }])).toBe(0)
  })
  it("blends delivery success and pace", () => {
    expect(productivityScore([{ total_delivered: 400, total_failed: 0, total_returned: 0, working_days: 20 }])).toBe(100)
    expect(productivityScore([])).toBeNull()
  })
  it("grades document validity", () => {
    expect(complianceScore(["2030-01-01", "2026-01-10", "2025-01-01"], "2026-01-01")).toBe(53)
    expect(complianceScore([], "2026-01-01")).toBeNull()
  })
  it("maps grades", () => {
    expect(gradeFor(95).grade).toBe("A+")
    expect(gradeFor(55).tone).toBe("risk")
  })
})

describe("buildScorecard", () => {
  it("re-normalises over available pillars", () => {
    const s = buildScorecard({ todayIso: "2026-01-01", attendance: [{ status: "present" }], violations: [], orders: [], documents: [], latestReview: null })
    expect(s.overall).toBe(100)
    expect(s.grade).toBe("A+")
  })
  it("does not grade on conduct alone", () => {
    const s = buildScorecard({ todayIso: "2026-01-01", attendance: [], violations: [], orders: [], documents: [], latestReview: null })
    expect(s.overall).toBeNull()
  })
})
