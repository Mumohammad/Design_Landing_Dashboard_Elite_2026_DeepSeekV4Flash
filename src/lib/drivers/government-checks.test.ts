import { describe, expect, it } from "vitest"
import { addDays, summarizeGovChecks, type GovCheckRow } from "./government-checks"

const row = (p: Partial<GovCheckRow>): GovCheckRow => ({ id: Math.random().toString(), check_type: "muqeem", result: "ok", reference: null, notes: null, checked_on: "2026-10-01", next_due_on: null, created_at: "2026-10-01T10:00:00Z", ...p })

describe("government checks", () => {
  it("uses the latest check and cadence to flag overdue items", () => {
    const s = summarizeGovChecks([row({ checked_on: "2026-08-01" }), row({ checked_on: "2026-10-01" }), row({ check_type: "absher", checked_on: "2026-10-20" })], "2026-11-01")
    expect(s.muqeem).toMatchObject({ state: "due", dueOn: "2026-10-31" })
    expect(s.absher.state).toBe("due")
    expect(s.gosi.state).toBe("never")
  })
  it("honours explicit next due dates and issue results", () => {
    const s = summarizeGovChecks([row({ next_due_on: "2027-01-01" }), row({ check_type: "qiwa", result: "issue" })], "2026-11-01")
    expect(s.muqeem).toMatchObject({ state: "ok", dueOn: "2027-01-01" })
    expect(s.qiwa.state).toBe("issue")
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
  })
})
