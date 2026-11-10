"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUserForMfa } from "./authorization"
import { rateLimit } from "./rate-limit"
import { isValidNewPassword, newPasswordHint } from "./password-policy"

type Result = { success: boolean; error?: string; errorAr?: string; requiresMfa?: boolean; requiresReauthentication?: boolean; reviewAccess?: boolean }
const sessionError = { success: false, error: "Sign in again before changing your password.", errorAr: "سجّل الدخول مجدداً قبل تغيير كلمة المرور." } as const
const uncertain = { success: false, reviewAccess: true,
  error: "The password change could not be confirmed. Check account access. If another change is required, choose a different new password.",
  errorAr: "تعذر تأكيد تغيير كلمة المرور. راجع الوصول إلى حسابك. إذا طُلب تغيير آخر، اختر كلمة مرور جديدة مختلفة." } as const

async function identity() {
  const user = await getCurrentUserForMfa()
  if (!user) return null
  const client = await createClient()
  const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error || !data) throw new Error("Password assurance unavailable")
  return { user, client, needsMfa: data.nextLevel === "aal2" && data.currentLevel !== "aal2" }
}

const mfaRequired = { success: false, requiresMfa: true,
  error: "Verify your authenticator before changing your password.", errorAr: "أكمل التحقق بتطبيق المصادقة قبل تغيير كلمة المرور." } as const

export async function changeOwnPassword(input: unknown): Promise<Result> {
  let attempted = false
  try {
    const value = input as { password?: unknown; nonce?: unknown } | null
    if (!isValidNewPassword(value?.password)) return { success: false, error: newPasswordHint("en"), errorAr: newPasswordHint("ar") }
    if (value?.nonce !== undefined && (typeof value.nonce !== "string" || value.nonce.length > 128)) return { success: false,
      error: "Enter the verification code from your email.", errorAr: "أدخل رمز التحقق المرسل إلى بريدك." }
    const context = await identity()
    if (!context) return sessionError
    if (context.needsMfa) return mfaRequired
    if (!(await rateLimit(`password-change:${context.user.authUserId}`, 5, "minute")).success) return { success: false,
      error: "Too many attempts. Wait a minute before trying again.", errorAr: "محاولات كثيرة. انتظر دقيقة قبل المحاولة مجدداً." }
    const admin = createAdminClient()
    const snapshot = await admin.from("users").select("credential_revision,password_requirement_version")
      .eq("id", context.user.id).eq("auth_user_id", context.user.authUserId).eq("tenant_id", context.user.tenantId).is("deleted_at", null).single()
    if (snapshot.error || !snapshot.data || !Number.isSafeInteger(snapshot.data.credential_revision)
      || snapshot.data.credential_revision < 0 || snapshot.data.credential_revision >= Number.MAX_SAFE_INTEGER
      || !Number.isSafeInteger(snapshot.data.password_requirement_version) || snapshot.data.password_requirement_version < 0) throw new Error("Password context unavailable")
    attempted = true
    // Uses the user's verified session, never an administrative password reset.
    const { error } = await context.client.auth.updateUser({ password: value.password,
      ...(typeof value.nonce === "string" && value.nonce.trim() ? { nonce: value.nonce.trim() } : {}) })
    if (error) {
      if (error.code === "same_password") return { success: false, reviewAccess: true,
        error: "Choose a new password different from your current password.", errorAr: "اختر كلمة مرور جديدة تختلف عن كلمة المرور الحالية." }
      if (error.code === "weak_password") return { success: false, error: newPasswordHint("en"), errorAr: newPasswordHint("ar") }
      if (error.code === "insufficient_aal") return mfaRequired
      if (error.code === "reauthentication_needed" || error.code === "reauthentication_not_valid") return { success: false, requiresReauthentication: true,
        error: "Request a verification code, then enter the code from your email and retry.", errorAr: "اطلب رمز تحقق، ثم أدخل الرمز المرسل إلى بريدك وأعد المحاولة." }
      return uncertain
    }
    const expected = snapshot.data.credential_revision + 1
    const completion = await admin.rpc("complete_user_password_change", { p_actor: context.user.authUserId,
      p_expected_revision: expected, p_requirement_version: snapshot.data.password_requirement_version })
    if (completion.error || completion.data?.completed !== true || completion.data?.credential_revision !== expected) return uncertain
    try { revalidatePath("/settings/security") } catch { /* Password and completion have committed. */ }
    return { success: true }
  } catch {
    return attempted ? uncertain : { success: false, error: "Password verification is unavailable. Try again shortly.", errorAr: "خدمة التحقق من كلمة المرور غير متاحة. حاول بعد قليل." }
  }
}

export async function requestPasswordReauthentication(): Promise<Result> {
  try {
    const context = await identity()
    if (!context) return sessionError
    if (context.needsMfa) return mfaRequired
    if (!(await rateLimit(`password-reauth:${context.user.authUserId}`, 3, "hour")).success) return { success: false,
      error: "Verification code limit reached. Try again later.", errorAr: "بلغت حد إرسال رموز التحقق. حاول لاحقاً." }
    const { error } = await context.client.auth.reauthenticate()
    return error ? { success: false, error: "Could not send the verification code. Try again later.", errorAr: "تعذر إرسال رمز التحقق. حاول لاحقاً." } : { success: true }
  } catch { return { success: false, error: "Verification is unavailable. Try again shortly.", errorAr: "خدمة التحقق غير متاحة. حاول بعد قليل." } }
}
