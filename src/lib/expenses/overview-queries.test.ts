import { describe, expect, it, vi } from "vitest"
import { createClient } from "@supabase/supabase-js"
import { expensesQuery, expensesSummary, expenseDependencies } from "./overview-queries"
import { substringFilter } from "@/lib/supabase/search-filter"

function counted(rows: unknown[], count = rows.length) {
  return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json", "content-range": `0-${Math.max(0, rows.length - 1)}/${count}` } })
}
function fixture(reply: (url: URL) => Response = () => counted([])) {
  const requests: URL[] = []
  const client = createClient("https://expense-fixture.test", "public-fixture-placeholder", {
    global: { fetch: vi.fn(async input => { const url = new URL(String(input)); requests.push(url); return reply(url) }) },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return { client, requests }
}
const signal = () => new AbortController().signal

describe("expense overview reads", () => {
  it("reads bounded database pages with exact count and deterministic live-row order", async () => {
    const { client, requests } = fixture()
    await expensesQuery(client, "").range(100,124)
    const p = requests[0].searchParams
    expect(p.get("offset")).toBe("100")
    expect(p.get("limit")).toBe("25")
    expect(p.get("order")).toBe("expense_date.desc,id.asc")
    expect(p.get("deleted_at")).toBe("is.null")
    expect(p.get("driver_search.or")).toBeNull()
  })
  it("searches literal document OR bilingual driver fields without losing the displayed driver", async () => {
    const { client, requests } = fixture()
    const term = 'أحمد "50%_,x)'
    await expensesQuery(client,term).range(0,24)
    const p = requests[0].searchParams
    expect(p.get("driver_search.or")).toBe(`(${substringFilter(["full_name_ar","full_name_en","driver_code"],term)})`)
    expect(p.get("or")).toBe(`(${substringFilter(["expense_code","vendor","expense_type","category","description"],term)},driver_search.not.is.null)`)
    expect(p.get("driver.or")).toBeNull()
    expect(p.get("driver_id")).toBeNull()
    expect(p.get("select")).toContain("driver:drivers(full_name_ar,driver_code),driver_search:drivers()")
  })
  it("sums every summary page exactly, independently of visible list/search", async () => {
    const { client, requests } = fixture(url => counted(Number(url.searchParams.get("offset")) === 500
      ? [{ id:"last", amount:"0.20", vat_amount:"0.02", currency:"SAR", is_approved:true }]
      : Array.from({ length:500 },(_,i)=>({ id:String(i), amount:"0.10", vat_amount:"0.01", currency:"SAR", is_approved:false })),501))
    expect(await expensesSummary(client,signal())).toEqual({ count:501, pending:500, net:50.2, vat:5.02 })
    expect(requests).toHaveLength(2)
    for (const url of requests) {
      expect(url.searchParams.get("order")).toBe("id.asc")
      expect(url.searchParams.get("deleted_at")).toBe("is.null")
      expect(url.searchParams.get("select")).toBe("id,amount,vat_amount,currency,is_approved")
      expect(url.searchParams.get("or")).toBeNull()
    }
  })
  it("recognizes an explicitly empty complete summary", async () => {
    expect(await expensesSummary(fixture().client,signal())).toEqual({ count:0,pending:0,net:0,vat:0 })
  })
  it.each([{ amount:null },{ amount:-1 },{ amount:"1.001" },{ vat_amount:null },{ vat_amount:"bad" },{ currency:"USD" },{ is_approved:null }])(
    "rejects invalid or mixed-currency totals instead of returning zero: %j", async invalid => {
      const { client } = fixture(()=>counted([{ id:"one",amount:10,vat_amount:1.5,currency:"SAR",is_approved:false,...invalid }]))
      await expect(expensesSummary(client,signal())).rejects.toThrow("Could not load expense totals")
    })
  it.each(["failure","missing count","truncated"])("rejects a %s summary without partial metrics", async kind => {
    let page = 0
    const { client } = fixture(()=>kind === "failure" ? new Response('{"message":"private detail"}',{status:403})
      : kind === "missing count" ? new Response("[]",{headers:{"content-type":"application/json"}})
      : counted(page++===0 ? [{id:"one",amount:10,vat_amount:0,currency:"SAR",is_approved:false}] : [],2))
    await expect(expensesSummary(client,signal())).rejects.toThrow()
  })
  it("looks up just the mapped account codes without the old first-100 cap", async () => {
    const { client, requests } = fixture(url => url.pathname.endsWith("expense_category_mappings")
      ? counted([{expense_type:"fuel",coa_account_code:"9999",vat_recoverability:"recoverable"},{expense_type:"other",coa_account_code:"9999",vat_recoverability:"pending_review"}])
      : counted([{account_code:"9999",name_ar:"Mapped account"}]))
    expect(await expenseDependencies(client,signal())).toEqual({byType:{fuel:"9999",other:"9999"},names:{"9999":"Mapped account"},recoverabilityByType:{fuel:"recoverable",other:"pending_review"}})
    expect(requests[1].searchParams.get("account_code")).toBe('in.(9999)')
    expect(requests[1].searchParams.get("limit")).toBeNull()
    expect(requests[1].searchParams.get("deleted_at")).toBe("is.null")
  })
  it("accepts no configured mappings without issuing an empty account filter", async () => {
    const { client, requests } = fixture()
    expect(await expenseDependencies(client,signal())).toEqual({byType:{},names:{},recoverabilityByType:{}})
    expect(requests).toHaveLength(1)
  })
  it.each(["mapping failure","account failure","mapping truncation","account truncation"])("surfaces %s", async kind => {
    const { client } = fixture(url => {
      const mapping = url.pathname.endsWith("expense_category_mappings")
      if ((mapping && kind==="mapping failure") || (!mapping && kind==="account failure")) return new Response('{}',{status:403})
      return mapping ? counted([{expense_type:"fuel",coa_account_code:"5010",vat_recoverability:"recoverable"}],kind==="mapping truncation"?2:1)
        : counted([{account_code:"5010",name_ar:"Fuel"}],kind==="account truncation"?2:1)
    })
    await expect(expenseDependencies(client,signal())).rejects.toThrow("Could not load expense")
  })
  it.each([null,"unknown"])("rejects invalid VAT classification %s instead of assuming recoverable", async classification => {
    const {client}=fixture(()=>counted([{expense_type:"advance",coa_account_code:"1500",vat_recoverability:classification}]))
    await expect(expenseDependencies(client,signal())).rejects.toThrow("Could not load expense mappings")
  })
  it("does not treat a dangling mapping as ready accounting configuration",async()=>{
    const {client}=fixture(url=>url.pathname.endsWith("expense_category_mappings")
      ?counted([{expense_type:"fuel",coa_account_code:"5000",vat_recoverability:"recoverable"}]):counted([]))
    await expect(expenseDependencies(client,signal())).rejects.toThrow("Could not load expense accounts")
  })
})
