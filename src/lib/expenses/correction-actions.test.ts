import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks=vi.hoisted(()=>({
 permission:vi.fn(async()=>{}),user:vi.fn(async()=>({id:"user-row"})),rate:vi.fn(async()=>({success:true})),
 rpc:vi.fn(async(_fn:string,_args:Record<string,unknown>):Promise<{data:unknown;error:null|{message:string}} >=>{void _fn;void _args;return {data:{id:"11111111-1111-4111-8111-111111111111",version:2,replayed:false},error:null}}),
 refresh:vi.fn(),admin:vi.fn(()=>{throw Error("No privileged fallback")}),
}))
vi.mock("@/lib/auth/authorization",()=>({requirePermission:mocks.permission,getCurrentUser:mocks.user}))
vi.mock("@/lib/auth/rate-limit",()=>({rateLimitExpenses:mocks.rate}))
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:mocks.rpc})}))
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:mocks.admin}))
vi.mock("next/cache",()=>({revalidatePath:mocks.refresh}))
import { correctPendingExpense } from "./correction-actions"
const ID="11111111-1111-4111-8111-111111111111",REQUEST="22222222-2222-4222-8222-222222222222"
const details={expense_type:"fuel",amount:123.45,expense_date:"2026-10-22",vat_rate:0,vendor:" Vendor ",description:" Receipt description ",category:" "}
const input={id:ID,expectedVersion:1,requestId:REQUEST,operation:"update",reason:" Correct receipt amount ",details}
beforeEach(()=>{
 vi.clearAllMocks();mocks.permission.mockResolvedValue();mocks.user.mockResolvedValue({id:"user-row"});mocks.rate.mockResolvedValue({success:true})
 mocks.rpc.mockResolvedValue({data:{id:ID,version:2,replayed:false},error:null})
})
describe("pending expense corrections",()=>{
 it("uses only the caller boundary, strips browser identity and normalizes optional text",async()=>{
  expect(await correctPendingExpense({...input,tenantId:"attacker",actor:"attacker",details:{...details,receipt_url:"forged"}})).toEqual({success:true,id:ID,version:2,replayed:false})
  expect(mocks.rpc).toHaveBeenCalledWith("correct_pending_expense_atomic",{p_id:ID,p_expected_version:1,p_request_id:REQUEST,p_operation:"update",p_reason:"Correct receipt amount",p_details:{...details,vendor:"Vendor",description:"Receipt description",category:null}})
  expect(mocks.permission).toHaveBeenCalledWith("expenses","update");expect(mocks.admin).not.toHaveBeenCalled()
 })
 it.each([
  {...input,expectedVersion:0}, {...input,reason:"no"}, {...input,details:{...details,amount:1.234}},
  {...input,details:{...details,expense_date:"2026-02-30"}}, {...input,details:undefined},
  {...input,operation:"cancel"}, {...input,id:"invalid"}, {...input,details:{...details,vat_rate:101}},
 ])("rejects malformed correction before permission or database access",async candidate=>{
  const result=await correctPendingExpense(candidate);expect(result.success).toBe(false);expect(mocks.permission).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it("cancels without mutating the expense fields or attachment",async()=>{
  expect((await correctPendingExpense({...input,operation:"cancel",details:undefined})).success).toBe(true)
  expect(mocks.rpc).toHaveBeenCalledWith("correct_pending_expense_atomic",expect.objectContaining({p_operation:"cancel",p_details:null}))
 })
 it("returns durable replay confirmation with the identical request identifier",async()=>{
  mocks.rpc.mockResolvedValueOnce({data:{id:ID,version:2,replayed:true},error:null})
  expect(await correctPendingExpense(input)).toMatchObject({success:true,version:2,replayed:true})
  expect(mocks.rpc.mock.calls[0][1].p_request_id).toBe(REQUEST)
 })
 it("retains confirmed persistence if cache refresh fails",async()=>{
  mocks.refresh.mockImplementationOnce(()=>{throw Error("cache unavailable")})
  expect((await correctPendingExpense(input)).success).toBe(true)
 })
 it("rejects a permission or MFA failure without privileged fallback",async()=>{
  mocks.permission.mockRejectedValueOnce(Error("private permission detail"))
  const result=await correctPendingExpense(input);expect(result.success).toBe(false);expect(result.error).toContain("permission");expect(JSON.stringify(result)).not.toContain("private");expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it("requires a verified session",async()=>{
  mocks.user.mockResolvedValueOnce(null as never)
  expect((await correctPendingExpense(input)).success).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it("rate limits writes before the database call",async()=>{
  mocks.rate.mockResolvedValueOnce({success:false})
  expect((await correctPendingExpense(input)).error).toMatch(/Rate limit/);expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it.each(["EXP_EDIT_STALE","EXP_EDIT_MAKER_REQUIRED","EXP_EDIT_FINANCE_REVIEW","EXP_CANCELLED","EXP_EDIT_RETRY_MISMATCH"])("returns a safe bilingual message for %s",async code=>{
  mocks.rpc.mockResolvedValueOnce({data:null,error:{message:code+": private detail"}})
  const result=await correctPendingExpense(input);expect(result.success).toBe(false);expect(result.errorAr).toBeTruthy();expect(JSON.stringify(result)).not.toContain("private")
 })
 it.each([{id:"33333333-3333-4333-8333-333333333333",version:2,replayed:false},{id:ID,version:0,replayed:false},null])("does not confirm an invalid or unrelated receipt",async data=>{
  mocks.rpc.mockResolvedValueOnce({data,error:null})
  expect((await correctPendingExpense(input)).success).toBe(false);expect(mocks.refresh).not.toHaveBeenCalled()
 })
 it("sanitizes unexpected provider diagnostics and permits an unchanged retry",async()=>{
  mocks.rpc.mockRejectedValueOnce(Error("private connection detail"))
  const result=await correctPendingExpense(input);expect(result.error).toMatch(/unchanged/);expect(JSON.stringify(result)).not.toContain("private")
 })
})
