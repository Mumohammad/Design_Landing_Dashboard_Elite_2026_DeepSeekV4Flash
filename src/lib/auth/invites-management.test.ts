import {beforeEach,afterEach,expect,it,vi} from "vitest"
const m=vi.hoisted(()=>({permission:vi.fn(),user:vi.fn(),caller:vi.fn(),rpc:vi.fn(),admin:vi.fn()}))
vi.mock("@/lib/auth/authorization",()=>({requirePermission:m.permission,getCurrentUser:m.user}))
vi.mock("@/lib/supabase/server",()=>({createClient:m.caller}))
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:m.admin}))
vi.mock("@/lib/auth/rate-limit",()=>({rateLimit:vi.fn(),getClientIp:vi.fn()}))
vi.mock("@/lib/auth/invite-tokens",()=>({hashInviteToken:vi.fn(async()=>"opaque-hash"),verifyInviteToken:vi.fn()}))
import {createInvite,revokeInvite} from "./invites"
const id="44000000-0000-4000-8000-000000000001"
beforeEach(()=>{vi.clearAllMocks();m.permission.mockResolvedValue(undefined);m.user.mockResolvedValue({role:"general_manager",authUserId:"owner",tenantId:"tenant"});m.caller.mockResolvedValue({rpc:m.rpc});m.rpc.mockResolvedValue({data:{id},error:null});m.admin.mockImplementation(()=>{throw Error("Unexpected service-role path")});vi.stubEnv("RESEND_API_KEY",undefined)})
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks()})
it("delegated user managers cannot issue invitations",async()=>{m.user.mockResolvedValue({role:"admin"});expect((await createInvite("fixture@example.test","accountant")).success).toBe(false);expect(m.rpc).not.toHaveBeenCalled()})
it("the owner cannot invite a new general manager",async()=>{expect((await createInvite("fixture@example.test","general_manager")).success).toBe(false);expect(m.rpc).not.toHaveBeenCalled()})
it("records a valid invitation through the caller and reports missing delivery truthfully",async()=>{expect(await createInvite("fixture@example.test","accountant")).toEqual({success:true,delivery:"unavailable"});expect(m.rpc).toHaveBeenCalledWith("issue_managed_invite",expect.objectContaining({p_email:"fixture@example.test",p_role:"accountant",p_token_hash:"opaque-hash"}));expect(m.admin).not.toHaveBeenCalled()})
it("denies revocation before a database client on permission failure",async()=>{m.permission.mockRejectedValue(Error("private auth detail"));const r=await revokeInvite(id);expect(r.success).toBe(false);expect(r.error).not.toContain("private");expect(m.caller).not.toHaveBeenCalled()})
it("denies delegated and malformed revocation requests",async()=>{m.user.mockResolvedValue({role:"admin"});expect((await revokeInvite(id)).success).toBe(false);m.user.mockResolvedValue({role:"general_manager"});expect((await revokeInvite("invalid")).success).toBe(false);expect(m.rpc).not.toHaveBeenCalled()})
it("revokes via one caller transaction without service-role updates or a separate audit",async()=>{expect(await revokeInvite(id)).toEqual({success:true});expect(m.rpc).toHaveBeenCalledWith("revoke_managed_invite",{p_id:id});expect(m.admin).not.toHaveBeenCalled()})
it("does not report a consumed or uncertain revocation as successful",async()=>{m.rpc.mockResolvedValue({data:null,error:{message:"private provider diagnostic"}});const r=await revokeInvite(id);expect(r.success).toBe(false);expect(r.error).not.toContain("private");expect(r.errorAr).toBeTruthy();m.rpc.mockResolvedValue({data:null,error:null});expect((await revokeInvite(id)).success).toBe(false)})

it("only reports queued mail after a valid provider acknowledgement and uses a trusted bilingual link",async()=>{
 vi.stubEnv("RESEND_API_KEY","fixture-not-a-secret");vi.stubEnv("RESEND_FROM_EMAIL","no-reply@example.test");vi.stubEnv("NEXT_PUBLIC_APP_URL","https://dashboard.example.test")
 const send=vi.fn<(url:string,options:RequestInit)=>Promise<Response>>().mockResolvedValue(new Response(JSON.stringify({id}),{status:200,headers:{"content-type":"application/json"}}));vi.stubGlobal("fetch",send)
 expect(await createInvite("fixture@example.test","accountant")).toEqual({success:true,delivery:"queued"})
 const body=JSON.parse(send.mock.calls[0][1].body as string)
 expect(body.html).toContain('https://dashboard.example.test/auth/accept-invite?tid=');expect(body.html).toContain('lang="ar"');expect(body.subject).toContain("Invitation")
})
it("does not claim an ambiguous provider success sent or delivered an email",async()=>{
 vi.stubEnv("RESEND_API_KEY","fixture-not-a-secret");vi.stubEnv("RESEND_FROM_EMAIL","no-reply@example.test");vi.stubEnv("NEXT_PUBLIC_APP_URL","https://dashboard.example.test")
 vi.spyOn(console,"error").mockImplementation(()=>{})
 vi.stubGlobal("fetch",vi.fn(async()=>new Response('{}',{status:200})))
 expect(await createInvite("fixture@example.test","accountant")).toEqual({success:true,delivery:"unavailable"})
})
