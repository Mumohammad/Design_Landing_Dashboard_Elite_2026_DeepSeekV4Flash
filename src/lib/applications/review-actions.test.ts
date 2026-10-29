import { beforeEach,describe,expect,it,vi } from "vitest"
const ID="11111111-1111-4111-8111-111111111111"
const mocks=vi.hoisted(()=>({
 permission:vi.fn(async()=>{}),user:vi.fn(async():Promise<{id:string}|null>=>({id:"reviewer"})),rate:vi.fn(async()=>({success:true})),
 rpc:vi.fn(async(_name:string,_args:Record<string,unknown>):Promise<{data:unknown;error:{message:string}|null}>=>{void _name;void _args;return {data:null,error:null}}),
 refresh:vi.fn(),admin:vi.fn(()=>{throw Error("No privileged fallback")}),
}))
vi.mock("@/lib/auth/authorization",()=>({requirePermission:mocks.permission,getCurrentUser:mocks.user}))
vi.mock("@/lib/auth/rate-limit",()=>({rateLimitApplications:mocks.rate}))
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:mocks.rpc})}))
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:mocks.admin}))
vi.mock("next/cache",()=>({revalidatePath:mocks.refresh}))
import { fetchApplicationsPage,mutateApplicationReview } from "./review-actions"
const input={applicationId:ID,expectedVersion:1,action:"approved",reason:"  Reviewed submitted evidence  "}
const receipt={id:ID,version:2,status:"approved",archived:false}
const row={id:ID,application_number:"APP-TEST-1",full_name:"Synthetic Applicant",mobile:"+966500000000",city:null,work_type:"full_time",driver_category:null,status:"submitted",platform_codes:[],submitted_at:"2026-10-23T00:00:00Z",created_at:"2026-10-23T00:00:00Z",workflow_version:1,archived_at:null}
const page=()=>({rows:[{...row}],summary:{total:1,pending:1,approved:0,rejected:0,withdrawn:0},total:1,page:1,pageSize:25,totalPages:1})
beforeEach(()=>{
 vi.clearAllMocks();mocks.permission.mockResolvedValue();mocks.user.mockResolvedValue({id:"reviewer"});mocks.rate.mockResolvedValue({success:true});mocks.rpc.mockResolvedValue({data:receipt,error:null});mocks.refresh.mockReset()
})
describe("application review caller boundary",()=>{
 it("binds tenant/actor to the caller and passes the reviewed version and trimmed reason",async()=>{
  expect(await mutateApplicationReview({...input,tenantId:"forged",actor:"forged"})).toEqual({success:true,...receipt})
  expect(mocks.rpc).toHaveBeenCalledWith("mutate_application_review_atomic",{p_id:ID,p_expected_version:1,p_action:"approved",p_reason:"Reviewed submitted evidence",p_surface:"applications"})
  expect(mocks.permission).toHaveBeenCalledWith("hr","approve");expect(mocks.rate).toHaveBeenCalledWith("reviewer");expect(mocks.admin).not.toHaveBeenCalled()
 })
 it.each([
  {...input,expectedVersion:0},{...input,expectedVersion:1.5},{...input,applicationId:"invalid"},
  {...input,action:"submitted"},{...input,reason:"no"},{...input,reason:"a".repeat(501)},{...input,surface:"external"},
 ])("rejects malformed review before any permission or database work",async value=>{
  expect((await mutateApplicationReview(value)).success).toBe(false);expect(mocks.permission).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it.each([
  {action:"under_review",status:"under_review",archived:false},{action:"approved",status:"approved",archived:false},
  {action:"rejected",status:"rejected",archived:false},{action:"withdraw",status:"withdrawn",archived:false},
  {action:"archive",status:"rejected",archived:true},{action:"restore",status:"withdrawn",archived:false},
 ])("confirms the durable result for $action",async vector=>{
  mocks.rpc.mockResolvedValueOnce({data:{...receipt,status:vector.status,archived:vector.archived},error:null})
  expect((await mutateApplicationReview({...input,action:vector.action,surface:"approvals_inbox"})).success).toBe(true)
  expect(mocks.rpc.mock.calls[0][1].p_surface).toBe("approvals_inbox")
 })
 it("requires review permission and MFA without privileged fallback",async()=>{
  mocks.permission.mockRejectedValueOnce(Error("private permission detail"))
  const result=await mutateApplicationReview(input);expect(result.error).toContain("permission");expect(result.errorAr).toBeTruthy();expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.admin).not.toHaveBeenCalled()
 })
 it("requires a verified session",async()=>{
  mocks.user.mockResolvedValueOnce(null)
  expect((await mutateApplicationReview(input)).success).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it("rate limits decisions before the transaction",async()=>{
  mocks.rate.mockResolvedValueOnce({success:false})
  expect((await mutateApplicationReview(input)).error).toContain("Rate limit");expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it.each(["APP_STALE","APP001","APP_FORBIDDEN","APP_INVALID_TRANSITION","APP_HISTORY_IMMUTABLE"])("sanitizes %s diagnostics in both languages",async code=>{
  mocks.rpc.mockResolvedValueOnce({data:null,error:{message:code+": private submitted evidence"}})
  const result=await mutateApplicationReview(input);expect(result.success).toBe(false);expect(result.errorAr).toBeTruthy();expect(JSON.stringify(result)).not.toContain("private")
 })
 it("distinguishes an existing final decision from a transport failure",async()=>{
  mocks.rpc.mockResolvedValueOnce({data:null,error:{message:"APP002: application already decided"}})
  expect(await mutateApplicationReview(input)).toMatchObject({success:false,alreadyDecided:true})
 })
 it.each([
  null,{...receipt,id:"22222222-2222-4222-8222-222222222222"},{...receipt,version:0},
  {...receipt,status:"rejected"},{...receipt,version:1},{...receipt,archived:true},
 ])("does not confirm an invalid or mismatched decision receipt",async data=>{
  mocks.rpc.mockResolvedValueOnce({data,error:null})
  expect((await mutateApplicationReview(input)).success).toBe(false);expect(mocks.refresh).not.toHaveBeenCalled()
 })
 it("does not confirm an archive receipt without archived history",async()=>{
  mocks.rpc.mockResolvedValueOnce({data:receipt,error:null})
  expect((await mutateApplicationReview({...input,action:"archive"})).success).toBe(false)
 })
 it("does not confirm restoration as a reopened pending application",async()=>{
  mocks.rpc.mockResolvedValueOnce({data:{...receipt,status:"submitted"},error:null})
  expect((await mutateApplicationReview({...input,action:"restore"})).success).toBe(false)
 })
 it("retains confirmed decisions when cache revalidation fails",async()=>{
  mocks.refresh.mockImplementationOnce(()=>{throw Error("Cache failure")})
  expect((await mutateApplicationReview(input)).success).toBe(true)
 })
 it("hides unexpected transport diagnostics and asks for a fresh review",async()=>{
  mocks.rpc.mockRejectedValueOnce(Error("private provider information"))
  const result=await mutateApplicationReview(input);expect(result.error).toContain("Reload");expect(JSON.stringify(result)).not.toContain("private")
 })
})
describe("complete application pages",()=>{
 it("uses only caller-bound paging, literal search text, archived filter and checked totals",async()=>{
  mocks.rpc.mockResolvedValueOnce({data:page(),error:null})
  expect(await fetchApplicationsPage({search:' Needle "x,50%_ ',status:"submitted",archived:false,page:1,pageSize:25,tenant:"forged"})).toEqual(page())
  expect(mocks.rpc).toHaveBeenCalledWith("fetch_applications_page",{p_search:'Needle "x,50%_',p_status:"submitted",p_archived:false,p_page:1,p_page_size:25})
  expect(mocks.permission).toHaveBeenCalledWith("hr","read");expect(mocks.admin).not.toHaveBeenCalled()
 })
 it("accepts a clamped final page without fetching a truncated client list",async()=>{
  const result=page();result.total=51;result.page=3;result.totalPages=3;result.summary.total=51;result.summary.pending=51
  mocks.rpc.mockResolvedValueOnce({data:result,error:null})
  expect((await fetchApplicationsPage({page:999})).page).toBe(3)
 })
 it("supports a truthful empty page with nonempty global summary",async()=>{
  const result=page();result.rows=[];result.total=0
  mocks.rpc.mockResolvedValueOnce({data:result,error:null})
  expect((await fetchApplicationsPage({search:"no match"})).summary.total).toBe(1)
 })
 it.each([
  {...page(),rows:[]},{...page(),totalPages:2},{...page(),page:2},{...page(),pageSize:50},
  {...page(),summary:{total:2,pending:1,approved:0,rejected:0,withdrawn:0}},
  {...page(),total:2,rows:[row,row]},
 ])("fails closed on partial rows or inconsistent totals",async data=>{
  mocks.rpc.mockResolvedValueOnce({data,error:null})
  await expect(fetchApplicationsPage()).rejects.toThrow("Could not load applications and their totals")
 })
 it.each([{page:0},{pageSize:101},{search:"a".repeat(201)},{status:"unknown"},{archived:"true"}])("rejects invalid page inputs",async input=>{
  await expect(fetchApplicationsPage(input)).rejects.toThrow("Could not load applications and their totals");expect(mocks.rpc).not.toHaveBeenCalled()
 })
 it("surfaces read errors instead of an empty successful list",async()=>{
  mocks.rpc.mockResolvedValueOnce({data:null,error:{message:"private application read diagnostic"}})
  await expect(fetchApplicationsPage()).rejects.toThrow("Could not load applications and their totals")
 })
 it("requires read permission before RPC",async()=>{
  mocks.permission.mockRejectedValueOnce(Error("permission denied"))
  await expect(fetchApplicationsPage()).rejects.toThrow("Could not load applications and their totals");expect(mocks.rpc).not.toHaveBeenCalled()
 })
})
