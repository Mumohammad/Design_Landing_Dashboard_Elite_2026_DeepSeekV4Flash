import { describe, expect, it } from "vitest"
import { buildClearanceCertificateHtml, clearanceProgress, OFFBOARDING_MANUAL_KEYS, type SystemCheck } from "./clearance-certificate"

const checks: SystemCheck[] = [
  { key: "vehicle", label: "Vehicle returned", labelAr: "x", ok: true, detail: "", detailAr: "", blocking: true },
  { key: "violations", label: "Open violations", labelAr: "x", ok: false, detail: "2 open", detailAr: "", blocking: false },
]
const manual = OFFBOARDING_MANUAL_KEYS.map((key) => ({ key, done: true, at: null, note: null }))

describe("clearance certificate", () => {
  it("is ready when manual items and blocking checks pass", () => {
    expect(clearanceProgress(manual, checks)).toEqual({ done: 8, total: 9, ready: true })
    expect(clearanceProgress([{ ...manual[0], done: false }, ...manual.slice(1)], checks).ready).toBe(false)
    expect(clearanceProgress(manual, [{ ...checks[0], ok: false }]).ready).toBe(false)
  })
  it("escapes driver data and marks drafts", () => {
    const html = buildClearanceCertificateHtml({
      company: "Acme", ref: null, driver: { name: "<b>x</b>", code: "D1", iqama: null, nationality: null, joinDate: null },
      exitType: "resignation", reason: null, lastWorkingDay: "2026-11-01", completedAt: null, settlementAmount: 1500, settlementNotes: null, systemChecks: checks, manual,
    })
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;")
    expect(html).toContain("Draft")
    expect(html).toContain("1,500.00 SAR")
    expect(html).toContain("Resignation")
  })
})
