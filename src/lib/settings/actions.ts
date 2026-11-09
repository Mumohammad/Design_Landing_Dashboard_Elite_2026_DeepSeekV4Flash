"use server"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { rateLimitSettings } from "@/lib/auth/rate-limit"
import { normalizeLogo, stageTenantLogo, LogoValidationError } from "@/lib/branding/logo"
import { COMPANY_ASSETS_BUCKET, UUID_PATTERN, decodeLogoPayload, validTenantLogoPath } from "@/lib/branding/logo-core"
import { companySettingsSchema,payrollSettingsSchema,wpsSettingsSchema,settingsMessage,type SettingsCode } from "./schema"

export type SettingsActionResult={success:boolean;error?:string;code?:SettingsCode;configuration_version?:number;logo_url?:string|null;logo_storage_path?:string|null;replayed?:boolean;request_id?:string}
type ActionResult=SettingsActionResult
export type CompanyProfile={id:string;name_ar:string;name_en:string;legal_name:string|null;cr_number:string|null;vat_number:string|null;address:string|null;city:string|null;region:string|null;building_number:string|null;additional_number:string|null;district:string|null;postal_code:string|null;country:string|null;phone:string|null;email:string|null;logo_url:string|null;logo_storage_path?:string|null;timezone:string|null;default_locale:string|null;mol_reference:string;wps_iban:string;configuration_version:number;can_manage:boolean}
export type CompanyProfileInput={name_ar:string;name_en:string;legal_name?:string|null;cr_number?:string|null;vat_number?:string|null;address?:string|null;city?:string|null;region?:string|null;building_number?:string|null;additional_number?:string|null;district?:string|null;postal_code?:string|null;country?:string;phone?:string|null;email?:string|null;timezone?:string;default_locale?:string}
export type PayrollSetting={id:string;key:string;value:string;is_public:boolean}
export type PayrollDefaults={rows:PayrollSetting[];configuration_version:number;can_manage:boolean}
function failure(code:SettingsCode):ActionResult{return{success:false,code,error:settingsMessage(code,"en")}}
function classify(error:unknown):SettingsCode {
 const value=error&&typeof error==="object"&&"message"in error?String(error.message):""
 if(value==="SETTINGS_INVALID"||value==="SETTINGS_STALE"||value==="SETTINGS_FORBIDDEN")return value
 if(error&&typeof error==="object"&&"code"in error){if(error.code==="AUTH007")return"SETTINGS_FORBIDDEN";if(error.code==="23505")return"SETTINGS_INVALID"}
 return"SETTINGS_UNAVAILABLE"
}
export async function fetchCompanyProfile():Promise<CompanyProfile|null>{
 await requirePermission("settings","read")
 if(!await getCurrentUser())return null
 const caller=await createClient();const {data,error}=await caller.rpc("read_my_settings_bundle",{p_surface:"company"})
 if(error||!data||!Number.isSafeInteger(data.configuration_version))throw new Error("SETTINGS_UNAVAILABLE")
 if(data.logo_storage_path!=null){data.logo_url=validTenantLogoPath(data.logo_storage_path,data.id)?caller.storage.from(COMPANY_ASSETS_BUCKET).getPublicUrl(data.logo_storage_path).data.publicUrl:null}
 return data as CompanyProfile
}
export async function fetchPayrollDefaults():Promise<PayrollDefaults>{
 await requirePermission("settings","read")
 if(!await getCurrentUser())throw new Error("SETTINGS_FORBIDDEN")
 const caller=await createClient();const{data,error}=await caller.rpc("read_my_settings_bundle",{p_surface:"payroll"})
 if(error||!Array.isArray(data?.rows)||!Number.isSafeInteger(data.configuration_version))throw new Error("SETTINGS_UNAVAILABLE")
 return data as PayrollDefaults
}
async function save(surface:"company"|"payroll"|"wps",payload:unknown,version:number):Promise<ActionResult>{
 try{
  await requirePermission("settings","manage")
  const user=await getCurrentUser();if(!user)return failure("SETTINGS_FORBIDDEN")
  if(!Number.isSafeInteger(version)||version<1)return failure("SETTINGS_STALE")
  const limit=await rateLimitSettings(user.id);if(!limit.success)return failure("SETTINGS_RATE_LIMIT")
  const caller=await createClient();const{data,error}=await caller.rpc("save_my_settings",{p_surface:surface,p_payload:payload,p_expected_version:version})
  if(error)return failure(classify(error))
  if((!Number.isSafeInteger(data?.configuration_version)||data.configuration_version!==version+1))return failure("SETTINGS_UNAVAILABLE")
  refreshSettings()
  return{success:true,configuration_version:data.configuration_version}
 }catch(error){return failure(classify(error))}
}
function refreshSettings(){try{revalidatePath("/settings/company");revalidatePath("/settings/payroll-defaults");revalidatePath("/","layout")}catch{/* The confirmed commit remains successful if cache invalidation fails. */}}
async function mutateLogo(payload:string|null,version:number,requestId:string):Promise<ActionResult>{
 try{
  await requirePermission("settings","manage")
  const user=await getCurrentUser();if(!user)return failure("SETTINGS_FORBIDDEN")
  if(!Number.isSafeInteger(version)||version<1)return failure("SETTINGS_STALE")
  if(typeof requestId!=="string"||!UUID_PATTERN.test(requestId))return failure("SETTINGS_INVALID")
  const limit=await rateLimitSettings(user.id);if(!limit.success)return failure("SETTINGS_RATE_LIMIT")
  const bytes=payload===null?null:decodeLogoPayload(payload)
  if(payload!==null&&!bytes)return failure("SETTINGS_INVALID")
  const png=bytes?await normalizeLogo(bytes):null
  const caller=await createClient()
  const path=png?await stageTenantLogo(caller,user.tenantId,user.authUserId,requestId,png):null
  const {data,error}=await caller.rpc("save_my_company_logo",{p_request_id:requestId,p_expected_version:version,p_object_path:path})
  if(error)return failure(classify(error))
  if(!data||data.request_id!==requestId||data.operation!==(path===null?"clear":"attach")||data.object_path!==path||typeof data.replayed!=="boolean"||!Number.isSafeInteger(data.configuration_version)||data.configuration_version!==version+1)return failure("SETTINGS_UNAVAILABLE")
  const logoUrl=path?caller.storage.from(COMPANY_ASSETS_BUCKET).getPublicUrl(path).data.publicUrl:null
  refreshSettings()
  return{success:true,configuration_version:data.configuration_version,logo_url:logoUrl,logo_storage_path:path,replayed:data.replayed,request_id:requestId}
 }catch(error){return failure(error instanceof LogoValidationError?"SETTINGS_INVALID":classify(error))}
}
export async function uploadCompanyLogo(payload:string,expectedVersion:number,requestId:string):Promise<ActionResult>{return mutateLogo(payload,expectedVersion,requestId)}
export async function removeCompanyLogo(expectedVersion:number,requestId:string):Promise<ActionResult>{return mutateLogo(null,expectedVersion,requestId)}
export async function updateCompanyProfile(input:CompanyProfileInput,expectedVersion:number):Promise<ActionResult>{
 const result=companySettingsSchema.safeParse(input);if(!result.success)return failure("SETTINGS_INVALID")
 return save("company",result.data,expectedVersion)
}
export async function updateSystemSettings(updates:{key:string;value:string}[],expectedVersion:number):Promise<ActionResult>{
 const result=payrollSettingsSchema.safeParse(updates);if(!result.success)return failure("SETTINGS_INVALID")
 return save("payroll",Object.fromEntries(result.data.map(row=>[row.key,row.value])),expectedVersion)
}
export async function updateCompanyWpsSettings(input:{molReference:string;wpsIban:string},expectedVersion:number):Promise<ActionResult>{
 const result=wpsSettingsSchema.safeParse(input);if(!result.success)return failure("SETTINGS_INVALID")
 return save("wps",{"company.mol_reference":result.data.molReference,"company.wps_iban":result.data.wpsIban},expectedVersion)
}
