import type { FullApplication } from "@/lib/driver-registration/schema"

const RESEND_ENDPOINT = "https://api.resend.com/emails"

// ─────────────────────────────────────────────────────────────────────────
// Staff-facing "new application" alert via Resend.
//
// Contract:
//   * Invoked from notifyApplicantByEmail via Promise.allSettled — it must
//     NEVER be relied upon for correctness of the submit path. It logs and
//     returns on any failure.
//   * Recipients: ADMIN_NOTIFY_EMAIL (comma-separated). Unset → skip.
//   * Works with Resend's free onboarding sender for the account owner's
//     own address; arbitrary recipients require a verified domain.
//   * Every applicant-supplied value is HTML-escaped before interpolation.
//
// Env:
//   RESEND_API_KEY      — server-only (never NEXT_PUBLIC)
//   RESEND_FROM_EMAIL   — optional; defaults to Resend's onboarding sender
//   ADMIN_NOTIFY_EMAIL  — comma-separated staff recipients (opt-in)
//   NEXT_PUBLIC_APP_URL — base for the dashboard link
// ─────────────────────────────────────────────────────────────────────────

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 12px;border:1px solid #e5e7eb;color:#6b7280;font-size:13px;">${label}</td>
    <td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:13px;font-weight:600;" dir="auto">${escapeHtml(value)}</td>
  </tr>`
}

const IDENTITY_LABELS: Record<string, string> = {
  iqama: "إقامة / Iqama",
  national_id: "هوية وطنية / National ID",
  passport: "جواز سفر / Passport",
}

const WORK_LABELS: Record<string, string> = {
  full_time: "دوام كامل / Full-Time",
  freelancer: "سائق حر / Freelancer",
}

const CATEGORY_LABELS: Record<string, string> = {
  sponsored_type_1: "مكفول ١ (مركبة+بنزين+سكن)",
  sponsored_type_2: "مكفول ٢ (مركبة+سكن)",
  freelancer: "سائق حر / Freelancer",
}

export async function notifyAdminsByEmail(
  application: FullApplication,
  applicationNumber: string
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev"
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")
  const recipients = (process.env.ADMIN_NOTIFY_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0)

  if (!apiKey || recipients.length === 0) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[admin-email] Resend not configured (RESEND_API_KEY) or ADMIN_NOTIFY_EMAIL empty — skipping staff alert."
      )
    }
    return
  }

  const fullName =
    `${application.personal.firstName} ${application.personal.lastName}`
      .replace(/\s+/g, " ")
      .trim()
  const platforms =
    application.platforms.platforms.length > 0
      ? application.platforms.platforms.join(", ")
      : "—"
  const vehicle = application.vehicle.hasVehicle
    ? `${application.vehicle.vehicleType ?? ""} ${application.vehicle.make ?? ""} ${application.vehicle.model ?? ""} (${application.vehicle.plate ?? "—"})`
        .replace(/\s+/g, " ")
        .trim()
    : "لا يوجد / None"
  const dashboardUrl = `${appUrl}/dashboard`
  const subject = `طلب سائق جديد ${applicationNumber} — New driver application`

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#1a1d23;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
    <h2 style="margin:0 0 4px;font-size:20px;">طلب سائق جديد 🚗</h2>
    <p style="margin:0 0 20px;color:#6b7280;font-size:13px;">New driver application received</p>
    <p style="margin:0 0 16px;font-size:22px;font-weight:700;letter-spacing:1px;color:#1E5A99;" dir="ltr">${escapeHtml(applicationNumber)}</p>
    <table style="border-collapse:collapse;width:100%;margin:0 0 20px;">
      ${row("الاسم / Name", fullName)}
      ${row("الجوال / Mobile", application.contact.mobile)}
      ${row("البريد / Email", application.contact.email || "—")}
      ${row("المدينة / City", `${application.contact.city} — ${application.contact.district}`)}
      ${row("الهوية / Identity", `${IDENTITY_LABELS[application.identity.identityType] ?? application.identity.identityType} · ${application.identity.identityNumber}`)}
      ${row("الرخصة / License", `${application.license.licenseNumber} (${application.license.licenseType})`)}
      ${row("نوع العمل / Work", `${WORK_LABELS[application.work.workType] ?? application.work.workType} · ${CATEGORY_LABELS[application.work.driverCategory] ?? application.work.driverCategory}`)}
      ${row("المنصات / Platforms", platforms)}
      ${row("المركبة / Vehicle", vehicle)}
    </table>
    <p style="margin:0;text-align:center;">
      <a href="${dashboardUrl}" style="display:inline-block;background:#1E5A99;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;">فتح لوحة التحكم / Open Dashboard</a>
    </p>
    <p style="margin:24px 0 0;font-size:12px;color:#6b7280;line-height:1.6;">
      هذا تنبيه تلقائي من بوابة تسجيل السائقين — راجع الطلب من قائمة الطلبات في اللوحة.<br />
      Automated alert from the driver registration portal.
    </p>
  </div>
</body>
</html>`

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: recipients, subject, html }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error(
        `[admin-email] Resend send failed (${res.status}) for ${applicationNumber} — application remains SUBMITTED. ${body.slice(0, 200)}`
      )
    }
  } catch (err) {
    console.error("[admin-email] Resend exception — application remains SUBMITTED.", err)
  }
}
