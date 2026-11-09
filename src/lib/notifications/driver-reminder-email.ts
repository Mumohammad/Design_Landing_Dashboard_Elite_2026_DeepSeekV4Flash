// Driver-facing document expiry reminder (pure builder; bilingual AR/EN).
import { escapeHtml } from "./digest-email"

export const DRIVER_REMINDER_DAYS = [30, 14, 7, 1] as const

export interface DriverReminderItem { labelAr: string; labelEn: string; date: string; days: number }

export function reminderDates(todayIso: string): Map<string, number> {
  const base = Date.parse(`${todayIso}T00:00:00Z`)
  return new Map(DRIVER_REMINDER_DAYS.map((d) => [new Date(base + d * 86_400_000).toISOString().slice(0, 10), d]))
}

export function buildDriverReminderEmail(input: { name: string; company: string; items: DriverReminderItem[] }) {
  const soonest = Math.min(...input.items.map((i) => i.days))
  const subject = soonest <= 1
    ? `تنتهي وثيقتك غداً · Your document expires tomorrow — ${input.company}`
    : `تذكير بتجديد الوثائق · Document renewal reminder (${soonest} days) — ${input.company}`
  const rows = input.items.map((i) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">${escapeHtml(i.labelAr)} · ${escapeHtml(i.labelEn)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace">${escapeHtml(i.date)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;color:${i.days <= 7 ? "#b91c1c" : "#b45309"};font-weight:600">${i.days} ${i.days === 1 ? "day / يوم" : "days / يوم"}</td></tr>`).join("")
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Segoe UI,Tahoma,Arial,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
<div style="background:linear-gradient(135deg,#0f1e33,#1e3a8a);color:#fff;padding:20px 24px"><div style="font-size:13px;opacity:.8">${escapeHtml(input.company)}</div><div style="font-size:20px;font-weight:700;margin-top:4px">تذكير بتجديد الوثائق · Document renewal reminder</div></div>
<div style="padding:20px 24px">
<p dir="rtl" style="margin:0 0 6px">مرحباً ${escapeHtml(input.name)}، الوثائق التالية ستنتهي قريباً. يرجى تجديدها وتسليم النسخة الجديدة للإدارة.</p>
<p style="margin:0 0 16px;color:#475569">Hello ${escapeHtml(input.name)}, the documents below expire soon. Please renew them and hand the new copy to the office.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
</div><div style="padding:12px 24px;background:#f8fafc;color:#64748b;font-size:12px">رسالة آلية · Automated message</div></div></body></html>`
  const text = [`Document renewal reminder — ${input.company}`, ...input.items.map((i) => `${i.labelEn} (${i.labelAr}): ${i.date} — ${i.days} day(s)`)].join("\n")
  return { subject, html, text }
}
