// ─────────────────────────────────────────────────────────────────────────
// Company-owner confirmation email via Resend.
//
// Contract (mirrors admin-email.ts / applicant-email.ts):
//   * Best-effort only — the caller must treat failures as non-blocking
//     (registration already succeeded; sign-in does not depend on the mail).
//   * Only sent when email confirmation is ENABLED (i.e. the account starts
//     unconfirmed and the user must click the link). When confirmation is
//     disabled there is nothing to confirm — the flow goes straight to
//     sign-in, so no email is sent.
//
// Env:
//   RESEND_API_KEY      — server-only (never NEXT_PUBLIC)
//   RESEND_FROM_EMAIL   — optional; defaults to Resend's onboarding sender
//   NEXT_PUBLIC_APP_URL — base for the confirmation/sign-in links
// ─────────────────────────────────────────────────────────────────────────

const RESEND_ENDPOINT = "https://api.resend.com/emails"

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export async function sendCompanyConfirmationEmail(params: {
  email: string
  companyName: string
  confirmationUrl: string
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev"
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")
  const signInUrl = `${appUrl}/auth/sign-in`

  if (!apiKey) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[company-welcome-email] RESEND_API_KEY not configured — skipping confirmation email."
      )
    }
    return
  }

  const companyName = escapeHtml(params.companyName)
  const subject = `أكّد بريدك الإلكتروني لتفعيل مساحة ${params.companyName} — Confirm your email`

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<body style="margin:0;padding:24px;background:#f6f8fb;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#1a1d23;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:36px;border:1px solid #e5e7eb;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
      <span style="display:inline-flex;width:36px;height:36px;align-items:center;justify-content:center;border-radius:10px;background:#1E5A99;color:#ffffff;font-weight:700;">ن</span>
      <span style="font-weight:700;color:#1E5A99;">نخبة التطوير · منصة الشركات</span>
    </div>
    <h2 style="margin:0 0 16px;font-size:20px;">مرحباً بك في نخبة التطوير 👋</h2>
    <p style="margin:0 0 8px;line-height:1.8;">تم إنشاء مساحة العمل <strong>${companyName}</strong> بنجاح.</p>
    <p style="margin:0 0 20px;line-height:1.8;">خطوة أخيرة: أكّد بريدك الإلكتروني لتفعيل حسابك وتسجيل الدخول إلى لوحة التحكم.</p>
    <p style="margin:0 0 28px;text-align:center;">
      <a href="${params.confirmationUrl}" style="display:inline-block;background:#1E5A99;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:10px;font-weight:700;">تأكيد البريد وتسجيل الدخول</a>
    </p>
    <p style="margin:0 0 24px;font-size:12px;color:#6b7280;line-height:1.7;">أو انسخ الرابط إلى متصفحك:<br /><a href="${params.confirmationUrl}" style="color:#1E5A99;word-break:break-all;">${params.confirmationUrl}</a></p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
    <div dir="ltr" style="text-align:left;">
      <h3 style="margin:0 0 12px;font-size:16px;">Welcome to Elite Development 👋</h3>
      <p style="margin:0 0 8px;line-height:1.7;">The workspace <strong>${companyName}</strong> was created successfully.</p>
      <p style="margin:0 0 20px;line-height:1.7;">One last step: confirm your email address to activate your account and sign in to the dashboard.</p>
      <p style="margin:0 0 24px;">
        <a href="${params.confirmationUrl}" style="display:inline-block;background:#1E5A99;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:10px;font-weight:700;">Confirm email &amp; sign in</a>
      </p>
      <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.7;">Or copy this link into your browser:<br /><a href="${params.confirmationUrl}" style="color:#1E5A99;word-break:break-all;">${params.confirmationUrl}</a></p>
    </div>
    <p style="margin:28px 0 0;font-size:12px;color:#6b7280;line-height:1.6;" dir="ltr">
      After confirming, sign in at <a href="${signInUrl}" style="color:#1E5A99;">${signInUrl}</a><br />
      بعد التأكيد، سجّل الدخول من الصفحة الرئيسية.
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
      body: JSON.stringify({ from, to: [params.email], subject, html }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error(
        `[company-welcome-email] Resend send failed (${res.status}) — account stays unconfirmed until the user uses the link. ${body.slice(0, 200)}`
      )
    }
  } catch (err) {
    console.error("[company-welcome-email] Resend exception — non-blocking.", err)
  }
}
