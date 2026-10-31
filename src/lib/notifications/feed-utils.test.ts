import { describe, expect, it } from "vitest"
import { buildNotificationFeed, daysBetween, expirySeverity, notificationStatus, notificationTitle } from "./feed-utils"

const today = "2026-11-01"

describe("notification feed", () => {
  it("computes day offsets and severities", () => {
    expect(daysBetween(today, "2026-11-04")).toBe(3)
    expect(daysBetween(today, "2026-10-30")).toBe(-2)
    expect(daysBetween(today, "bad")).toBeNull()
    expect(expirySeverity(-1)).toBe("critical")
    expect(expirySeverity(7)).toBe("warning")
    expect(expirySeverity(8)).toBe("info")
  })

  it("collects expiries within the horizon, sorted by severity then date", () => {
    const feed = buildNotificationFeed({
      todayIso: today,
      generatedAt: "x",
      drivers: [{ id: "d1", full_name_ar: "أحمد", full_name_en: null, iqama_expiry_date: "2026-11-20", license_expiry_date: "2026-10-01", passport_expiry_date: "2027-06-01", contract_end: null }],
      vehicles: [{ id: "v1", plate_number: "أ ب ج 123", insurance_expiry: "2026-11-05", registration_expiry: null, operating_card_expiry: "2026-12-31", rental_contract_end: null }],
      receivables: [
        { id: "r1", invoice_ref: "INV-1", due_date: "2026-10-25", total_amount: "115", paid_amount: "15" },
        { id: "r2", invoice_ref: "INV-2", due_date: "2026-10-25", total_amount: 50, paid_amount: 50 },
        { id: "r3", invoice_ref: "INV-3", due_date: "2026-11-10", total_amount: 50, paid_amount: 0 },
      ],
      pendingApprovals: 2,
    })
    expect(feed.items.map((i) => i.kind)).toEqual([
      "driver_license",
      "invoice_overdue",
      "vehicle_insurance",
      "driver_iqama",
      "approvals_pending",
    ])
    expect(feed.critical).toBe(1)
    expect(feed.items[1].amount).toBe(100)
    expect(feed.items[0].id).toBe("driver_license:d1:2026-10-01")
    expect(feed.items[0].href).toBe("/drivers/d1")
  })

  it("respects the limit but reports the full total", () => {
    const vehicles = Array.from({ length: 5 }, (_, i) => ({ id: `v${i}`, plate_number: null, insurance_expiry: "2026-11-02", registration_expiry: null, operating_card_expiry: null, rental_contract_end: null }))
    const feed = buildNotificationFeed({ todayIso: today, vehicles, limit: 3 })
    expect(feed.items).toHaveLength(3)
    expect(feed.total).toBe(5)
  })

  it("formats localized status lines", () => {
    const base = { id: "a", kind: "driver_iqama" as const, severity: "critical" as const, subject: "x", date: today, href: "/" }
    expect(notificationStatus({ ...base, days: -3 }, "ar")).toBe("انتهت منذ 3 يوم")
    expect(notificationStatus({ ...base, days: 0 }, "en")).toBe("Expires today")
    expect(notificationStatus({ ...base, days: 1 }, "en")).toBe("Expires in 1 day")
    expect(notificationStatus({ ...base, kind: "invoice_overdue", days: -2 }, "en")).toBe("2 days overdue")
  })
})

describe("notification feed — documents, maintenance, finance, categories", () => {
  it("covers every dashboard source and filters by category", () => {
    const feed = buildNotificationFeed({
      todayIso: today,
      driverDocuments: [{ id: "dd1", owner_id: "d1", owner_label: "سالم", document_type: "medical_certificate", expiry_date: "2026-11-03" }],
      vehicleDocuments: [{ id: "vd1", owner_id: "v1", owner_label: "ABC 1", document_type: "insurance", expiry_date: "2026-10-31" }],
      vehicleInspections: [{ id: "v2", plate_number: "XYZ 2", inspection_expiry: "2026-11-25" }],
      maintenance: [
        { vehicle_id: "v1", plate_number: "ABC 1", next_service_date: "2026-11-02" },
        { vehicle_id: "v1", plate_number: "ABC 1", next_service_date: "2026-11-20" },
      ],
      payables: [
        { id: "p1", invoice_ref: "BILL-1", due_date: "2026-11-04", total_amount: 200, paid_amount: 0 },
        { id: "p2", invoice_ref: "BILL-2", due_date: "2026-12-30", total_amount: 200, paid_amount: 0 },
      ],
      openViolations: 4,
    })
    const kinds = feed.items.map((i) => i.kind)
    expect(kinds).toContain("driver_document")
    expect(kinds).toContain("vehicle_document")
    expect(kinds).toContain("vehicle_inspection")
    expect(kinds).toContain("violations_open")
    expect(feed.items.filter((i) => i.kind === "maintenance_due")).toHaveLength(1)
    expect(feed.items.find((i) => i.kind === "maintenance_due")?.date).toBe("2026-11-20")
    expect(feed.items.filter((i) => i.kind === "payable_due").map((i) => i.subject)).toEqual(["BILL-1"])
    expect(notificationTitle("driver_document", "ar", "medical_certificate")).toBe("الشهادة الصحية")

    const onlyFinance = buildNotificationFeed({
      todayIso: today,
      payables: [{ id: "p1", invoice_ref: "BILL-1", due_date: "2026-11-04", total_amount: 200, paid_amount: 0 }],
      openViolations: 4,
      categories: ["finance"],
    })
    expect(onlyFinance.items.map((i) => i.kind)).toEqual(["payable_due"])
  })
})
