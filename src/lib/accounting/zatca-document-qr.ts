// QR for printed invoices. ZATCA requires the printed QR of a standard tax
// invoice to come from the accepted CLEARED invoice, and that of a simplified
// invoice from the EGS-stamped (signed) document that was reported. This
// module selects that artifact from the immutable submission evidence; the
// caller falls back to the internal (unvalidated) QR when none exists.
// Compliance-check attempts are never used: they are not legal issuance.

export type AuthorityQr = {
  qrBase64: string
  kind: "cleared" | "reported"
  environment: "sandbox" | "simulation"
}

type AttemptRow = {
  pipeline: string
  status: string
  environment: string
  signed_xml: string
  cleared_xml: string | null
  created_at: string
}

const QR_RE =
  /<cac:AdditionalDocumentReference>\s*<cbc:ID>QR<\/cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject[^>]*>([A-Za-z0-9+/=\s]+)<\/cbc:EmbeddedDocumentBinaryObject>/

/** Extract the Base64 TLV QR from a UBL invoice, or null when absent. */
export function extractZatcaQr(xml: string | null | undefined): string | null {
  const m = xml ? QR_RE.exec(xml) : null
  const value = m?.[1]?.replace(/\s+/g, "") ?? ""
  return value.length > 0 && value.length <= 1000 ? value : null
}

/** Pick the latest accepted clearance/reporting attempt's printable QR. */
export function selectAuthorityQr(attempts: AttemptRow[]): AuthorityQr | null {
  const accepted = attempts
    .filter((a) => (a.pipeline === "clearance" && a.status === "cleared") || (a.pipeline === "reporting" && a.status === "reported"))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  for (const a of accepted) {
    if (a.environment !== "sandbox" && a.environment !== "simulation") continue
    // Clearance returns ZATCA's stamped XML; only that copy may be printed.
    const qr = a.pipeline === "clearance" ? extractZatcaQr(a.cleared_xml) : extractZatcaQr(a.signed_xml)
    if (qr) return { qrBase64: qr, kind: a.pipeline === "clearance" ? "cleared" : "reported", environment: a.environment }
  }
  return null
}

type AdminLike = {
  from: (table: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Load the printable authority QR for a sales invoice (tenant-scoped). */
export async function loadAuthorityQr(admin: AdminLike, tenantId: string, invoiceId: string): Promise<AuthorityQr | null> {
  const { data: issuances, error } = await admin
    .from("zatca_document_issuances")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("source_type", "invoice")
    .eq("source_id", invoiceId)
  if (error || !Array.isArray(issuances) || issuances.length === 0) return null
  const { data: attempts, error: attemptsError } = await admin
    .from("zatca_submission_attempts")
    .select("pipeline,status,environment,signed_xml,cleared_xml,created_at")
    .eq("tenant_id", tenantId)
    .in("issuance_id", issuances.map((i: { id: string }) => i.id))
    .in("status", ["cleared", "reported"])
    .order("created_at", { ascending: false })
    .limit(10)
  if (attemptsError || !Array.isArray(attempts)) return null
  return selectAuthorityQr(attempts as AttemptRow[])
}
