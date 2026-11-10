// Shared new-password policy. Existing-password sign-in deliberately keeps
// accepting older credentials so users can sign in and replace them.
export const MIN_PASSWORD_LENGTH = 10
export const MAX_PASSWORD_LENGTH = 128

export function isValidNewPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= MIN_PASSWORD_LENGTH
    && value.length <= MAX_PASSWORD_LENGTH && /[A-Za-z]/.test(value) && /[0-9]/.test(value)
}

export function newPasswordHint(locale: string): string {
  return locale === "ar"
    ? "استخدم من 10 إلى 128 حرفاً، مع حرف إنجليزي ورقم على الأقل."
    : "Use 10–128 characters, including at least one English letter and one number."
}
