import {beforeEach,describe,expect,it,vi} from "vitest"
const m=vi.hoisted(()=>({permission:vi.fn(),user:vi.fn(),rpc:vi.fn(),client:vi.fn(),admin:vi.fn(),audit:vi.fn(),revalidate:vi.fn()}))
vi.mock("@/lib/auth/authorization",()=>({requirePermission:m.permission,getCurrentUser:m.user}))
vi.mock("@/lib/supabase/server",()=>({createClient:m.client}))
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:m.admin}))
vi.mock("@/lib/auth/sessions",()=>({writeAuditLog:m.audit}))
vi.mock("next/cache",()=>({revalidatePath:m.revalidate}))
vi.mock("@/lib/auth/rate-limit",()=>({rateLimit:vi.fn(async()=>({success:true})),getClientIp:vi.fn(async()=>"127.0.0.1")}))
vi.mock("@/lib/auth/invite-tokens",()=>({hashInviteToken:vi.fn(async()=>"$2b$10$abcdefghijklmnopqrstuuJcJkQiQYst/G6KSlqzHKOHB.OBW2Pp5C"),verifyInviteToken:vi.fn()}))
import {createInvite} from "@/lib/auth/invites"
import {mutateUser,mutateRole,fetchSecurityRoster,fetchRoleManagement} from "./management"
import {fetchUsersPageData} from "./queries"
const id="13800000-0000-4000-8000-000000000013"
beforeEach(()=>{vi.clearAllMocks();m.permission.mockResolvedValue(undefined);m.user.mockResolvedValue({id:"actor",authUserId:"auth-owner",tenantId:"own",role:"general_manager"});m.client.mockResolvedValue({rpc:m.rpc});m.rpc.mockResolvedValue({data:{id,version:2},error:null});vi.stubGlobal("fetch",vi.fn(async()=>({ok:true})));vi.stubEnv("RESEND_API_KEY","");vi.stubEnv("RESEND_FROM_EMAIL","");vi.spyOn(console,"warn").mockImplementation(()=>{})})
describe("management action security boundary",()=>{
 it("routes profile changes through the caller RPC with observed version",async()=>{expect(await mutateUser("profile",id,4,{full_name_en:"Updated"})).toMatchObject({success:true,id});expect(m.rpc).toHaveBeenCalledWith("mutate_managed_user",{p_action:"profile",p_user_id:id,p_expected_version:4,p_input:{full_name_en:"Updated"}});expect(m.admin).not.toHaveBeenCalled()})
 it("refuses tenant or role injection into a profile patch",async()=>{expect((await mutateUser("profile",id,1,{full_name_en:"Updated",tenant_id:"foreign",role:"general_manager"})).success).toBe(false);expect(m.rpc).not.toHaveBeenCalled()})
 it("requires current version and permission before writes",async()=>{m.permission.mockRejectedValue(new Error("Denied"));expect((await mutateUser("profile",id,1,{full_name_en:"Updated"})).success).toBe(false);expect(m.rpc).not.toHaveBeenCalled()})
 it("does not trust a delegated users.update or users.manage grant for role changes",async()=>{m.user.mockResolvedValue({id:"admin",role:"admin"});expect((await mutateUser("role",id,1,{role:"supervisor",reason:"Forged role action"})).success).toBe(false);expect(m.rpc).not.toHaveBeenCalled()})
 it("does not allow GM role promotion or unrestricted role strings",async()=>{for(const role of ["general_manager","owner","custom_role"])expect((await mutateUser("role",id,1,{role,reason:"Promotion attempt"})).success).toBe(false);expect(m.rpc).not.toHaveBeenCalled()})
 it("returns a stale conflict without claiming success or revalidating",async()=>{m.rpc.mockResolvedValue({data:null,error:{message:"USR003: record changed; reload before saving"}});expect(await mutateUser("profile",id,1,{full_name_en:"Stale"})).toMatchObject({success:false,error:expect.stringContaining("USR003")});expect(m.revalidate).not.toHaveBeenCalled()})
 it("denies non-owner role catalog edits despite a permission stub granting access",async()=>{m.user.mockResolvedValue({role:"admin"});expect((await mutateRole("save",{name:"accountant",name_ar:"محاسب",name_en:"Accountant",permission_ids:[]})).success).toBe(false);expect(m.rpc).not.toHaveBeenCalled()})
 it("rejects unknown permission fields and fake system-role changes before SQL",async()=>{expect((await mutateRole("save",{name:"accountant",name_ar:"محاسب",name_en:"Accountant",permission_ids:[],is_system_role:false})).success).toBe(false);expect(m.rpc).not.toHaveBeenCalled()})
 it("propagates roster read failures instead of returning an empty dataset",async()=>{m.rpc.mockResolvedValue({data:null,error:{message:"provider failure"}});await expect(fetchUsersPageData()).rejects.toThrow("Could not load users");await expect(fetchSecurityRoster()).rejects.toThrow("Could not load security overview");await expect(fetchRoleManagement()).rejects.toThrow("Could not load roles")})
 it("passes paging and filters to server and preserves full aggregate counts",async()=>{m.rpc.mockResolvedValue({data:{users:[{id}],total:1005,page:11,pageSize:100,kpis:{total:1050}},error:null});expect(await fetchUsersPageData({page:11,pageSize:100,search:"needle",role:"supervisor",status:"active"})).toMatchObject({total:1005,kpis:{total:1050}});expect(m.rpc).toHaveBeenCalledWith("list_managed_users",{p_surface:"users",p_page:11,p_page_size:100,p_search:"needle",p_role:"supervisor",p_status:"active"})})
})
describe("invitation authority",()=>{
 it("rejects forged users.manage delegation before token issuance or database access",async()=>{m.user.mockResolvedValue({role:"admin"});expect((await createInvite("fixture@example.test","accountant")).success).toBe(false);expect(m.client).not.toHaveBeenCalled();expect(m.admin).not.toHaveBeenCalled()})
 it.each(["general_manager","owner","gm","unknown"])("rejects unsupported or privileged %s invitation",async(role)=>{expect((await createInvite("fixture@example.test",role)).success).toBe(false);expect(m.rpc).not.toHaveBeenCalled()})
 it("uses owner-bound issuance RPC with normalized identity and hashed token",async()=>{expect((await createInvite("Fixture@Example.Test","accountant")).success).toBe(true);const [name,args]=m.rpc.mock.calls[0];expect(name).toBe("issue_managed_invite");expect(args.p_email).toBe("fixture@example.test");expect(args.p_role).toBe("accountant");expect(args.p_token_hash.startsWith("$2b$")).toBe(true);expect(args).not.toHaveProperty("tenant_id");expect(args).not.toHaveProperty("token");expect(m.admin).not.toHaveBeenCalled()})
 it("does not send email when the active tenant preset check rejects issuance",async()=>{m.rpc.mockResolvedValue({data:null,error:{message:"USR030: select an active supported non-owner tenant role"}});expect((await createInvite("fixture@example.test","accountant")).success).toBe(false);expect(fetch).not.toHaveBeenCalled()})
})
