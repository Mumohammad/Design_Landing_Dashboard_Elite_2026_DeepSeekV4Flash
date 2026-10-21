// Historical mock rows used the same status enum as real transmissions. A
// reported/cleared label alone must never be presented as authority evidence.
// The current disabled integration has no verified production evidence path.
export function isMockZatcaResponse(response: unknown): boolean {
  if (!response || typeof response !== "object" || Array.isArray(response)) return false
  const record = response as Record<string, unknown>
  return record.sandbox === true || record.mock === true
}

export function zatcaEvidenceLabel(mock: boolean, ar: boolean): string {
  if (mock) return ar ? "محاكاة — لم تُرسل للهيئة" : "Mock — not submitted"
  return ar ? "سجل غير متحقق منه" : "Unverified record"
}
