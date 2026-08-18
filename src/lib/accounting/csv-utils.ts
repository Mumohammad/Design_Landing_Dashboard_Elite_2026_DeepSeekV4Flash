// Shared accounting helpers — plain (non-"use server") module so these can be
// synchronous. They were originally exported from accounting/actions.ts, which
// is a "use server" file where every export must be an async function; moving
// them here keeps the call sites simple (no await) and the types exact.
//
// - mapFinancialError  map a DB-raised "CODE: message" to its bilingual text
// - parseCsv / toCsv   RFC-4180-ish CSV parser/serializer (no dependency)

import { getErrorDefinition } from "@/lib/errors/error-codes"

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense"
export type NormalBalance = "debit" | "credit"

/**
 * Conventional normal balance per account type (contra accounts opt out).
 * Lives here (a plain module) because it is imported by client components —
 * a "use server" file can only export async functions.
 */
export const CONVENTIONAL_BALANCE: Record<AccountType, NormalBalance> = {
  asset: "debit",
  expense: "debit",
  liability: "credit",
  equity: "credit",
  income: "credit",
}

/**
 * Map a DB-raised financial exception code (e.g. "JRN004: …", "ACC001: …",
 * "INV003: …") to its bilingual user-facing message from the error taxonomy.
 * Falls back to the raw message when the code is unknown.
 */
export function mapFinancialError(raw: string): string {
  const code = raw.split(":")[0]?.trim()
  if (!code) return raw
  const def = getErrorDefinition(code)
  return def && def.code !== "ERR_INTERNAL" ? def.messageEn : raw
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      row.push(field)
      field = ""
    } else if (ch === "\n") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else {
      field += ch
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""))
}

export function toCsv(headers: string[], rows: (string | number | boolean | null)[][]): string {
  const esc = (v: string | number | boolean | null): string => {
    const s = v === null || v === undefined ? "" : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n")
}
