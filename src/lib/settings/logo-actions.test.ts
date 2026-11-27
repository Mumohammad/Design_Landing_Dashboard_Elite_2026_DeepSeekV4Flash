import {beforeEach,expect,it,vi} from "vitest"
const m=vi.hoisted(()=>({permission:vi.fn(),user:vi.fn(),rate:vi.fn(),caller:vi.fn(),rpc:vi.fn(),normalize:vi.fn(),stage:vi.fn(),revalidate:vi.fn(),url:vi.fn()}))
vi.mock("@/lib/auth/authorization",()=>({requirePermission:m.permission,getCurrentUser:m.user}))
vi.mock("@/lib/auth/rate-limit",()=>({rateLimitSettings:m.rate}))
vi.mock("@/lib/supabase/server",()=>({createClient:m.caller}))
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>{throw new Error("admin must not be used")}}))
vi.mock("next/cache",()=>({revalidatePath:m.revalidate}))
vi.mock("@/lib/branding/logo",()=>({normalizeLogo:m.normalize,stageTenantLogo:m.stage,LogoValidationError:class extends Error{}}))
import {uploadCompanyLogo,removeCompanyLogo,fetchCompanyProfile,updateCompanyProfile} from "./actions"
const tenant="11111111-2222-3333-4444-555555555555",actor="22222222-2222-3333-4444-555555555555",request="33333333-2222-3333-4444-555555555555"
const path=`${tenant}/logos/${actor}/${request}/logo-0123456789abcdef.png`
const payload="data:image/png;base64,iVBORw0KGgo="
beforeEach(()=>{
 vi.clearAllMocks();m.permission.mockResolvedValue(undefined);m.user.mockResolvedValue({id:"profile",tenantId:tenant,authUserId:actor});m.rate.mockResolvedValue({success:true});m.normalize.mockResolvedValue(Buffer.from("normalized"));m.stage.mockResolvedValue(path)
 m.url.mockImplementation((p:string)=>({data:{publicUrl:`http://127.0.0.1:54321/storage/v1/object/public/company-assets/${p}`}}))
 m.caller.mockResolvedValue({rpc:m.rpc,storage:{from:()=>({getPublicUrl:m.url})}})
 m.rpc.mockImplementation(async(_name,args)=>({data:{request_id:args.p_request_id,operation:args.p_object_path===null?"clear":"attach",object_path:args.p_object_path,configuration_version:8,replayed:false},error:null}))
})
it("stages using the caller auth identity then commits only narrow versioned logo details",async()=>{
 const result=await uploadCompanyLogo(payload,7,request)
 expect(m.stage).toHaveBeenCalledWith(await m.caller.mock.results[0].value,tenant,actor,request,Buffer.from("normalized"))
 expect(m.rpc).toHaveBeenCalledWith("save_my_company_logo",{p_request_id:request,p_expected_version:7,p_object_path:path})
 expect(result).toMatchObject({success:true,configuration_version:8,logo_storage_path:path,request_id:request,replayed:false})
 expect(result.logo_url).toContain("http://127.0.0.1:54321/")
})
it("clear uses the same caller/version transaction without uploading or deleting objects",async()=>{
 expect(await removeCompanyLogo(7,request)).toMatchObject({success:true,logo_url:null,logo_storage_path:null,configuration_version:8})
 expect(m.stage).not.toHaveBeenCalled();expect(m.normalize).not.toHaveBeenCalled()
 expect(m.rpc).toHaveBeenCalledWith("save_my_company_logo",{p_request_id:request,p_expected_version:7,p_object_path:null})
})
for(const guard of ["permission","user","rate"] as const)it(`fails before image/storage work when ${guard} is unavailable`,async()=>{
 if(guard==="permission")m.permission.mockRejectedValue(Object.assign(new Error("private"),{code:"AUTH007"}))
 if(guard==="user")m.user.mockResolvedValue(null)
 if(guard==="rate")m.rate.mockResolvedValue({success:false})
 expect((await uploadCompanyLogo(payload,7,request)).success).toBe(false)
 expect(m.normalize).not.toHaveBeenCalled();expect(m.stage).not.toHaveBeenCalled();expect(m.caller).not.toHaveBeenCalled()
})
for(const [version,id,body] of [[0,request,payload],[7,"bad",payload],[7,request,"A".repeat(700001)],[7,request,"data:image/png;base64,%%%"]] as const)it("rejects missing version, bad operation identity or oversized/malformed image before storage",async()=>{
 expect((await uploadCompanyLogo(body,version,id)).success).toBe(false);expect(m.stage).not.toHaveBeenCalled();expect(m.caller).not.toHaveBeenCalled()
})
for(const data of [null,{configuration_version:8},{request_id:request,operation:"attach",object_path:"foreign",configuration_version:8,replayed:false},{request_id:request,operation:"attach",object_path:path,configuration_version:7,replayed:false}])it("never confirms incomplete, mismatching or nonadvancing receipts",async()=>{
 m.rpc.mockResolvedValue({data,error:null});expect(await uploadCompanyLogo(payload,7,request)).toMatchObject({success:false,code:"SETTINGS_UNAVAILABLE"})
 expect(m.stage).toHaveBeenCalledTimes(1);expect(m.revalidate).not.toHaveBeenCalled()
})
it("returns safe stale/unknown results without compensating deletion or retry",async()=>{
 m.rpc.mockResolvedValueOnce({data:null,error:{message:"SETTINGS_STALE"}}).mockRejectedValueOnce(new Error("private transport"))
 expect(await uploadCompanyLogo(payload,7,request)).toMatchObject({success:false,code:"SETTINGS_STALE"})
 const unknown=await removeCompanyLogo(7,request);expect(unknown).toMatchObject({success:false,code:"SETTINGS_UNAVAILABLE"});expect(unknown.error).not.toContain("private")
 expect(m.rpc).toHaveBeenCalledTimes(2)
})
it("preserves confirmed receipts when cache invalidation fails and labels historical replay",async()=>{
 m.rpc.mockResolvedValue({data:{request_id:request,operation:"clear",object_path:null,configuration_version:8,replayed:true},error:null});m.revalidate.mockImplementation(()=>{throw new Error("cache")})
 expect(await removeCompanyLogo(7,request)).toMatchObject({success:true,replayed:true,configuration_version:8})
})
it("derives a managed logo URL from configured Storage and rejects profile reference edits",async()=>{
 m.rpc.mockResolvedValue({data:{id:tenant,configuration_version:8,logo_url:"https://evil.test/logo",logo_storage_path:path},error:null})
 expect((await fetchCompanyProfile())?.logo_url).toContain("127.0.0.1:54321")
 m.rpc.mockClear()
 expect(await updateCompanyProfile({name_ar:"شركة",name_en:"Company",logo_url:"https://evil.test"} as Parameters<typeof updateCompanyProfile>[0],8)).toMatchObject({success:false,code:"SETTINGS_INVALID"});expect(m.rpc).not.toHaveBeenCalled()
})
