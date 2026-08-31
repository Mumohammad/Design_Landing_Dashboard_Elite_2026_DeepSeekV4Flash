import type { FullApplication } from "@/lib/driver-registration/schema"

const RESEND_ENDPOINT = "https://api.resend.com/emails"

// ─────────────────────────────────────────────────────────────────────────
// Applicant-facing confirmation email via Resend (free tier).
//
// Contract:
//   * Called by submitDriverApplication via Promise.allSettled — this
//     function must therefore NEVER be relied upon for correctness of the
//     submit path. It logs and returns on any failure.
//   * Sends only when the applicant provided an email address.
//   * The tracking URL carries the PLAINTEXT status token (only available
//     at submit time; the DB stores its SHA-256 hash — migration 059).
//
// Env:
//   RESEND_API_KEY        — server-only (never NEXT_PUBLIC)
//   RESEND_FROM_EMAIL     — optional; defaults to Resend's free onboarding
//                           sender until a domain is verified
//   NEXT_PUBLIC_APP_URL   — base for the tracking link
// ─────────────────────────────────────────────────────────────────────────

export async function notifyApplicantByEmail(
  application: FullApplication,
  applicationNumber: string,
  statusToken: string
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev"
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")
  const to = application.contact.email

  if (!apiKey || !to) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[applicant-email] Resend not configured (RESEND_API_KEY) or applicant has no email — skipping confirmation."
      )
    }
    return
  }

  const fullName = `${application.personal.firstName} ${application.personal.lastName}`
    .replace(/\s+/g, " ")
    .trim()
  const trackingUrl = `${appUrl}/driver-application-status/${statusToken}`
  const subject = `تم استلام طلبك ${applicationNumber} — Your application was received`

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#1a1d23;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb;">
    <h2 style="margin:0 0 16px;font-size:20px;">تم استلام طلبك بنجاح ✅</h2>
    <p style="margin:0 0 8px;line-height:1.8;">مرحباً <strong>${fullName}</strong>،</p>
    <p style="margin:0 0 16px;line-height:1.8;">شكراً لتقديمك. رقم طلبك هو:</p>
    <p style="margin:0 0 16px;font-size:22px;font-weight:700;letter-spacing:1px;color:#0f766e;" dir="ltr">${applicationNumber}</p>
    <p style="margin:0 0 20px;line-height:1.8;">يمكنك متابعة حالة طلبك في أي وقت عبر هذا الرابط الخاص بك (لا تشاركه مع أحد):</p>
    <p style="margin:0 0 28px;text-align:center;">
      <a href="${trackingUrl}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;">تتبع حالة الطلب</a>
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
    <div dir="ltr" style="text-align:left;">
      <h3 style="margin:0 0 12px;font-size:16px;">Your application was received ✅</h3>
      <p style="margin:0 0 8px;line-height:1.7;">Hi <strong>${fullName}</strong>,</p>
      <p style="margin:0 0 12px;line-height:1.7;">Thank you for applying. Your application number is <strong>${applicationNumber}</strong>.</p>
      <p style="margin:0;line-height:1.7;">Track your application anytime via your private link:<br />
        <a href="${trackingUrl}" style="color:#0f766e;word-break:break-all;">${trackingUrl}</a>
      </p>
    </div>
    <p style="margin:28px 0 0;font-size:12px;color:#6b7280;line-height:1.6;" dir="ltr">
      If you did not submit this application, you can ignore this email.<br />
      إذا لم تقدّم هذا الطلب، تجاهل هذه الرسالة.
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
      body: JSON.stringify({ from, to: [to], subject, html }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error(
        `[applicant-email] Resend send failed (${res.status}) for ${applicationNumber} — application remains SUBMITTED. ${body.slice(0, 200)}`
      )
    }
  } catch (err) {
    console.error("[applicant-email] Resend exception — application remains SUBMITTED.", err)
  }
}
