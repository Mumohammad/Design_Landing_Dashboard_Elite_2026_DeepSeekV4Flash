import "server-only"
import {z} from "zod"
import {revalidatePath} from "next/cache"
import {createClient} from "@/lib/supabase/server"
import {getCurrentUser,requirePermission} from "@/lib/auth/authorization"
import {rateLimitDrivers} from "@/lib/auth/rate-limit"
export type EvidenceAction="document_register"|"document_verify"|"document_remove"|"override_create"|"override_revoke"|"card_issue"|"card_revoke"|"card_print"|"photo_update"|"photo_remove"|"recompute"
export type EvidenceResult={ok:true;id:string;driverId:string;profileVersion:number;version:number|null;serial?:string;status?:string;summary?:{level:string;score:number;blockers:number;missing:number;pending:number;warnings:number}}|{ok:false;error:string;errorAr:string}
const messages:Record<string,[string,string]>={
 EVIDENCE_FORBIDDEN:["You do not have permission, or additional authentication is required.","ليس لديك الصلاحية أو يلزم إكمال التحقق من الهوية."],
 EVIDENCE_STALE:["This driver or evidence changed. Reload and review it before saving.","تغير ملف السائق أو المستند. أعد تحميله وراجعه قبل الحفظ."],
 EVIDENCE_NOT_FOUND:["Driver or evidence not found in this organization.","لم يتم العثور على السائق أو المستند في هذه المنشأة."],
 EVIDENCE_NOT_CURRENT:["This evidence is no longer current. Reload its status before continuing.","لم يعد هذا السجل سارياً. أعد تحميل حالته قبل المتابعة."],
 EVIDENCE_ALREADY_CURRENT:["A current record already exists. Reload before continuing.","يوجد سجل سارٍ بالفعل. أعد التحميل قبل المتابعة."],
 EVIDENCE_OBJECT_REQUIRED:["Use a newly uploaded file belonging to this driver with an allowed type and size.","استخدم ملفاً مرفوعاً حديثاً لهذا السائق بالنوع والحجم المسموحين."],
 EVIDENCE_OBJECT_REGISTERED:["This file is already registered. Reload the current evidence.","هذا الملف مسجل بالفعل. أعد تحميل المستندات الحالية."],
 EVIDENCE_REVIEW_REQUIRED:["Review the current missing or expired requirement before approving an override.","راجع المتطلب الحالي المفقود أو المنتهي قبل اعتماد التجاوز."],
 EVIDENCE_HISTORY_REVIEW:["Existing duplicate records require a reviewed correction before continuing.","تتطلب السجلات المكررة الحالية تصحيحاً معتمداً قبل المتابعة."],
 EVIDENCE_DRIVER_INACTIVE:["Cards can be issued or printed only for an active driver or a driver on leave.","يمكن إصدار البطاقة أو طباعتها للسائق النشط أو الموجود في إجازة فقط."],
 EVIDENCE_INPUT:["Check the evidence details and reload its current version.","تحقق من بيانات السجل وأعد تحميل نسخته الحالية."],
}
export function evidenceFailure(code:string):EvidenceResult{const key=/^[A-Z0-9_]+/.exec(code)?.[0]??"";const text=messages[key]??["The evidence change could not be confirmed. Reload before retrying; uploaded files are retained.","تعذر تأكيد التغيير. أعد التحميل قبل المحاولة مجدداً؛ تُحفظ الملفات المرفوعة."];return{ok:false,error:text[0],errorAr:text[1]}}
const count=z.number().int().nonnegative()
const summary=z.object({level:z.enum(["fully_compliant","compliant_warnings","pending_review","non_compliant","critical_block","suspended"]),score:count.max(100),blockers:count,missing:count,pending:count,warnings:count})
const receipt=z.object({id:z.uuid(),driver_id:z.uuid(),profile_version:z.number().int().positive(),version:z.number().int().positive().nullable(),serial:z.string().nullable(),status:z.string().nullable(),summary:summary})
export async function callDriverEvidence(action:EvidenceAction,value:{driverId:string;expectedDriverVersion:number;id?:string;expectedVersion?:number;input?:Record<string,unknown>}):Promise<EvidenceResult>{
 try{await requirePermission("drivers",["document_verify","override_create","override_revoke","card_revoke"].includes(action)?"approve":action==="card_print"?"print":"update")}catch{return evidenceFailure("EVIDENCE_FORBIDDEN")}
 try{
  const me=await getCurrentUser();if(!me)return evidenceFailure("EVIDENCE_FORBIDDEN")
  if(!(await rateLimitDrivers("evidence:"+me.authUserId)).success)return{ok:false,error:"Too many evidence actions. Wait and try again.",errorAr:"تجاوزت عدد الإجراءات المسموح. انتظر وحاول مجدداً."}
  const caller=await createClient(),response=await caller.rpc("mutate_driver_evidence",{p_action:action,p_driver_id:value.driverId,p_driver_version:value.expectedDriverVersion,p_input:value.input??{},p_id:value.id??null,p_expected_version:value.expectedVersion??null})
  if(response.error)return evidenceFailure(response.error.message??"")
  const saved=receipt.safeParse(response.data)
  if(!saved.success||saved.data.driver_id!==value.driverId||(value.id&&saved.data.id!==value.id)||saved.data.profile_version<=value.expectedDriverVersion||(value.expectedVersion!==undefined&&saved.data.version!==value.expectedVersion+1))return evidenceFailure("unknown")
  const cardAction=["card_issue","card_revoke","card_print"].includes(action)
  if((cardAction&&(!saved.data.serial||saved.data.status!==(action==="card_revoke"?"revoked":"active")))||(["document_register","override_create","card_issue"].includes(action)&&saved.data.version!==1)||(["photo_update","photo_remove","recompute"].includes(action)&&saved.data.version!==null))return evidenceFailure("unknown")
  try{revalidatePath("/drivers/"+value.driverId);revalidatePath("/drivers")}catch{/* The database transaction already committed. */}
  return{ok:true,id:saved.data.id,driverId:saved.data.driver_id,profileVersion:saved.data.profile_version,version:saved.data.version,...(saved.data.serial?{serial:saved.data.serial}:{}),...(saved.data.status?{status:saved.data.status}:{}),summary:saved.data.summary}
 }catch{return evidenceFailure("unknown")}
}
