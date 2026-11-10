"use server"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { rateLimitSettings } from "@/lib/auth/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { writeAuditLog } from "@/lib/auth/sessions"
import { LogoValidationError, clearTenantLogo, storeTenantLogo } from "@/lib/branding/logo"
import { decodeLogoPayload } from "@/lib/branding/logo-core"
import { companySettingsSchema,payrollSettingsSchema,wpsSettingsSchema,settingsMessage,type SettingsCode } from "./schema"

export type SettingsActionResult={success:boolean;error?:string;code?:SettingsCode;configuration_version?:number}
type ActionResult=SettingsActionResult
export type CompanyProfile={id:string;name_ar:string;name_en:string;legal_name:string|null;cr_number:string|null;vat_number:string|null;address:string|null;city:string|null;region:string|null;building_number:string|null;additional_number:string|null;district:string|null;postal_code:string|null;country:string|null;phone:string|null;email:string|null;logo_url:string|null;timezone:string|null;default_locale:string|null;mol_reference:string;wps_iban:string;configuration_version:number;can_manage:boolean}
export type CompanyProfileInput={name_ar:string;name_en:string;legal_name?:string|null;cr_number?:string|null;vat_number?:string|null;address?:string|null;city?:string|null;region?:string|null;building_number?:string|null;additional_number?:string|null;district?:string|null;postal_code?:string|null;country?:string;phone?:string|null;email?:string|null;logo_url?:string|null;timezone?:string;default_locale?:string}
export type PayrollSetting={id:string;key:string;value:string;is_public:boolean}
export type PayrollDefaults={rows:PayrollSetting[];configuration_version:number;can_manage:boolean}
function errorMessage(e:unknown):string{return e instanceof Error?e.message:"Unknown error"}
// Logo writes bump tenants.configuration_version (trigger); return the new
// version so the open settings form does not go stale.
async function tenantVersion(admin:ReturnType<typeof createAdminClient>,tenantId:string):Promise<number|undefined>{
 const{data}=await admin.from("tenants").select("configuration_version").eq("id",tenantId).maybeSingle<{configuration_version:number}>()
 return Number.isSafeInteger(data?.configuration_version)?data!.configuration_version:undefined
}
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
  if(!Number.isSafeInteger(data?.configuration_version))return failure("SETTINGS_UNAVAILABLE")
  revalidatePath("/settings/company");revalidatePath("/settings/payroll-defaults")
  return{success:true,configuration_version:data.configuration_version}
 }catch(error){return failure(classify(error))}
}
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

// ─── Company logo ───────────────────────────────────────────────────────
// The logo is managed separately from the profile form (saving the profile
// never touches logo_url). Upload payload is a PNG/JPEG/WebP data URL; the
// server re-validates by magic bytes and re-encodes it to PNG.

export async function uploadCompanyLogo(
  payload: string
): Promise<ActionResult & { logoUrl?: string }> {
  try {
    await requirePermission("settings", "manage")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitSettings(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const bytes = decodeLogoPayload(payload)
    if (!bytes) return { success: false, error: "Logo must be a PNG, JPEG, or WebP image up to 2 MB." }

    const admin = createAdminClient()
    const logoUrl = await storeTenantLogo(admin, currentUser.tenantId, bytes)
    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "settings",
      action: "updated",
      entityType: "tenant",
      entityId: currentUser.tenantId,
      newValues: { logo_url: logoUrl },
    })
    revalidatePath("/settings/company")
    revalidatePath("/", "layout")
    return { success: true, logoUrl, configuration_version: await tenantVersion(admin, currentUser.tenantId) }
  } catch (e) {
    if (e instanceof LogoValidationError) return { success: false, error: e.message }
    return { success: false, error: errorMessage(e) }
  }
}

export async function removeCompanyLogo(): Promise<ActionResult> {
  try {
    await requirePermission("settings", "manage")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitSettings(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()
    await clearTenantLogo(admin, currentUser.tenantId)
    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "settings",
      action: "updated",
      entityType: "tenant",
      entityId: currentUser.tenantId,
      newValues: { logo_url: null },
    })
    revalidatePath("/settings/company")
    revalidatePath("/", "layout")
    return { success: true, configuration_version: await tenantVersion(admin, currentUser.tenantId) }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
