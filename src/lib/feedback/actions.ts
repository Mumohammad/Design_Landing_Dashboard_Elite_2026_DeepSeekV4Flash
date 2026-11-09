"use server"

// In-app feedback: stores the message for triage and alerts the platform
// support inbox (ADMIN_NOTIFY_EMAIL). Rate limited per user.

import { headers } from "next/headers"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/authorization"
import { rateLimit } from "@/lib/auth/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { sendEmail } from "@/lib/email/send"
import { escapeHtml } from "@/lib/notifications/digest-email"

const schema = z.object({
  kind: z.enum(["bug", "idea", "question", "praise"]),
  message: z.string().trim().min(5).max(4000),
  pagePath: z.string().trim().max(300).regex(/^\/[^\s]*$/).optional().nullable(),
})

export type FeedbackInput = z.infer<typeof schema>
type Result = { success: true } | { success: false; error: string; errorAr: string }

const KIND_AR = { bug: "مشكلة", idea: "اقتراح", question: "سؤال", praise: "إشادة" } as const

export async function submitFeedback(input: FeedbackInput): Promise<Result> {
  const user = await getCurrentUser()
  if (!user) return { success: false, error: "Sign in to send feedback.", errorAr: "سجّل الدخول لإرسال الملاحظات." }
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { success: false, error: "Write at least 5 characters.", errorAr: "اكتب 5 أحرف على الأقل." }
  const rl = await rateLimit(`feedback:${user.id}`, 5, "hour").catch(() => ({ success: false }))
  if (!rl.success) return { success: false, error: "You've sent a lot of feedback recently. Try again later.", errorAr: "أرسلت ملاحظات كثيرة مؤخراً. حاول لاحقاً." }

  const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("app_feedback")
    .insert({ tenant_id: user.tenantId, user_id: user.authUserId, kind: parsed.data.kind, message: parsed.data.message, page_path: parsed.data.pagePath ?? null, user_agent: ua })
    .select("id")
    .single()
  if (error || !data) return { success: false, error: "Couldn't send feedback. Try again.", errorAr: "تعذر إرسال الملاحظات. حاول مرة أخرى." }

  const support = (process.env.ADMIN_NOTIFY_EMAIL ?? "").split(",").map((e) => e.trim()).filter((e) => e.includes("@"))
  if (support.length > 0) {
    const [{ data: tenant }, { data: me }] = await Promise.all([
      admin.from("tenants").select("name_ar, name_en").eq("id", user.tenantId).maybeSingle(),
      admin.from("users").select("email").eq("id", user.id).maybeSingle(),
    ])
    const company = (tenant?.name_ar as string) || (tenant?.name_en as string) || user.tenantId
    const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;">
<h3>ملاحظة جديدة (${KIND_AR[parsed.data.kind]}) — ${escapeHtml(company)}</h3>
<p><b>من:</b> ${escapeHtml(String(me?.email ?? "—"))} · <b>الصفحة:</b> <span dir="ltr">${escapeHtml(parsed.data.pagePath ?? "—")}</span></p>
<pre style="white-space:pre-wrap;background:#f6f7f9;padding:12px;border-radius:8px;">${escapeHtml(parsed.data.message)}</pre>
<p style="color:#6b7280;font-size:12px;">ID: ${data.id}</p></div>`
    await sendEmail({ to: support, subject: `[Feedback/${parsed.data.kind}] ${company}`, html }).catch(() => undefined)
  }
  return { success: true }
}
