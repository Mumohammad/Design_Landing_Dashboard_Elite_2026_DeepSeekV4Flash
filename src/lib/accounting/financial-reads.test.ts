import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ permission: vi.fn(), user: vi.fn(), rpc: vi.fn(), caller: vi.fn(), admin: vi.fn(), audit: vi.fn() }))
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: mocks.permission, getCurrentUser: mocks.user }))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.caller }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }))
vi.mock("@/lib/auth/sessions", () => ({ writeAuditLog: mocks.audit }))
import { listStatementPeriods, getFinancialStatements, exportStatementCsv, generateStatementReport } from "./statements"
import { getVatReconciliation, listVatReviewItems, getVatReturn, resolveVatReviewItem, exportVatReconciliationCsv, generateVatReturnReport } from "./vat"
beforeEach(() => {
 vi.clearAllMocks()
 mocks.permission.mockResolvedValue(undefined)
 mocks.user.mockResolvedValue({ tenantId: "current-tenant", authUserId: "current-actor" })
 mocks.caller.mockResolvedValue({ rpc: mocks.rpc })
 mocks.admin.mockImplementation(() => { throw new Error("Unexpected service-role access") })
 mocks.audit.mockResolvedValue(undefined)
 mocks.rpc.mockResolvedValue({ data: [], error: null })
})
const reads = [
 ["periods", () => listStatementPeriods()],
 ["statements", () => getFinancialStatements({ period_year:2026, period_month:10 })],
 ["VAT reconciliation", () => getVatReconciliation()],
 ["VAT reviews", () => listVatReviewItems()],
 ["VAT return", () => getVatReturn({period_year:2026,period_month:10})],
] as const
for (const [name, action] of reads) describe(name, () => {
 it("denies before creating any database client", async () => {
  mocks.permission.mockRejectedValue(Object.assign(new Error("private permission detail"), { code: "AUTH007" }))
  expect(await action()).toMatchObject({success:false,error:"You do not have permission to perform this accounting action."})
  expect(mocks.caller).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it("returns a failure without provider diagnostics when the database fails", async () => {
  mocks.rpc.mockResolvedValue({data:null,error:{message:"private relation or token detail"}})
  const result=await action(); expect(result.success).toBe(false); expect(result.error).not.toContain("private")
 })
})
it("statement periods are read through the caller with no accepted tenant override", async () => {
 mocks.rpc.mockResolvedValue({data:[{period_year:2026,period_month:10}],error:null})
 expect(await listStatementPeriods()).toEqual({success:true,periods:[{period_year:2026,period_month:10}]})
 expect(mocks.rpc).toHaveBeenCalledWith("read_my_financial_report",{p_kind:"periods"})
 expect(mocks.permission).toHaveBeenCalledWith("accounting","read")
 expect(mocks.admin).not.toHaveBeenCalled()
})
it("rejects incomplete statement payloads instead of reporting an empty balanced ledger", async () => {
 mocks.rpc.mockResolvedValue({data:{profit_loss:[],balance_sheet:[]},error:null})
 expect((await getFinancialStatements({period_year:2026,period_month:10})).success).toBe(false)
})
it("exports all 1201 statement accounts from the guarded snapshot", async () => {
 const rows=Array.from({length:1201},(_,i)=>({account_code:String(i),name_ar:"Account",name_en:"Account",account_type:"income",normal_balance:"credit",total_debit:0,total_credit:0.01,net_balance:0.01}))
 mocks.rpc.mockResolvedValue({data:{profit_loss:rows,balance_sheet:[],cash_flow:[]},error:null})
 const result=await exportStatementCsv({kind:"profit_loss",period_year:2026,period_month:10})
 expect(result.success).toBe(true); expect(result.csv?.trim().split(/\r?\n/)).toHaveLength(1202)
 expect(result.csv).toContain("1200,Account,Account")
 expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({newValues:expect.objectContaining({rows:1201})}))
 expect(mocks.admin).not.toHaveBeenCalled()
})
it("VAT review returns all rows including UUIDs ordered differently from invoice dates", async () => {
 const rows=Array.from({length:1201},(_,i)=>({id:String(1201-i),invoice_ref:"REF-"+i,invoice_date:"2026-10-01",vat_amount:0.01}))
 mocks.rpc.mockResolvedValue({data:rows,error:null})
 expect((await listVatReviewItems()).rows).toEqual(rows)
 expect(mocks.rpc).toHaveBeenCalledTimes(1)
 expect(mocks.rpc).toHaveBeenCalledWith("read_my_financial_report",{p_kind:"vat_review"})
})
it("VAT CSV includes all 1201 periods and requires read and export", async () => {
 const rows=Array.from({length:1201},(_,i)=>({period_year:1900+Math.floor(i/12),period_month:i%12+1,output_vat:0.01,net_position:0.01}))
 mocks.rpc.mockResolvedValue({data:rows,error:null})
 const result=await exportVatReconciliationCsv()
 expect(result.success).toBe(true); expect(result.csv?.trim().split(/\r?\n/)).toHaveLength(1202)
 expect(mocks.permission.mock.calls).toEqual([["accounting","export"],["accounting","read"]])
})
it("VAT classification uses one caller transaction instead of a separate admin update/audit", async () => {
 mocks.rpc.mockResolvedValue({error:null})
 expect(await resolveVatReviewItem({id:"review-id",recoverability:"recoverable"})).toEqual({success:true})
 expect(mocks.permission).toHaveBeenCalledWith("accounting","approve")
 expect(mocks.rpc).toHaveBeenCalledWith("resolve_my_vat_review",{p_id:"review-id",p_recoverability:"recoverable"})
 expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled()
})

it("VAT report rendering uses a new guarded snapshot and never looks up a globally shared period document", async () => {
 mocks.rpc.mockResolvedValue({data:{id:"snapshot-id",doc_number:"VAT-RET-2026-10-unique",verify_url:"/verify-document/opaque",generated_at:"2026-10-22T10:00:00Z",company:{name_ar:"اسم اختباري",name_en:"Synthetic company",vat_number:"000000000000000"},data:{period_year:2026,period_month:10,period_status:"open",output_vat:"15.10",recoverable_input_vat:"5.05",non_recoverable_vat:"0.00",pending_review_vat:"0.00",pending_review_rows:0,adjustments_output:"0.00",adjustments_input:"0.00",net_position:"10.05"}},error:null})
 const result=await generateVatReturnReport({period_year:2026,period_month:10})
 expect(result.success).toBe(true); expect(result.docNumber).toBe("VAT-RET-2026-10-unique")
 expect(result.html).toContain("Synthetic company"); expect(result.html).toContain("10.05")
 expect(mocks.rpc).toHaveBeenCalledWith("create_my_vat_return_document",{p_year:2026,p_month:10})
 expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled()
})

for (const [name, action] of reads) it(name + " hides unexpected provider exceptions", async () => {
 mocks.caller.mockRejectedValue(new Error("private connection or token detail"))
 const result = await action()
 expect(result.success).toBe(false); expect(result.error).not.toContain("private")
})
it("statement reads keep exact decimal strings and reject unsafe monetary totals before rendering", async () => {
 const row = {account_code:"4000",name_ar:"إيراد",name_en:"Income",account_type:"income",normal_balance:"credit",total_debit:"0.00",total_credit:"0.10",net_balance:"0.10"}
 mocks.rpc.mockResolvedValue({data:{profit_loss:[row],balance_sheet:[],cash_flow:[]},error:null})
 expect((await getFinancialStatements({period_year:2026,period_month:10})).profitLoss?.[0].net_balance).toBe("0.10")
 mocks.rpc.mockResolvedValue({data:{profit_loss:[{...row,net_balance:"90071992547409.92"}],balance_sheet:[],cash_flow:[]},error:null})
 expect((await getFinancialStatements({period_year:2026,period_month:10})).success).toBe(false)
 mocks.rpc.mockResolvedValue({data:{profit_loss:Array.from({length:2},()=>({...row,net_balance:"50000000000000.00"})),balance_sheet:[],cash_flow:[]},error:null})
 expect((await getFinancialStatements({period_year:2026,period_month:10})).success).toBe(false)
})

for(const vector of [
 {kind:"profit_loss" as const,report:{profit_loss:[{account_code:"4000",name_ar:"رد إيراد",name_en:"Revenue refund",account_type:"income",normal_balance:"credit",total_debit:"25.10",total_credit:"0.00",net_balance:"-25.10"}],balance_sheet:[],cash_flow:[]},code:"4000",amount:"-25.10"},
 {kind:"profit_loss" as const,report:{profit_loss:[{account_code:"5000",name_ar:"عكس مصروف",name_en:"Expense reversal",account_type:"expense",normal_balance:"debit",total_debit:"0.00",total_credit:"12.34",net_balance:"12.34"}],balance_sheet:[],cash_flow:[]},code:"5000",amount:"-12.34"},
 {kind:"balance_sheet" as const,report:{profit_loss:[],balance_sheet:[{account_code:"1000",name_ar:"سحب على المكشوف",name_en:"Overdrawn cash",account_type:"asset",normal_balance:"debit",total_debit:"0.00",total_credit:"75.00",balance:"-75.00"},{account_code:"__UNCLOSED_RESULT__",name_ar:"خسارة",name_en:"Unclosed loss",account_type:"equity",normal_balance:"credit",total_debit:"75.00",total_credit:"0.00",balance:"-75.00"}],cash_flow:[]},code:"1000",amount:"-75.00"},
])it("preserves signed "+vector.kind+" row "+vector.code+" in the printable financial report",async()=>{
 mocks.rpc.mockResolvedValue({data:vector.report,error:null})
 mocks.admin.mockReturnValue({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{name_ar:"منشأة اختبارية",name_en:"Synthetic company",vat_number:null},error:null})})})})})
 const result=await generateStatementReport({kind:vector.kind,period_year:2026,period_month:10})
 expect(result.success).toBe(true)
 const rows=result.html?.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]
 expect(rows).toContain(vector.amount+" SAR")
 if(vector.kind==="balance_sheet"){expect(rows).toContain("__UNCLOSED_RESULT__");expect(rows?.split("-75.00 SAR")).toHaveLength(3)}
})
it.each(["70368744177664.01","90071992547409.91"])("fails visibly instead of changing statement cents at %s",async amount=>{
 mocks.rpc.mockResolvedValue({data:{profit_loss:[{account_code:"4000",account_type:"income",normal_balance:"credit",name_ar:"إيراد",name_en:"Revenue",total_debit:"0.00",total_credit:amount,net_balance:amount}],balance_sheet:[],cash_flow:[]},error:null})
 expect((await getFinancialStatements({period_year:2026,period_month:10})).success).toBe(false)
})

it.each(["VAT007: private source evidence","VAT001: private period","ACC001: private period"])("explains held VAT classification without exposing source diagnostics: %s",async message=>{
 mocks.rpc.mockResolvedValue({data:null,error:{message}})
 const result=await resolveVatReviewItem({id:"review-id",recoverability:"recoverable"})
 expect(result.success).toBe(false);expect(result.errorAr).toBeTruthy();expect(JSON.stringify(result)).not.toContain("private");expect(mocks.audit).not.toHaveBeenCalled()
})
