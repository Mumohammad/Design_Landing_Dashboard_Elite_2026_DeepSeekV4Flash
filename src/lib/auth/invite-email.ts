import { z } from "zod"
import { authCallbackUrlWithReturn } from "@/lib/redirects"

/**
 * Send the invite-acceptance email via the Resend HTTP API. Uses the global
 * `fetch` — no package dependency. Non-fatal: the caller logs failures and the
 * invite row stays pending so the GM can resend from /settings/users
 * (auth plan 6.3 step 10).
 *
 * Subject and body include Arabic and English; no invitation token is logged.
 */
export async function sendInviteEmail(email: string, token: string, tokenId: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !fromEmail) return false
  const appOrigin=new URL(authCallbackUrlWithReturn()).origin

  // `tid` (token_id) is NOT secret — it is the O(1) lookup key (auth plan
  // 6.7 strategy 2). The `token` is the secret; both are required to accept.
  const acceptUrl = `${appOrigin}/auth/accept-invite?tid=${encodeURIComponent(tokenId)}&token=${encodeURIComponent(token)}`

  const html = `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 dir="rtl" lang="ar">دعوة للانضمام إلى EliteDev</h2>
      <p dir="rtl" lang="ar">تمت دعوتك للانضمام إلى فريق العمل. استخدم الرابط أدناه لقبول الدعوة وإنشاء حسابك. تنتهي صلاحية الدعوة بعد سبعة أيام.</p>
      <h2>You're invited to EliteDev</h2>
      <p>You have been invited to join EliteDev. Click the button below to accept your invite and set up your account.</p>
      <p>
        <a href="${acceptUrl}"
           style="display: inline-block; padding: 12px 24px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px;">
          قبول الدعوة / Accept invite
        </a>
      </p>
      <p style="color: #6b7280; font-size: 12px;">
        Or copy this link: ${acceptUrl}
      </p>
      <p style="color: #6b7280; font-size: 12px;">
        This invite expires in 7 days.
      </p>
    </div>
  `

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [email],
      subject: "دعوة للانضمام إلى EliteDev | Invitation to EliteDev",
      html,
    }),
  })

  if (!res.ok) {
    throw new Error("Invitation email delivery failed")
  }
  const queued:unknown=await res.json().catch(()=>null)
  if(!queued||typeof queued!=="object"||!("id" in queued)||!z.uuid().safeParse(queued.id).success)throw new Error("Invitation email acceptance was not confirmed")
  return true
}

