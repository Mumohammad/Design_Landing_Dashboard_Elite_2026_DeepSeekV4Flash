import { describe, expect, it } from "vitest"
import { computeZatcaBacklog } from "./zatca-backlog"

const now = Date.parse("2026-10-28T12:00:00Z")

describe("ZATCA submission backlog", () => {
  it("flags documents pending for more than 24 hours as overdue and ignores reported/cleared ones", () => {
    const b = computeZatcaBacklog([
      { source_id: "a", event_type: "InvoiceFinalizedEvent", created_at: "2026-10-27T11:00:00Z", doc_ref: "INV-1" },
      { source_id: "b", event_type: "InvoiceFinalizedEvent", created_at: "2026-10-28T10:00:00Z", doc_ref: "INV-2" },
      { source_id: "c", event_type: "CreditNoteIssuedEvent", created_at: "2026-10-26T10:00:00Z", doc_ref: "CN-1" },
      { source_id: "d", event_type: "PaymentReceivedEvent", created_at: "2026-10-20T10:00:00Z" },
    ], [
      { source_id: "c", doc_type: "credit_note", status: "reported" },
      { source_id: "a", doc_type: "invoice", status: "failed", error_message: "ZATCA gateway unavailable (TIMEOUT)." },
    ], now)
    expect(b.pending).toBe(2)
    expect(b.overdue).toBe(1)
    expect(b.items[0]).toMatchObject({ sourceId: "a", docType: "invoice", overdue: true, hoursOpen: 25, lastStatus: "failed" })
    expect(b.items[1]).toMatchObject({ sourceId: "b", overdue: false, hoursOpen: 2, lastStatus: null })
  })

  it("keys notes separately from their reference invoice", () => {
    const b = computeZatcaBacklog([
      { source_id: "n1", event_type: "CreditNoteIssuedEvent", created_at: "2026-10-28T11:00:00Z" },
      { source_id: "n2", event_type: "CreditNoteIssuedEvent", created_at: "2026-10-28T11:30:00Z" },
    ], [{ source_id: "n1", doc_type: "credit_note", status: "reported" }], now)
    expect(b.items.map((i) => i.sourceId)).toEqual(["n2"])
  })
})
