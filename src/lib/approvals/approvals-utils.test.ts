import { describe, expect, it } from "vitest"

import {
  APPROVALS_PAGE_SIZE_DEFAULT,
  APPROVALS_PAGE_SIZE_MAX,
  APPROVAL_ITEM_TYPES,
  APPROVAL_TYPE_META,
  EMPTY_FILTERS,
  approvalsToCsv,
  dateRangeBounds,
  decisionErrorText,
  isDecisionErrorCode,
  isFiltersActive,
  isStale,
  itemDeepLink,
  maskRequesterName,
  pendingAgeDays,
  subjectLine,
  type ApprovalQueueRow,
} from "./approvals-utils"

function row(
  partial: Partial<ApprovalQueueRow> & { item_type: ApprovalQueueRow["item_type"] }
): ApprovalQueueRow {
  return {
    item_id: "11111111-1111-1111-1111-111111111111",
    subject: "SUBJ",
    subject_meta: {},
    requester: "",
    requested_at: new Date("2026-09-20T08:00:00Z").toISOString(),
    ...partial,
  }
}

describe("queue composition", () => {
  it("covers exactly the three pre-existing decision sources", () => {
    expect(APPROVAL_ITEM_TYPES).toEqual(["expense", "leave_request", "application"])
  })

  it("maps each source to its owning module + deep link target", () => {
    expect(APPROVAL_TYPE_META.expense.module).toBe("expenses")
    expect(APPROVAL_TYPE_META.leave_request.module).toBe("attendance")
    expect(APPROVAL_TYPE_META.application.module).toBe("hr")
    expect(APPROVAL_TYPE_META.application.entity).toBe("driver_application")
  })

  it("keeps the hard pagination caps", () => {
    expect(APPROVALS_PAGE_SIZE_MAX).toBe(100)
    expect(APPROVALS_PAGE_SIZE_DEFAULT).toBe(50)
  })
})

describe("subjectLine", () => {
  it("renders expense subjects as code + amount + currency", () => {
    const line = subjectLine(
      row({ item_type: "expense", subject: "EXP-2026-000001", subject_meta: { amount: 1250.5, currency: "SAR" } }),
      false
    )
    expect(line).toBe("EXP-2026-000001 — 1,250.50 SAR")
  })

  it("renders leave subjects as type + day count (bilingual)", () => {
    const r = row({ item_type: "leave_request", subject: "Annual", subject_meta: { leave_type: "annual", days_requested: 5 } })
    expect(subjectLine(r, false)).toBe("annual · 5 days")
    expect(subjectLine(r, true)).toBe("annual · 5 أيام")
  })

  it("renders application subjects as the applicant name", () => {
    const line = subjectLine(
      row({ item_type: "application", subject: "DRV-2026-000042", subject_meta: { full_name: "سعيد علي" } }),
      false
    )
    expect(line).toBe("سعيد علي")
  })
})

describe("maskRequesterName", () => {
  it("masks applicant names to initials when consent is absent", () => {
    expect(maskRequesterName("application", "", "Ahmed Mohamed Saleh", false)).toBe("A. M. S.")
  })

  it("passes applicant names through when consent is granted", () => {
    expect(maskRequesterName("application", "", "Ahmed Mohamed", true)).toBe("Ahmed Mohamed")
  })

  it("never masks expense vendors or leave requesters", () => {
    expect(maskRequesterName("expense", "شركة الوقود", null, false)).toBe("شركة الوقود")
    expect(maskRequesterName("leave_request", "HR Officer", null, false)).toBe("HR Officer")
  })

  it("falls back to a dash for absent names", () => {
    expect(maskRequesterName("application", "", "  ", false)).toBe("—")
  })
})

describe("pendingAgeDays / isStale", () => {
  const now = new Date("2026-09-24T12:00:00Z")

  it("computes whole-day ages", () => {
    expect(pendingAgeDays("2026-09-23T12:00:00Z", now)).toBe(1)
    expect(pendingAgeDays("2026-09-20T12:00:00Z", now)).toBe(4)
  })

  it("clamps future timestamps to zero", () => {
    expect(pendingAgeDays("2026-09-25T12:00:00Z", now)).toBe(0)
  })

  it("marks items older than the 3-day threshold as stale", () => {
    expect(isStale("2026-09-21T12:00:00Z", now)).toBe(true)
    expect(isStale("2026-09-23T12:00:00Z", now)).toBe(false)
  })
})

describe("decision error surface", () => {
  it("recognizes the double-decision guard codes", () => {
    expect(isDecisionErrorCode("LVE002: leave request already decided")).toBe(true)
    expect(isDecisionErrorCode("APP002: application already decided")).toBe(true)
  })

  it("does not classify unknown messages", () => {
    expect(isDecisionErrorCode("some other failure")).toBe(false)
  })

  it("maps codes to a bilingual envelope and passes unknown text through", () => {
    expect(decisionErrorText("LVE002: leave request already decided", true)).toBe("تم البت في هذا الطلب مسبقاً")
    expect(decisionErrorText("LVE002: leave request already decided", false)).toBe(
      "This leave request was already decided"
    )
    expect(decisionErrorText("some other failure", false)).toBe("some other failure")
  })
})

describe("filters", () => {
  it("keeps the empty state and detects activity", () => {
    expect(EMPTY_FILTERS).toEqual({ from: "", to: "", type: "all" })
    expect(isFiltersActive(EMPTY_FILTERS)).toBe(false)
    expect(isFiltersActive({ ...EMPTY_FILTERS, type: "expense" })).toBe(true)
    expect(isFiltersActive({ ...EMPTY_FILTERS, from: "2026-09-01" })).toBe(true)
  })

  it("expands yyyy-mm-dd into inclusive local bounds", () => {
    expect(dateRangeBounds("2026-09-01", "2026-09-24")).toEqual({
      fromIso: "2026-09-01T00:00:00",
      toIso: "2026-09-24T23:59:59.999",
    })
    expect(dateRangeBounds("", "2026-09-24")).toEqual({ fromIso: null, toIso: "2026-09-24T23:59:59.999" })
    expect(dateRangeBounds("not-a-date", "")).toEqual({ fromIso: null, toIso: null })
  })
})

describe("itemDeepLink", () => {
  it("deep-links applications to their detail route", () => {
    const href = itemDeepLink(row({ item_type: "application", item_id: "app-1" }))
    expect(href).toBe("/applications/app-1")
  })

  it("deep-links leave requests to the owning driver profile", () => {
    const href = itemDeepLink(
      row({ item_type: "leave_request", item_id: "lr-1", subject_meta: { driver_id: "drv-9" } })
    )
    expect(href).toBe("/drivers/drv-9")
  })

  it("falls back to the module surface when the driver id is absent", () => {
    expect(itemDeepLink(row({ item_type: "leave_request", item_id: "lr-1" }))).toBe("/drivers")
    expect(itemDeepLink(row({ item_type: "expense", item_id: "e-1" }))).toBe("/expenses")
  })
})

describe("approvalsToCsv", () => {
  it("prepends a UTF-8 BOM and escapes RFC-4180 specials", () => {
    const csv = approvalsToCsv(["a", "b"], [["x,y", 'he said "hi"'], ["line1\nline2", 5]])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const body = csv.slice(1)
    expect(body.startsWith('a,b\n"x,y","he said ""hi"""\n')).toBe(true)
    expect(body.endsWith('"line1\nline2",5')).toBe(true)
  })
})
