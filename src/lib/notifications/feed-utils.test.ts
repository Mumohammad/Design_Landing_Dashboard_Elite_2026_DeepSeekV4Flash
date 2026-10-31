import { describe, expect, it } from "vitest"
import { buildNotificationFeed, daysBetween, expirySeverity, notificationStatus } from "./feed-utils"

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
