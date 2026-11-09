// Pure HTML/text builder for the management digest email (bilingual, RTL).
import {
  CATEGORY_COPY,
  KIND_CATEGORY,
  NOTIFICATION_CATEGORIES,
  notificationStatus,
  notificationTitle,
  type NotificationFeed,
  type NotificationItem,
} from "./feed-utils"

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

const COLORS = { critical: "#b91c1c", warning: "#b45309", info: "#0369a1" } as const
const LABELS = {
  critical: { ar: "عاجل", en: "Critical" },
  warning: { ar: "تنبيه", en: "Warning" },
  info: { ar: "للعلم", en: "Info" },
} as const

function fmtAmount(n: number): string {
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`
}

function itemRow(item: NotificationItem, appUrl: string): string {
  const color = COLORS[item.severity]
  const title = notificationTitle(item.kind, "ar", item.docType)
  const status = notificationStatus(item, "ar") + (item.amount !== undefined ? ` · ${fmtAmount(item.amount)}` : "")
  const href = appUrl ? `${appUrl}${item.href}` : ""
  const subject = escapeHtml(item.subject || "—")
  return `<tr>
  <td style="padding:8px 10px;border-bottom:1px solid #eef0f3;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#fff;background:${color};">${LABELS[item.severity].ar}</span></td>
  <td style="padding:8px 10px;border-bottom:1px solid #eef0f3;font-weight:600;">${escapeHtml(title)}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #eef0f3;">${href ? `<a href="${escapeHtml(href)}" style="color:#1E5A99;text-decoration:none;">${subject}</a>` : subject}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #eef0f3;color:${item.severity === "critical" ? color : "#4b5563"};">${escapeHtml(status)}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #eef0f3;color:#6b7280;" dir="ltr">${item.date ?? ""}</td>
</tr>`
}

export interface DigestEmail {
  subject: string
  html: string
  text: string
}

export function buildDigestEmail(input: {
  companyName: string
  feed: NotificationFeed
  todayIso: string
  appUrl: string
  frequency: "daily" | "weekly"
  test?: boolean
}): DigestEmail {
  const { feed, appUrl } = input
  const counts = { critical: 0, warning: 0, info: 0 }
  feed.items.forEach((i) => counts[i.severity]++)
  const period = input.frequency === "weekly" ? "الأسبوعي" : "اليومي"
  const periodEn = input.frequency === "weekly" ? "Weekly" : "Daily"
  const prefix = input.test ? "[تجربة / Test] " : ""
  const subject = feed.total === 0
    ? `${prefix}الملخص ${period}: لا توجد تنبيهات — ${input.companyName}`
    : `${prefix}الملخص ${period}: ${feed.total} تنبيه${counts.critical ? ` (${counts.critical} عاجل)` : ""} — ${input.companyName}`

  const sections = NOTIFICATION_CATEGORIES.map((cat) => {
    const rows = feed.items.filter((i) => KIND_CATEGORY[i.kind] === cat)
    if (rows.length === 0) return ""
    return `<h3 style="margin:24px 0 8px;font-size:15px;color:#111827;">${CATEGORY_COPY[cat].ar} <span style="color:#6b7280;font-weight:400;font-size:12px;">/ ${CATEGORY_COPY[cat].en} · ${rows.length}</span></h3>
<table role="presentation" style="border-collapse:collapse;width:100%;font-size:13px;">${rows.map((r) => itemRow(r, appUrl)).join("")}</table>`
  }).join("")

  const tile = (n: number, label: { ar: string; en: string }, color: string) =>
    `<td style="padding:12px;text-align:center;border:1px solid #e5e7eb;border-radius:10px;"><div style="font-size:22px;font-weight:800;color:${color};">${n}</div><div style="font-size:12px;color:#6b7280;">${label.ar} / ${label.en}</div></td>`

  const more = feed.total > feed.items.length
    ? `<p style="margin:16px 0 0;font-size:12px;color:#6b7280;">يُعرض ${feed.items.length} من ${feed.total} تنبيه — افتح اللوحة لعرض الكل. / Showing ${feed.items.length} of ${feed.total}.</p>`
    : ""

  const empty = feed.total === 0
    ? `<p style="margin:16px 0;font-size:14px;">✅ لا توجد وثائق منتهية أو قريبة الانتهاء، ولا فواتير متأخرة. / Nothing needs attention.</p>`
    : ""

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#1a1d23;">
  <div style="max-width:760px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e5e7eb;">
    <p style="margin:0;color:#6b7280;font-size:12px;" dir="ltr">${input.todayIso}</p>
    <h2 style="margin:4px 0 2px;font-size:20px;">الملخص ${period} للتنبيهات — ${escapeHtml(input.companyName)}</h2>
    <p style="margin:0 0 18px;color:#6b7280;font-size:13px;">${periodEn} management alerts digest</p>
    <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px 0;"><tr>
      ${tile(counts.critical, LABELS.critical, COLORS.critical)}
      ${tile(counts.warning, LABELS.warning, COLORS.warning)}
      ${tile(counts.info, LABELS.info, COLORS.info)}
    </tr></table>
    ${empty}${sections}${more}
    ${appUrl ? `<p style="margin:24px 0 0;text-align:center;"><a href="${escapeHtml(appUrl)}/dashboard" style="display:inline-block;background:#1E5A99;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;">فتح لوحة التحكم / Open dashboard</a></p>` : ""}
    <p style="margin:24px 0 0;font-size:11px;color:#9ca3af;line-height:1.6;">
      تصلك هذه الرسالة لأنك ضمن مستلمي ملخص التنبيهات في منشأتك. يمكن لمدير النظام تعديل المستلمين والتكرار من الإعدادات ← الإشعارات.<br />
      You receive this because you are a digest recipient. Administrators can change recipients and frequency in Settings → Notifications.
    </p>
  </div>
</body>
</html>`

  const text = [
    subject,
    "",
    ...feed.items.map((i) => `- [${LABELS[i.severity].en}] ${notificationTitle(i.kind, "en", i.docType)}: ${i.subject || ""} — ${notificationStatus(i, "en")}${i.date ? ` (${i.date})` : ""}`),
    "",
    appUrl ? `${appUrl}/dashboard` : "",
  ].join("\n")

  return { subject, html, text }
}
