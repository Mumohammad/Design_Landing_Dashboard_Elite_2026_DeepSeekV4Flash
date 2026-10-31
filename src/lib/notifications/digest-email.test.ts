import { describe, expect, it } from "vitest"
import { buildNotificationFeed } from "./feed-utils"
import { buildDigestEmail, escapeHtml } from "./digest-email"
import { DEFAULT_DIGEST_SETTINGS, digestDueOn, digestSettingsSchema, settingsFromRow, weekdayOf } from "./digest-schema"

describe("digest email", () => {
  it("groups alerts by category and escapes user data", () => {
    const feed = buildNotificationFeed({
      todayIso: "2026-11-01",
      drivers: [{ id: "d1", full_name_ar: "<b>أحمد</b>", full_name_en: null, iqama_expiry_date: "2026-10-20", license_expiry_date: null, passport_expiry_date: null, contract_end: null }],
      openViolations: 2,
    })
    const mail = buildDigestEmail({ companyName: "Elite", feed, todayIso: "2026-11-01", appUrl: "https://app.example", frequency: "daily" })
    expect(mail.subject).toContain("2 تنبيه")
    expect(mail.subject).toContain("1 عاجل")
    expect(mail.html).toContain("السائقون")
    expect(mail.html).toContain("المخالفات")
    expect(mail.html).not.toContain("<b>أحمد</b>")
    expect(mail.html).toContain("https://app.example/drivers/d1")
    expect(mail.text).toContain("Iqama")
  })

  it("renders an all-clear digest", () => {
    const mail = buildDigestEmail({ companyName: "Elite", feed: buildNotificationFeed({ todayIso: "2026-11-01" }), todayIso: "2026-11-01", appUrl: "", frequency: "weekly", test: true })
    expect(mail.subject).toMatch(/^\[تجربة/)
    expect(mail.subject).toContain("لا توجد تنبيهات")
  })

  it("escapes html", () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;")
  })
})

describe("digest settings", () => {
  it("falls back to defaults and validates recipients", () => {
    expect(settingsFromRow(null)).toEqual(DEFAULT_DIGEST_SETTINGS)
    expect(digestSettingsSchema.safeParse({ ...DEFAULT_DIGEST_SETTINGS, recipient_roles: [], extra_recipients: [] }).success).toBe(false)
    expect(digestSettingsSchema.safeParse({ ...DEFAULT_DIGEST_SETTINGS, extra_recipients: ["not-an-email"] }).success).toBe(false)
    expect(digestSettingsSchema.safeParse({ ...DEFAULT_DIGEST_SETTINGS, extra_recipients: ["CFO@Example.com"] }).data?.extra_recipients).toEqual(["cfo@example.com"])
  })

  it("schedules daily and weekly digests", () => {
    expect(weekdayOf("2026-11-01")).toBe(0) // Sunday
    expect(digestDueOn(DEFAULT_DIGEST_SETTINGS, "2026-11-03")).toBe(true)
    const weekly = { ...DEFAULT_DIGEST_SETTINGS, frequency: "weekly" as const, weekly_day: 0 }
    expect(digestDueOn(weekly, "2026-11-01")).toBe(true)
    expect(digestDueOn(weekly, "2026-11-02")).toBe(false)
    expect(digestDueOn({ ...DEFAULT_DIGEST_SETTINGS, enabled: false }, "2026-11-01")).toBe(false)
  })
})
