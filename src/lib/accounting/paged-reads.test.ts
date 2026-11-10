import { describe, expect, it, vi } from "vitest"
import { parseAccountingPage, readAccountingPage, sumAccountingMoney } from "./paged-reads"
import type { SupabaseClient } from "@supabase/supabase-js"
const row={id:"payment-id",amount:"0.10",unallocated_amount:"0.05"}
const payload=(rows:unknown[]=[row],total=1)=>({rows,total,page:1,page_size:25,summary:{payment_count:1008,inflow:"200.50",outflow:"20.00",unallocated:"180.50",outstanding_ar:"100.00",outstanding_ap:"0.00"}})
describe("accounting page contract",()=>{
 it("preserves exact decimal strings and whole-tenant KPIs",()=>{
  const value=parseAccountingPage(payload(),1,25,false,"payments")
  expect(value.rows).toEqual([row]);expect(value.summary?.payment_count).toBe(1008);expect(value.summary?.inflow).toBe("200.50")
 })
 it("supports an empty filtered page without erasing global metrics",()=>{
  const value=parseAccountingPage(payload([],0),1,25)
  expect(value.total).toBe(0);expect(value.summary?.inflow).toBe("200.50")
 })
 it("rejects truncated exports instead of silently exporting first 1000",()=>{
  expect(()=>parseAccountingPage(payload(Array.from({length:1000},()=>row),1008),1,25,true)).toThrow("Could not load accounting records")
  expect(parseAccountingPage(payload(Array.from({length:1008},()=>row),1008),1,25,true).rows).toHaveLength(1008)
 })
 for(const [name,value]of [
  ["missing count",{...payload(),total:null}], ["fractional count",{...payload(),total:1.5}],
  ["missing row",payload([],1)], ["wrong page",{...payload(),page:2}], ["oversized page",payload(Array.from({length:26},()=>row),26)],
  ["binary amount",payload([{...row,amount:0.1}])], ["unsafe exponent",payload([{...row,amount:"1e20"}])],
  ["fractional cent",payload([{...row,amount:"0.001"}])], ["missing payment amount",payload([{id:"missing"}])],
  ["invalid aggregate",{...payload(),summary:{...payload().summary,inflow:200.5}}],
 ]as const)it("rejects "+name,()=>expect(()=>parseAccountingPage(value,1,25,false,"payments")).toThrow("Could not load accounting records"))
 it("requests caller-bound pages with literal search and no tenant override",async()=>{
  const rpc=vi.fn().mockResolvedValue({data:payload(),error:null});const client={rpc}as unknown as SupabaseClient
  expect((await readAccountingPage(client,"payments",{search:"%_",party:"party-id"})).rows).toEqual([row])
  expect(rpc).toHaveBeenCalledWith("read_my_accounting_page",{p_kind:"payments",p_search:"%_",p_page:1,p_page_size:25,p_party:"party-id",p_export:false})
 })
 it("does not pass provider diagnostics into UI failures",async()=>{
  const rpc=vi.fn().mockResolvedValue({data:null,error:{message:"private database token"}})
  await expect(readAccountingPage({rpc}as unknown as SupabaseClient,"payments")).rejects.toThrow("Could not load accounting records")
  rpc.mockRejectedValueOnce(new Error("private connection"))
  await expect(readAccountingPage({rpc}as unknown as SupabaseClient,"payments")).rejects.toThrow("Could not load accounting records")
 })
 it("cancels stale requests and rejects their data",async()=>{
  const controller=new AbortController();controller.abort()
  const abortSignal=vi.fn().mockResolvedValue({data:payload(),error:null}),rpc=vi.fn(()=>({abortSignal}))
  await expect(readAccountingPage({rpc}as unknown as SupabaseClient,"payments",{signal:controller.signal})).rejects.toThrow()
  expect(abortSignal).toHaveBeenCalledWith(controller.signal)
 })
})

it("adds ledger display totals without safe-integer or binary precision loss",()=>{expect(sumAccountingMoney("0.10","0.20")).toBe("0.30");expect(sumAccountingMoney("90071992547409.92","0.01")).toBe("90071992547409.93");expect(sumAccountingMoney("-0.15","0.05")).toBe("-0.10");expect(()=>sumAccountingMoney("1e99")).toThrow()})
