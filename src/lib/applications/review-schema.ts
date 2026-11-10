import { z } from "zod"
export const APPLICATION_STATUSES=["submitted","under_review","approved","rejected","withdrawn"] as const
export const applicationReviewSchema=z.object({applicationId:z.uuid(),expectedVersion:z.number().int().positive(),action:z.enum(["under_review","approved","rejected","withdraw","archive","restore"]),reason:z.string().trim().min(5).max(500),surface:z.enum(["applications","approvals_inbox"]).default("applications")})
export function applicationReviewMessage(message:string){
 const code=/^[A-Z0-9_]+/.exec(message)?.[0]??""
 const messages:Record<string,[string,string]>={
  APP_STALE:["This application changed. Reload and review it before deciding.","تغير الطلب. أعد تحميله وراجعه قبل اتخاذ القرار."],
  APP002:["This application already has a final decision. Reload its current status.","يوجد قرار نهائي لهذا الطلب. أعد تحميل حالته الحالية."],
  APP001:["Application not found. Reload the list.","الطلب غير موجود. أعد تحميل القائمة."],
  APP_FORBIDDEN:["You do not have review permission, or MFA is required.","ليس لديك إذن المراجعة أو يلزم التحقق الثنائي."],
  APP_INPUT:["Choose an action and enter a reason of 5 to 500 characters.","اختر إجراءً وأدخل سبباً من 5 إلى 500 حرف."],
  APP_INVALID_TRANSITION:["This action is unavailable in the current application state. Reload the record.","هذا الإجراء غير متاح في حالة الطلب الحالية. أعد تحميل السجل."],
  APP_HISTORY_IMMUTABLE:["Final application history cannot be changed.","لا يمكن تغيير السجل النهائي للطلب."],
 }
 const text=messages[code]??["Unable to confirm the application action. Reload and review before retrying.","تعذر تأكيد إجراء الطلب. أعد تحميله وراجعه قبل المحاولة مجدداً."]
 return {error:text[0],errorAr:text[1],alreadyDecided:code==="APP002"}
}
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const applicationsPageSchema=z.object({rows:z.array(z.object({id:z.uuid(),application_number:z.string(),full_name:z.string(),mobile:z.string(),city:z.string().nullable(),work_type:z.enum(["full_time","freelancer"]),driver_category:z.string().nullable(),status:z.enum(APPLICATION_STATUSES),platform_codes:z.array(z.string()),submitted_at:z.iso.datetime({offset:true}),created_at:z.iso.datetime({offset:true}),workflow_version:count.positive(),archived_at:z.iso.datetime({offset:true}).nullable()})).max(100),summary:z.object({total:count,pending:count,approved:count,rejected:count,withdrawn:count}),total:count,page:count.positive(),pageSize:count.positive().max(100),totalPages:count.positive()})
export type ApplicationsPageData=z.infer<typeof applicationsPageSchema>
