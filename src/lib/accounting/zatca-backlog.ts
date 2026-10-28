// ZATCA submission backlog. Simplified (B2C) documents must be reported
// within 24 hours of issuance; standard (B2B) invoices must be cleared before
// they are shared with the buyer. Anything finalized but not yet reported or
// cleared is pending; pending for more than 24 hours is overdue.

export const ZATCA_REPORTING_WINDOW_MS = 24 * 3600_000

export type BacklogEvent = { source_id: string; event_type: string; created_at: string; doc_ref?: string | null }
export type BacklogTransmission = { source_id: string; doc_type: string; status: string; error_message?: string | null }

export type ZatcaBacklogItem = {
  sourceId: string
  docType: "invoice" | "credit_note" | "debit_note"
  docRef: string | null
  issuedAt: string
  hoursOpen: number
  overdue: boolean
  lastStatus: string | null
  lastError: string | null
}

export function docTypeForEvent(eventType: string): ZatcaBacklogItem["docType"] | null {
  if (eventType === "InvoiceFinalizedEvent") return "invoice"
  if (eventType === "CreditNoteIssuedEvent") return "credit_note"
  if (eventType === "DebitNoteIssuedEvent") return "debit_note"
  return null
}

export function computeZatcaBacklog(events: BacklogEvent[], transmissions: BacklogTransmission[], now = Date.now()) {
  const done = new Set<string>()
  const last = new Map<string, BacklogTransmission>()
  for (const t of transmissions) {
    const key = `${t.doc_type}:${t.source_id}`
    last.set(key, t)
    if (t.status === "reported" || t.status === "cleared") done.add(key)
  }
  const seen = new Set<string>()
  const items: ZatcaBacklogItem[] = []
  for (const e of events) {
    const docType = docTypeForEvent(e.event_type)
    if (!docType) continue
    const key = `${docType}:${e.source_id}`
    if (done.has(key) || seen.has(key)) continue
    seen.add(key)
    const issued = Date.parse(e.created_at)
    if (!Number.isFinite(issued)) continue
    const open = Math.max(0, now - issued)
    const t = last.get(key)
    items.push({
      sourceId: e.source_id, docType, docRef: e.doc_ref ?? null, issuedAt: e.created_at,
      hoursOpen: Math.floor(open / 3600_000), overdue: open > ZATCA_REPORTING_WINDOW_MS,
      lastStatus: t?.status ?? null, lastError: t?.error_message ?? null,
    })
  }
  items.sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))
  return { pending: items.length, overdue: items.filter((i) => i.overdue).length, items }
}
