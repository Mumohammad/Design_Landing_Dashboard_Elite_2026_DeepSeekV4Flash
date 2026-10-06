import { describe, expect, it } from "vitest"
import {
  externalFineImportRowSchema,
  ledgerApplySchema,
  ledgerRollbackSchema,
  violationApproveSchema,
  violationWaiveSchema,
} from "@/types/violations-module"
import {
  buildViolationTimeline,
  canApplyToPeriod,
  canRollbackFromPeriod,
  deductionMonthKey,
  deductionMonthOptions,
  fineSourceToViolationSource,
  isViolationTransitionAllowed,
  isWaiverOverLimit,
  parseFinesCsv,
  violationKpis,
} from "./module-utils"

describe("violation status machine", () => {
  it("allows open → under_review/resolved/waived", () => {
    expect(isViolationTransitionAllowed("open", "under_review")).toBe(true)
    expect(isViolationTransitionAllowed("open", "resolved")).toBe(true)
    expect(isViolationTransitionAllowed("open", "waived")).toBe(true)
  })

  it("allows under_review → resolved/waived and the deduction round-trip", () => {
    expect(isViolationTransitionAllowed("under_review", "resolved")).toBe(true)
    expect(isViolationTransitionAllowed("under_review", "waived")).toBe(true)
    expect(isViolationTransitionAllowed("resolved", "deduction_applied")).toBe(true)
    expect(isViolationTransitionAllowed("deduction_applied", "resolved")).toBe(true)
  })

  it("refuses skips and terminal states", () => {
    expect(isViolationTransitionAllowed("open", "deduction_applied")).toBe(false)
    expect(isViolationTransitionAllowed("waived", "resolved")).toBe(false)
    expect(isViolationTransitionAllowed("resolved", "waived")).toBe(false)
    expect(isViolationTransitionAllowed("closed", "open")).toBe(false)
    expect(isViolationTransitionAllowed(null, "resolved")).toBe(false)
  })
})

describe("violationKpis", () => {
  const now = new Date("2026-10-06T12:00:00Z")

  it("counts open/under-review violations and ledger SAR totals", () => {
    const kpis = violationKpis(
      [
        { status: "open" },
        { status: "open" },
        { status: "under_review" },
        { status: "waived" },
      ],
      [
        { deduction_amount: 300, status: "applied", applied_at: "2026-10-02T09:00:00Z" },
        { deduction_amount: 120.5, status: "applied", applied_at: "2026-10-05T09:00:00Z" },
        { deduction_amount: 80, status: "applied", applied_at: "2026-09-15T09:00:00Z" },
        { deduction_amount: 200, status: "pending", applied_at: null },
      ],
      now
    )
    expect(kpis.open).toBe(2)
    expect(kpis.underReview).toBe(1)
    expect(kpis.deductedThisMonth).toBe(420.5)
    expect(kpis.totalDeductions).toBe(500.5)
  })

  it("ignores rolled_back/cancelled ledger rows and empty inputs", () => {
    const kpis = violationKpis(
      [],
      [
        { deduction_amount: 90, status: "rolled_back", applied_at: "2026-10-01T09:00:00Z" },
        { deduction_amount: 90, status: "cancelled", applied_at: "2026-10-01T09:00:00Z" },
      ],
      now
    )
    expect(kpis).toEqual({ open: 0, underReview: 0, deductedThisMonth: 0, totalDeductions: 0 })
  })
})

describe("buildViolationTimeline", () => {
  it("composes reported → reviewed → queued → applied → rolled_back in order", () => {
    const events = buildViolationTimeline(
      {
        reported_at: "2026-10-01T08:00:00Z",
        reported_by: "user-1",
        reviewed_at: "2026-10-02T10:00:00Z",
        reviewed_by: "user-2",
        waived_at: null,
        waived_by: null,
      },
      [
        { status: "pending", created_at: "2026-10-02T10:00:01Z", applied_at: null, rolled_back_at: "2026-10-04T09:00:00Z", rollback_reason: "wrong month" },
        { status: "pending", created_at: "2026-10-02T10:00:02Z", applied_at: "2026-10-03T09:00:00Z", rolled_back_at: null, rollback_reason: null },
      ]
    )
    // Two ledger rows ⇒ two queued events (re-queue after rollback creates a new row).
    expect(events.map((e) => e.key)).toEqual(["reported", "reviewed", "queued", "queued", "applied", "rolled_back"])
    expect(events[0].by).toBe("user-1")
    expect(events[5].note).toBe("wrong month")
  })

  it("includes the waive event with its mandatory reason and omits missing timestamps", () => {
    const events = buildViolationTimeline({
      reported_at: "2026-10-01T08:00:00Z",
      reported_by: null,
      reviewed_at: null,
      reviewed_by: null,
      waived_at: "2026-10-03T09:00:00Z",
      waived_by: "gm-1",
      waiver_reason: "driver not at fault",
    })
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ key: "waived", by: "gm-1", note: "driver not at fault" })
  })
})

describe("waiver limit", () => {
  it("flags amounts above the configured limit only", () => {
    expect(isWaiverOverLimit(500, 500)).toBe(false)
    expect(isWaiverOverLimit(500.01, 500)).toBe(true)
    expect(isWaiverOverLimit(10_000, null)).toBe(false)
    expect(isWaiverOverLimit(0, 0)).toBe(false)
  })
})

describe("deduction month helpers", () => {
  it("derives yyyy-mm keys", () => {
    expect(deductionMonthKey(new Date("2026-10-06T12:00:00Z"))).toBe("2026-10")
    expect(deductionMonthKey("2026-01-31")).toBe("2026-01")
  })

  it("builds count months starting at the current month (UTC)", () => {
    expect(deductionMonthOptions(new Date("2026-12-31T10:00:00Z"), 3)).toEqual(["2026-12", "2027-01", "2027-02"])
  })
})

describe("payroll-period guards", () => {
  it("applies only to draft/calculated periods", () => {
    expect(canApplyToPeriod("draft")).toBe(true)
    expect(canApplyToPeriod("calculated")).toBe(true)
    expect(canApplyToPeriod("in_review")).toBe(false)
    expect(canApplyToPeriod("approved")).toBe(false)
    expect(canApplyToPeriod("locked")).toBe(false)
    expect(canApplyToPeriod("paid")).toBe(false)
    expect(canApplyToPeriod("cancelled")).toBe(false)
    expect(canApplyToPeriod(null)).toBe(false)
  })

  it("refuses rollback after the period is locked or paid", () => {
    expect(canRollbackFromPeriod("draft")).toBe(true)
    expect(canRollbackFromPeriod("calculated")).toBe(true)
    expect(canRollbackFromPeriod("approved")).toBe(true)
    expect(canRollbackFromPeriod("locked")).toBe(false)
    expect(canRollbackFromPeriod("paid")).toBe(false)
    expect(canRollbackFromPeriod(null)).toBe(true)
  })
})

describe("fines CSV parsing", () => {
  it("rejects a missing external_ref column", () => {
    const res = parseFinesCsv("foo,bar\n1,2")
    expect(res.errorCount).toBe(1)
    expect(res.rows[0].error).toContain("external_ref")
  })

  it("parses good rows and flags bad ones (partial-failure)", () => {
    const csv = [
      "external_ref,external_source,vehicle_plate,violation_date,violation_location,violation_type_code,fine_amount,payment_deadline,match_notes",
      "NG-9001,najm,أ ب ج 1234,2026-09-28,King Fahd Rd,SPEED-01,300,2026-10-12,camera fine",
      ",2026-09-28,,,,,,missing ref",
      "NG-9002,najm,XYZ,28/09/2026,,,,,bad date",
      "NG-9003,moi,XYZ,2026-09-29,,,,,",
    ].join("\n")
    const res = parseFinesCsv(csv)
    expect(res.okCount).toBe(2)
    expect(res.errorCount).toBe(2)
    expect(res.rows[0].ok).toBe(true)
    expect(res.rows[0].fine_amount).toBe(300)
    expect(res.rows[1].error).toContain("external_ref is required")
    expect(res.rows[2].error).toContain("yyyy-mm-dd")
    // Optional columns default to "" / null.
    expect(res.rows[3].violation_type_code).toBe("")
    expect(res.rows[3].fine_amount).toBeNull()
  })

  it("rejects negative fine amounts", () => {
    const res = parseFinesCsv("external_ref,fine_amount\nNG-1,-5")
    expect(res.errorCount).toBe(1)
    expect(res.rows[0].error).toContain("≥ 0")
  })

  it("strips the BOM", () => {
    const res = parseFinesCsv("\uFEFFexternal_ref\nNG-77")
    expect(res.okCount).toBe(1)
  })
})

describe("fineSourceToViolationSource", () => {
  it("maps government sources through and falls back to manual", () => {
    expect(fineSourceToViolationSource("najm")).toBe("najm")
    expect(fineSourceToViolationSource("moi")).toBe("moi")
    expect(fineSourceToViolationSource("absher")).toBe("absher")
    expect(fineSourceToViolationSource("manual")).toBe("manual")
    expect(fineSourceToViolationSource("traffic_dept")).toBe("manual")
    expect(fineSourceToViolationSource(null)).toBe("manual")
  })
})

describe("zod contracts", () => {
  // zod 4 validates RFC-9562 uuids (version/variant nibbles must be valid).
  const U1 = "9f1c0000-0000-4000-8000-000000000001"
  const U2 = "9f1c0000-0000-4000-8000-000000000002"

  it("approve requires a yyyy-mm deduction month when provided", () => {
    expect(violationApproveSchema.safeParse({ id: U1, deduction_month: "2026-13" }).success).toBe(false)
    expect(violationApproveSchema.safeParse({ id: U1, deduction_month: "2026-10" }).success).toBe(true)
  })

  it("waive demands a real reason", () => {
    expect(violationWaiveSchema.safeParse({ id: U1, waiver_reason: "ab" }).success).toBe(false)
    expect(violationWaiveSchema.safeParse({ id: U1, waiver_reason: "driver was not at fault" }).success).toBe(true)
  })

  it("rollback demands a reason; apply takes uuids only", () => {
    expect(ledgerRollbackSchema.safeParse({ ledger_id: U1, reason: "no" }).success).toBe(false)
    expect(ledgerRollbackSchema.safeParse({ ledger_id: U1, reason: "queued to the wrong month" }).success).toBe(true)
    expect(ledgerApplySchema.safeParse({ ledger_id: U1, payroll_period_id: U2 }).success).toBe(true)
  })

  it("fine rows validate dates and amounts", () => {
    expect(externalFineImportRowSchema.safeParse({ external_ref: "NG-1", violation_date: "2026-09-28", fine_amount: 300 }).success).toBe(true)
    expect(externalFineImportRowSchema.safeParse({ external_ref: "NG-1", fine_amount: -1 }).success).toBe(false)
    expect(externalFineImportRowSchema.safeParse({ external_ref: "NG-1", violation_date: "09/28/2026" }).success).toBe(false)
  })
})
