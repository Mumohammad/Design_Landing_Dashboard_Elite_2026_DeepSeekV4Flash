import {beforeEach,afterEach,expect,it,vi} from "vitest"
const m=vi.hoisted(()=>({user:vi.fn(),admin:vi.fn(),queries:[] as {table:string;select:string;eq:unknown[][]}[],tenant:{data:null,error:null} as {data:Record<string,unknown>|null;error:unknown},profile:{data:null,error:null} as {data:Record<string,unknown>|null;error:unknown}}))
vi.mock("server-only",()=>({}))
// React owns cache lifetime per request. Calls here represent separate requests.
vi.mock("react",()=>({cache:(fn:unknown)=>fn}))
vi.mock("@/lib/auth/authorization",()=>({getCurrentUser:m.user}))
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:m.admin}))
import {getWorkspaceBranding} from "./workspace"
const T="11111111-2222-3333-4444-555555555555",A="22222222-2222-3333-4444-555555555555",R="33333333-2222-3333-4444-555555555555"
beforeEach(()=>{
 vi.clearAllMocks();m.queries=[];vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","http://127.0.0.1:54321")
 m.user.mockResolvedValue({id:"own-profile",tenantId:T})
 m.tenant={data:{name_ar:"شركة",name_en:"Own company",logo_url:"https://evil.example/logo.png",logo_storage_path:null},error:null}
 m.profile={data:{full_name_ar:"مستخدم",full_name_en:"Own user",preferred_name:"Owner",email:"own@example.test",avatar_url:"https://evil.example/avatar.png"},error:null}
 m.admin.mockImplementation(()=>({from:(table:string)=>{
  const query={table,select:"",eq:[] as unknown[][]};m.queries.push(query)
  const chain={select:(columns:string)=>{query.select=columns;return chain},eq:(...args:unknown[])=>{query.eq.push(args);return chain},maybeSingle:async()=>table==="tenants"?m.tenant:m.profile};return chain
 },storage:{from:()=>({getPublicUrl:(path:string)=>({data:{publicUrl:`http://127.0.0.1:54321/storage/v1/object/public/company-assets/${path}`}})})}}))
})
afterEach(()=>vi.unstubAllEnvs())
it("fails closed before admin creation when current tenant/MFA authorization is absent",async()=>{
 m.user.mockResolvedValueOnce(null);expect(await getWorkspaceBranding()).toBeNull();expect(m.admin).not.toHaveBeenCalled()
 m.user.mockRejectedValueOnce(new Error("MFA needed"));expect(await getWorkspaceBranding()).toBeNull();expect(m.admin).not.toHaveBeenCalled()
})
it("scopes chrome reads to caller tenant and own profile and uses safe initials fallbacks",async()=>{
 expect(await getWorkspaceBranding()).toMatchObject({companyNameAr:"شركة",companyNameEn:"Own company",userName:"Owner",userEmail:"own@example.test",logoUrl:null,userAvatar:null})
 expect(m.queries).toEqual([{table:"tenants",select:"name_ar,name_en,logo_url,logo_storage_path",eq:[["id",T]]},{table:"users",select:"full_name_ar,full_name_en,preferred_name,email,avatar_url",eq:[["id","own-profile"],["tenant_id",T]]}])
})
it("derives managed image URLs through configured Storage and ignores cross-tenant paths",async()=>{
 m.tenant.data!.logo_storage_path=`${T}/logos/${A}/${R}/logo-0123456789abcdef.png`
 expect((await getWorkspaceBranding())?.logoUrl).toContain("http://127.0.0.1:54321/")
 m.tenant.data!.logo_storage_path=`${A}/logos/${A}/${R}/logo-0123456789abcdef.png`
 expect((await getWorkspaceBranding())?.logoUrl).toBeNull()
})
it("separate callers never inherit prior tenant/profile predicates",async()=>{
 await getWorkspaceBranding();m.user.mockResolvedValue({id:"other-profile",tenantId:A});m.tenant.data={name_ar:"أخرى",name_en:"Other company"};m.profile.data=null
 expect(await getWorkspaceBranding()).toMatchObject({companyNameEn:"Other company",userName:"",userEmail:""})
 expect(m.queries[2].eq).toEqual([["id",A]]);expect(m.queries[3].eq).toEqual([["id","other-profile"],["tenant_id",A]])
})
it("tenant failures yield neutral chrome and profile failures yield neutral identity",async()=>{
 m.tenant.error={message:"private"};expect(await getWorkspaceBranding()).toBeNull()
 m.tenant.error=null;m.profile.error={message:"private"};expect(await getWorkspaceBranding()).toMatchObject({userName:"",userEmail:"",userAvatar:null})
})
