// Financial-event idempotency keys — EVENT-MODEL.md §2.
//
// Every producer (invoice/credit-note/debit-note/payment/expense) writes to
// `financial_events` with a stable key = "{source_type}:{source_id}:{suffix}".
// The unique index on idempotency_key makes replay safe: re-inserting the same
// key is rejected, so the Phase 9 dispatcher can never double-post an effect.
// This helper is the single place the canonical format is spelled out, and it
// is unit-tested so the format cannot drift between producers.

export function idempotencyKey(sourceType: string, sourceId: string, suffix: string): string {
  return `${sourceType}:${sourceId}:${suffix}`
}
