import {beforeEach,expect,it,vi} from "vitest"
const m=vi.hoisted(()=>({permission:vi.fn(),user:vi.fn(),rate:vi.fn(),caller:vi.fn(),rpc:vi.fn(),revalidate:vi.fn()}))
vi.mock("@/lib/auth/authorization",()=>({requirePermission:m.permission,getCurrentUser:m.user}))
vi.mock("@/lib/auth/rate-limit",()=>({rateLimitSettings:m.rate}))
vi.mock("@/lib/supabase/server",()=>({createClient:m.caller}))
vi.mock("next/cache",()=>({revalidatePath:m.revalidate}))
import {fetchCompanyProfile,fetchPayrollDefaults,updateCompanyProfile,updateSystemSettings,updateCompanyWpsSettings} from "./actions"
import {isSaudiIban} from "./schema"
beforeEach(()=>{vi.clearAllMocks();m.permission.mockResolvedValue(undefined);m.user.mockResolvedValue({id:"actor",tenantId:"tenant",authUserId:"auth"});m.rate.mockResolvedValue({success:true});m.caller.mockResolvedValue({rpc:m.rpc});m.rpc.mockResolvedValue({data:{configuration_version:8},error:null})})
const names={name_ar:"شركة اختبار",name_en:"Synthetic company"}
it("profile save preserves omitted logo and passes a caller-bound expected version",async()=>{
 expect(await updateCompanyProfile(names,7)).toEqual({success:true,configuration_version:8})
 expect(m.rpc).toHaveBeenCalledWith("save_my_settings",{p_surface:"company",p_payload:names,p_expected_version:7})
 expect(m.permission).toHaveBeenCalledWith("settings","manage")
 expect(m.rpc.mock.calls[0][1].p_payload).not.toHaveProperty("logo_url")
})
it("denies a valid update before any database client when permission is missing",async()=>{
 m.permission.mockRejectedValue(Object.assign(new Error("private permission internals"),{code:"AUTH007"}))
 expect(await updateCompanyProfile(names,7)).toMatchObject({success:false,code:"SETTINGS_FORBIDDEN"})
 expect(m.caller).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled()
})
it("a stale or absent version cannot start a save",async()=>{
 expect(await updateCompanyProfile(names,0)).toMatchObject({success:false,code:"SETTINGS_STALE"});expect(m.rpc).not.toHaveBeenCalled()
})
it("rate limiting prevents database mutation",async()=>{
 m.rate.mockResolvedValue({success:false});expect(await updateCompanyProfile(names,7)).toMatchObject({success:false,code:"SETTINGS_RATE_LIMIT"});expect(m.rpc).not.toHaveBeenCalled()
})
for(const patch of [{plan:"enterprise"},{vat_number:"000000000000000"},{cr_number:"PLACEHOLDER"},{country:null},{timezone:null},{default_locale:"fr"}])it("rejects invalid company fields without side effects: "+Object.keys(patch)[0],async()=>{
 expect(await updateCompanyProfile({...names,...patch} as Parameters<typeof updateCompanyProfile>[0],7)).toMatchObject({success:false,code:"SETTINGS_INVALID"});expect(m.rpc).not.toHaveBeenCalled()
})
for(const updates of [
 [{key:"payroll.default_working_days",value:"26"},{key:"security.max_failed_login_attempts",value:"999"}],
 [{key:"payroll.default_working_days",value:"26"},{key:"payroll.default_working_days",value:"27"}],
 [{key:"payroll.default_working_days",value:"26.5"}],[{key:"payroll.min_net_floor",value:"-1"}],
 [{key:"payroll.min_net_floor",value:"1e3"}],[{key:"payroll.min_net_floor",value:"1.001"}],
])it("rejects unknown, duplicate or invalid reference values as a whole",async()=>{
 expect(await updateSystemSettings(updates,7)).toMatchObject({success:false,code:"SETTINGS_INVALID"});expect(m.rpc).not.toHaveBeenCalled()
})
it("saves exact decimal reference values in one transaction",async()=>{
 expect(await updateSystemSettings([{key:"payroll.default_working_days",value:"26"},{key:"payroll.min_net_floor",value:"1700.25"}],7)).toMatchObject({success:true})
 expect(m.rpc).toHaveBeenCalledTimes(1);expect(m.rpc.mock.calls[0][1].p_payload).toEqual({"payroll.default_working_days":"26","payroll.min_net_floor":"1700.25"})
})
it("WPS identity requires a real checksum and saves both values together",async()=>{
 expect(isSaudiIban("SA0380000000608010167519")).toBe(true);expect(isSaudiIban("SA0380000000608010167510")).toBe(false)
 expect(await updateCompanyWpsSettings({molReference:"12345678",wpsIban:"SA0380000000608010167510"},7)).toMatchObject({success:false,code:"SETTINGS_INVALID"})
 expect(m.rpc).not.toHaveBeenCalled()
 expect(await updateCompanyWpsSettings({molReference:"12345678",wpsIban:"sa03 8000 0000 6080 1016 7519"},7)).toMatchObject({success:true})
 expect(m.rpc).toHaveBeenCalledWith("save_my_settings",{p_surface:"wps",p_payload:{"company.mol_reference":"12345678","company.wps_iban":"SA0380000000608010167519"},p_expected_version:7})
})
it("unknown commit outcome returns a safe review instruction without provider diagnostics",async()=>{
 m.rpc.mockResolvedValue({data:null,error:{message:"private schema diagnostics and credentials must never be echoed"}})
 const result=await updateCompanyProfile(names,7);expect(result.code).toBe("SETTINGS_UNAVAILABLE");expect(result.error).toContain("Reload and review");expect(result.error).not.toContain("private schema")
})
it("stale RPC result asks for reload rather than silently retrying another user's version",async()=>{
 m.rpc.mockResolvedValue({data:null,error:{message:"SETTINGS_STALE"}})
 expect(await updateCompanyProfile(names,7)).toMatchObject({success:false,code:"SETTINGS_STALE"});expect(m.rpc).toHaveBeenCalledTimes(1)
})
it("first-time payroll settings stay editable with empty values and a real version",async()=>{
 const bundle={configuration_version:4,can_manage:true,rows:[{id:"payroll.default_working_days",key:"payroll.default_working_days",value:"",is_public:false}]}
 m.rpc.mockResolvedValue({data:bundle,error:null});expect(await fetchPayrollDefaults()).toEqual(bundle)
 expect(m.rpc).toHaveBeenCalledWith("read_my_settings_bundle",{p_surface:"payroll"})
})
it("read failure is not a fabricated empty company",async()=>{
 m.rpc.mockResolvedValue({data:null,error:{message:"private provider error"}});await expect(fetchCompanyProfile()).rejects.toThrow("SETTINGS_UNAVAILABLE")
})
