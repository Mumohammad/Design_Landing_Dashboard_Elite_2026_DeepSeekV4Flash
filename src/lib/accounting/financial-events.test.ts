// Financial Phase 14 — unit tests pinning the canonical idempotency-key
// format (EVENT-MODEL.md §2): "{source_type}:{source_id}:{suffix}".
// The unique index on financial_events.idempotency_key makes replay safe;
// this test locks the format so producers cannot drift.
import { describe, expect, it } from "vitest"
import { idempotencyKey } from "./financial-events"

describe("idempotencyKey", () => {
  it("builds the canonical {source_type}:{source_id}:{suffix} format", () => {
    expect(idempotencyKey("invoice", "11111111-2222-3333-4444-555555555555", "finalized")).toBe(
      "invoice:11111111-2222-3333-4444-555555555555:finalized"
    )
  })

  it("matches the documented event-model keys", () => {
    expect(idempotencyKey("invoice", "inv-1", "finalized")).toBe("invoice:inv-1:finalized")
    expect(idempotencyKey("credit_note", "cn-1", "issued")).toBe("credit_note:cn-1:issued")
    expect(idempotencyKey("debit_note", "dn-1", "issued")).toBe("debit_note:dn-1:issued")
    expect(idempotencyKey("payment", "pay-1", "allocated")).toBe("payment:pay-1:allocated")
    expect(idempotencyKey("expense", "exp-1", "approved")).toBe("expense:exp-1:approved")
  })

  it("is deterministic — same inputs, same key (replay safety)", () => {
    const a = idempotencyKey("invoice", "inv-1", "finalized")
    const b = idempotencyKey("invoice", "inv-1", "finalized")
    expect(a).toBe(b)
    expect(idempotencyKey("invoice", "inv-1", "cancelled")).not.toBe(a)
  })
})
