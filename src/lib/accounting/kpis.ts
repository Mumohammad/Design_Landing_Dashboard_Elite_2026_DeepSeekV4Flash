"use server"

import { createClient } from "@/lib/supabase/server"

export type AccountingKpiWindowInput = {
  /** Inclusive period start, ISO date "YYYY-MM-DD". */
  start: string
  /** Inclusive period end, ISO date "YYYY-MM-DD". */
  end: string
}

export type FinancialKpis = {
  /** Posted income credits less debits, excluding VAT liability accounts. */
  revenue: number
  revenuePrevious: number
  /** Distinct sales invoice sources with a posted journal dated in the window. */
  invoicesCount: number
  invoicesCountPrevious: number
  /** Active invoice/debit-note AR balances, total less paid, across all dates. */
  pendingInvoicesAmount: number
  pendingInvoicesCount: number
  /** Posted expense debits less credits, including nonrecoverable VAT costs. */
  expenses: number
  expensesPrevious: number
  /** Distinct expense sources with a posted journal dated in the window. */
  expensesCount: number
  /** Posted income less posted expense for the window. */
  netResult: number
  /** False on denied, unavailable or malformed results; zeros are placeholders. */
  available: boolean
}

const EMPTY: FinancialKpis = {
  revenue: 0, revenuePrevious: 0, invoicesCount: 0, invoicesCountPrevious: 0,
  pendingInvoicesAmount: 0, pendingInvoicesCount: 0, expenses: 0,
  expensesPrevious: 0, expensesCount: 0, netResult: 0, available: false,
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

// Exact decimal strings keep JSON/driver coercion from turning null, booleans,
// exponent notation, NaN or lost cents into plausible financial values.
function cents(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value) || value.length > 24) return null
  const negative = value.startsWith("-")
  const [whole, decimal = ""] = (negative ? value.slice(1) : value).split(".")
  const amount = BigInt(whole) * BigInt(100) + BigInt(decimal.padEnd(2, "0"))
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) return null
  // FinancialKpis is a numeric API. Reject values that would lose a cent
  // when serialized as a JavaScript number, even within safe integer cents.
  const [numberWhole, numberDecimal = ""] = String(Number(amount) / 100).split(".")
  if (numberDecimal.length > 2 || BigInt(numberWhole) * BigInt(100) + BigInt(numberDecimal.padEnd(2, "0")) !== amount) return null
  return negative ? -amount : amount
}

function parseResult(value: unknown): FinancialKpis | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const moneyKeys = ["revenue", "revenuePrevious", "pendingInvoicesAmount", "expenses", "expensesPrevious", "netResult"] as const
  const countKeys = ["invoicesCount", "invoicesCountPrevious", "pendingInvoicesCount", "expensesCount"] as const
  const parsed = { ...EMPTY, available: true }
  const amounts = {} as Record<(typeof moneyKeys)[number], bigint>
  for (const key of moneyKeys) {
    const amount = cents(row[key])
    if (amount === null || (key === "pendingInvoicesAmount" && amount < BigInt(0))) return null
    amounts[key] = amount
    parsed[key] = Number(amount) / 100
  }
  for (const key of countKeys) {
    if (typeof row[key] !== "number" || !Number.isSafeInteger(row[key]) || row[key] < 0) return null
    parsed[key] = row[key]
  }
  if (amounts.netResult !== amounts.revenue - amounts.expenses) return null
  if ((amounts.pendingInvoicesAmount === BigInt(0)) !== (parsed.pendingInvoicesCount === 0)) return null
  return parsed
}

export async function getFinancialKpis(input: AccountingKpiWindowInput): Promise<FinancialKpis> {
  if (!input || !validDate(input.start) || !validDate(input.end) || input.start > input.end) return { ...EMPTY }
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("read_my_financial_kpis", {
      p_start: input.start,
      p_end: input.end,
    })
    if (error) return { ...EMPTY }
    return parseResult(data) ?? { ...EMPTY }
  } catch {
    // Provider details can contain private data. A missing/denied aggregate must
    // remain unavailable instead of falling back to invoice header estimates.
    return { ...EMPTY }
  }
}
