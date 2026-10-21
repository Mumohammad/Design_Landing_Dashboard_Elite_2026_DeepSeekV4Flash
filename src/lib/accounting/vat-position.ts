import type { SupabaseClient } from "@supabase/supabase-js"

const moneyKeys = ["output_vat", "recoverable_input_vat", "non_recoverable_vat", "pending_review_vat", "adjustments_output", "adjustments_input", "net_position"] as const
type MoneyKey = typeof moneyKeys[number]
export type VatPosition = Record<MoneyKey, string> & { period_count: number }
const unavailable = () => new Error("Could not load VAT position")
const zero = BigInt(0)
const hundred = BigInt(100)

/** Decimal strings keep database aggregates exact, including above JS's safe integer range. */
function minorUnits(value: unknown): bigint {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d{0,39})(?:\.\d{1,2})?$/.test(value)) throw unavailable()
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".")
  const cents = BigInt(whole) * hundred + BigInt(fraction.padEnd(2, "0"))
  return value.startsWith("-") ? -cents : cents
}

export function formatVatMoney(value: string): string {
  const cents = minorUnits(value)
  const absolute = cents < zero ? -cents : cents
  return `${cents < zero ? "-" : ""}${(absolute / hundred).toLocaleString("en-US")}.${String(absolute % hundred).padStart(2, "0")}`
}

export function vatNetAdjustments(position: VatPosition): string {
  const cents = minorUnits(position.adjustments_output) - minorUnits(position.adjustments_input)
  const absolute = cents < zero ? -cents : cents
  return `${cents < zero ? "-" : ""}${absolute / hundred}.${String(absolute % hundred).padStart(2, "0")}`
}

export function parseVatPosition(value: unknown): VatPosition {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable()
  const record = value as Record<string, unknown>
  if (!Number.isSafeInteger(record.period_count) || (record.period_count as number) < 0) throw unavailable()
  const units = Object.fromEntries(moneyKeys.map(key => [key, minorUnits(record[key])])) as Record<MoneyKey, bigint>
  if (units.output_vat + units.adjustments_output - units.recoverable_input_vat - units.adjustments_input !== units.net_position) throw unavailable()
  // Return a whitelist; never propagate arbitrary database fields into UI state.
  return Object.fromEntries([...moneyKeys.map(key => [key, record[key]]), ["period_count", record.period_count]]) as VatPosition
}

export async function readVatPosition(client: SupabaseClient, signal: AbortSignal): Promise<VatPosition> {
  const { data, error } = await client.rpc("read_my_vat_position").abortSignal(signal)
  if (signal.aborted || error) throw unavailable()
  return parseVatPosition(data)
}
