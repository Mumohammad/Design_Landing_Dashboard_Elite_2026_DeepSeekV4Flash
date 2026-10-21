import { describe, expect, it } from "vitest"
import { createClient } from "@supabase/supabase-js"
import { isLedgerKind, ledgerQuery, type LedgerKind } from "./ledger-queries"
import { substringFilter } from "@/lib/supabase/search-filter"

function fixture() {
  const requests: { url: URL; headers: Headers }[] = []
  const client = createClient("https://ledger-fixture.test", "public-fixture-placeholder", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers) })
      return new Response("[]", { headers: { "content-range": "0-0/0", "content-type": "application/json" } })
    } },
  })
  return { client, requests }
}

describe("accounting ledger pagination", () => {
  it.each([
    ["journal", "journal_entries", "entry_date.desc,created_at.desc,id.asc"],
    ["receivables", "receivables", "due_date.asc,id.asc"],
    ["payables", "payables", "due_date.asc,id.asc"],
  ] as const)("%s requests exact, stable database pages beyond the old cap", async (kind, table, order) => {
    const { client, requests } = fixture()
    await ledgerQuery(client, kind, "").range(200, 224)
    const { url, headers } = requests[0]
    expect(url.pathname).toBe(`/rest/v1/${table}`)
    expect(url.searchParams.get("offset")).toBe("200")
    expect(url.searchParams.get("limit")).toBe("25")
    expect(url.searchParams.get("order")).toBe(order)
    expect(url.searchParams.get("deleted_at")).toBe("is.null")
    expect(headers.get("Prefer")).toContain("count=exact")
    expect(url.searchParams.get("or")).toBeNull()
  })

  it.each(["journal", "receivables", "payables"] as const)("%s treats Arabic, quotes and wildcards as literal search text", async kind => {
    const { client, requests } = fixture()
    const term = 'قيد "50%_\\),status.neq.open'
    await ledgerQuery(client, kind, term).range(0, 24)
    const columns = kind === "journal" ? ["entry_ref", "description_ar", "description_en"] : ["invoice_ref"]
    expect(requests[0].url.searchParams.get("or")).toBe(`(${substringFilter(columns, term)})`)
    expect(requests[0].url.searchParams.get("status")).toBeNull()
  })

  it("does not turn an unknown tab into an arbitrary table query", () => {
    const { client, requests } = fixture()
    expect(() => ledgerQuery(client, "zatca_csids" as LedgerKind, "")).toThrow("Unsupported ledger")
    expect(requests).toHaveLength(0)
    expect(["journal", "receivables", "payables"].every(isLedgerKind)).toBe(true)
    expect(["__proto__", "payments", "", "journal_entries"].some(isLedgerKind)).toBe(false)
  })
})
