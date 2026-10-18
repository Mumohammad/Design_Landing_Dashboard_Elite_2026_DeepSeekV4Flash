// Financial Phase 14 — unit tests for the report CSV builder
// (TEST-STRATEGY.md §3.1): RFC-4180-ish quoting, CRLF line endings, UTF-8.
import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { buildCsv, collectReportData } from "./generator"

describe("reconciliation reporting periods", () => {
  it.each([[2026, 2, "2026-02-28"], [2028, 2, "2028-02-29"], [2026, 4, "2026-04-30"]])(
    "queries calendar-correct bounds for %i-%i", async (year, month, end) => {
      const query = { select: vi.fn(), eq: vi.fn(), gte: vi.fn(), lte: vi.fn(), is: vi.fn(), order: vi.fn(), limit: vi.fn().mockResolvedValue({ data: [] }) }
      for (const name of ["select", "eq", "gte", "lte", "is", "order"] as const) query[name].mockReturnValue(query)
      const client = { from: vi.fn().mockReturnValue(query) }
      await collectReportData(client as unknown as SupabaseClient, "synthetic-tenant", "hs_reconciliation", { year, month })
      expect(query.gte).toHaveBeenCalledWith("entry_date", `${year}-${String(month).padStart(2, "0")}-01`)
      expect(query.lte).toHaveBeenCalledWith("entry_date", end)
    },
  )
})

describe("buildCsv", () => {
  it("joins rows with CRLF and ends with a trailing CRLF", () => {
    expect(buildCsv(["a", "b"], [[1, 2]])).toBe("a,b\r\n1,2\r\n")
  })

  it("quotes fields containing commas", () => {
    expect(buildCsv(["note"], [["x, y"]])).toBe('note\r\n"x, y"\r\n')
  })

  it("escapes embedded double quotes by doubling them", () => {
    expect(buildCsv(["note"], [['say "hi"']])).toBe('note\r\n"say ""hi"""\r\n')
  })

  it("quotes fields containing CR/LF", () => {
    const csv = buildCsv(["note"], [["line1\nline2"]])
    expect(csv).toBe('note\r\n"line1\nline2"\r\n')
    expect(csv.startsWith('note\r\n"')).toBe(true)
  })

  it("serializes null/undefined as empty fields", () => {
    expect(buildCsv(["a", "b"], [[null, undefined]])).toBe("a,b\r\n,\r\n")
  })

  it("preserves Arabic (UTF-8) content", () => {
    const csv = buildCsv(["name"], [["شركة تجارية"]])
    expect(csv).toContain("شركة تجارية")
  })
})
