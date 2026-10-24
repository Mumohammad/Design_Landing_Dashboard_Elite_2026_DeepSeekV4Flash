import { describe, expect, it } from "vitest"
import { attendanceTimestamp, businessTimeInput, parseOperationInput, REVIEW_TRANSITIONS, VIOLATION_TRANSITIONS } from "./schema"

describe("Saudi attendance business time", () => {
  it("combines selected day and clock with Saudi timezone across UTC day boundary", () => {
    expect(attendanceTimestamp("2026-10-21", "00:15")).toBe("2026-10-20T21:15:00.000Z")
    expect(businessTimeInput("2026-10-20T21:15:00Z")).toBe("00:15")
    expect(businessTimeInput("2026-10-21T09:34:00Z")).toBe("12:34")
  })
  it("preserves empty times and zero minute defaults", () => {
    expect(parseOperationInput("attendance", { attendance_date: "2026-10-21", status: "present", check_in_time: null, check_out_time: null, late_minutes: null })).toMatchObject({ check_in_time: null, check_out_time: null, late_minutes: 0, overtime_minutes: 0 })
  })
  it.each(["2026-02-30", "2026-13-01", "21-10-2026"])("rejects invalid date %s", day => expect(() => attendanceTimestamp(day,"09:00")).toThrow())
  it.each(["24:00", "13:60", "9:00", "2026-10-21T09:00:00Z"])("rejects invalid clock %s", clock => expect(() => attendanceTimestamp("2026-10-21",clock)).toThrow())
  it("rejects out-of-order timestamps and invalid minute quantities", () => {
    expect(() => parseOperationInput("attendance", { attendance_date:"2026-10-21",status:"present",check_in_time:"18:00",check_out_time:"09:00" })).toThrow(/Check-out/)
    for (const late_minutes of [-1, 0.5, 32768, NaN]) expect(() => parseOperationInput("attendance", { attendance_date:"2026-10-21",status:"late",late_minutes })).toThrow()
  })
})
describe("operational inputs and histories", () => {
  it("strips caller-supplied ownership and posted state", () => {
    const input = parseOperationInput("violations", { incident_date:"2026-10-21",incident_description:"Test",tenant_id:"foreign",driver_id:"foreign",deduction_applied:true,source:"absher" })
    expect(input).toEqual({ incident_date:"2026-10-21",incident_description:"Test",status:"open",deduction_amount:0 })
  })
  it.each(["pending","confirmed","cancelled","deduction_applied"])("rejects invalid manual violation status %s", status => expect(() => parseOperationInput("violations",{incident_date:"2026-10-21",incident_description:"Test",status})).toThrow())
  it.each([-0.01,1.001,Infinity,100000000])("rejects invalid deduction %s", deduction_amount => expect(() => parseOperationInput("violations",{incident_date:"2026-10-21",incident_description:"Test",deduction_amount})).toThrow())
  it("enforces training expiry, score, and certificate scheme", () => {
    const base={course_name:"Safety",training_date:"2026-10-21",is_passed:true}
    for(const extra of [{expiry_date:"2026-10-20"},{score:101},{certificate_url:"javascript:alert(1)"}]) expect(() => parseOperationInput("training",{...base,...extra})).toThrow()
    expect(parseOperationInput("training",{...base,score:0,certificate_url:null})).toMatchObject({score:0,is_passed:true})
  })
  it("requires all review scores before completion and exposes guarded transitions", () => {
    expect(() => parseOperationInput("performance",{review_period:"2026-10",review_date:"2026-10-21",status:"completed",overall_score:80})).toThrow(/all scores/)
    expect(REVIEW_TRANSITIONS.pending).not.toContain("completed")
    expect(REVIEW_TRANSITIONS.completed).toEqual(["completed"])
    expect(VIOLATION_TRANSITIONS.open).not.toContain("resolved")
    expect(VIOLATION_TRANSITIONS.under_review).toContain("resolved")
  })
})
