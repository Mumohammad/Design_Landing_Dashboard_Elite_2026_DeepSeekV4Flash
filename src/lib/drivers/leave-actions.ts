"use server"
import {z} from "zod"
import {revalidatePath} from "next/cache"
import {createClient} from "@/lib/supabase/server"
import {getCurrentUser,requirePermission} from "@/lib/auth/authorization"
import {rateLimitDrivers} from "@/lib/auth/rate-limit"
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{try{return new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value}catch{return false}})
const schema=z.object({action:z.enum(["create","edit","cancel","restore","approved","rejected"]),requestId:z.uuid().optional(),expectedVersion:z.number().int().positive().optional(),driverId:z.uuid().optional(),clientRequestId:z.uuid().optional(),leaveTypeId:z.uuid().optional(),startDate:date.optional(),endDate:date.optional(),reason:z.string().trim().min(5).max(500),surface:z.enum(["driver_profile","approvals_inbox"]).default("driver_profile")}).strict().superRefine((v,ctx)=>{
 const create=v.action==="create",dates=create||v.action==="edit"
 if(create?(!v.driverId||!v.clientRequestId||v.requestId!==undefined||v.expectedVersion!==undefined):(!v.requestId||!v.expectedVersion||v.driverId!==undefined||v.clientRequestId!==undefined))ctx.addIssue({code:"custom",message:"Invalid request identity"})
 if(dates?(!v.leaveTypeId||!v.startDate||!v.endDate||v.endDate<v.startDate):(v.leaveTypeId!==undefined||v.startDate!==undefined||v.endDate!==undefined))ctx.addIssue({code:"custom",message:"Invalid leave dates"})
})
export type LeaveActionResult={success:boolean;id?:string;driverId?:string;version?:number;status?:string;error?:string;errorAr?:string;alreadyDecided?:boolean}
const messages:Record<string,[string,string]>={
 LEAVE_STALE:["This request changed. Reload and review it before saving.","تغير الطلب. أعد تحميله وراجعه قبل الحفظ."],
 LEAVE_ALREADY_DECIDED:["This request is no longer pending. Reload its current status.","لم يعد الطلب قيد الانتظار. أعد تحميل حالته الحالية."],
 LEAVE_OVERLAP:["These dates overlap another pending or approved leave request.","تتداخل هذه التواريخ مع طلب إجازة آخر قيد الانتظار أو معتمد."],
 LEAVE_POLICY_REVIEW:["The request does not satisfy the configured leave policy. Review the dates and balance with HR.","لا يستوفي الطلب سياسة الإجازات المحددة. راجع التواريخ والرصيد مع الموارد البشرية."],
 LVE001:["The request does not satisfy the configured leave policy. Review the dates and balance with HR.","لا يستوفي الطلب سياسة الإجازات المحددة. راجع التواريخ والرصيد مع الموارد البشرية."],
 LEAVE_DATES:["Check the date range, employment dates and requested days.","تحقق من فترة الإجازة وتواريخ التوظيف وعدد الأيام المطلوبة."],
 LEAVE_TYPE_REQUIRED:["Choose an active leave type belonging to this organization.","اختر نوع إجازة سارياً تابعاً لهذه المنشأة."],
 LEAVE_DRIVER_INACTIVE:["Leave cannot be saved for a driver who is not active or on leave.","لا يمكن حفظ الإجازة لسائق غير نشط أو ليس في إجازة."],
 LEAVE_FORBIDDEN:["You do not have permission, or additional authentication is required.","ليس لديك الصلاحية أو يلزم إكمال التحقق من الهوية."],
 LEAVE_INPUT:["Check the request, dates and a reason of 5 to 500 characters.","تحقق من الطلب والتواريخ وأدخل سبباً من 5 إلى 500 حرف."],
}
function failure(code:string):LeaveActionResult{const key=/^[A-Z0-9_]+/.exec(code)?.[0]??"";const text=messages[key]??["The leave action could not be confirmed. Reload and review before retrying.","تعذر تأكيد إجراء الإجازة. أعد تحميل الطلب وراجعه قبل المحاولة مجدداً."];return{success:false,error:text[0],errorAr:text[1],alreadyDecided:key==="LEAVE_ALREADY_DECIDED"}}
const receipt=z.object({id:z.uuid(),driver_id:z.uuid(),version:z.number().int().positive(),status:z.enum(["pending","approved","rejected","cancelled"])})
export async function mutateDriverLeave(input:unknown):Promise<LeaveActionResult>{
 const parsed=schema.safeParse(input);if(!parsed.success)return failure("LEAVE_INPUT")
 const v=parsed.data
 try{await requirePermission("attendance",v.action==="create"?"create":["approved","rejected"].includes(v.action)?"approve":"update")}catch{return failure("LEAVE_FORBIDDEN")}
 try{
  const me=await getCurrentUser();if(!me)return failure("LEAVE_FORBIDDEN")
  if(!(await rateLimitDrivers("leave:"+me.authUserId)).success)return{success:false,error:"Too many leave actions. Wait and try again.",errorAr:"تجاوزت عدد إجراءات الإجازة المسموح. انتظر وحاول مجدداً."}
  const caller=await createClient()
  const {data,error}=await caller.rpc("mutate_driver_leave",{p_action:v.action,p_id:v.requestId??null,p_expected_version:v.expectedVersion??null,p_input:{reason:v.reason,surface:v.surface,...(v.driverId?{driver_id:v.driverId,client_request_id:v.clientRequestId}:{}),...(v.leaveTypeId?{leave_type_id:v.leaveTypeId,start_date:v.startDate,end_date:v.endDate}:{})}})
   if(error){
   const code=error.message??""
   if(/^(LEAVE_POLICY_REVIEW|LVE001)/.test(code)){
    // The policy needs a hire date to compute the balance; say so plainly.
    let driverId=v.driverId
    if(!driverId&&v.requestId)driverId=(await caller.from("driver_leave_requests").select("driver_id").eq("id",v.requestId).maybeSingle()).data?.driver_id
    if(driverId){const d=(await caller.from("drivers").select("hire_date").eq("id",driverId).maybeSingle()).data;if(d&&!d.hire_date)return{success:false,error:"Add the driver's hire date in the profile before requesting leave; it is needed to calculate the leave balance.",errorAr:"أضف تاريخ تعيين السائق في ملفه قبل طلب الإجازة؛ فهو لازم لحساب رصيد الإجازات."}}
   }
   return failure(code)
  }
  const saved=receipt.safeParse(data);if(!saved.success||(v.requestId&&saved.data.id!==v.requestId)||(v.driverId&&saved.data.driver_id!==v.driverId)||(v.expectedVersion!==undefined&&saved.data.version<=v.expectedVersion))return failure("unknown")
  const expectedStatus=v.action==="cancel"?"cancelled":["create","edit","restore"].includes(v.action)?"pending":v.action
  if(saved.data.status!==expectedStatus)return failure("unknown")
  try{revalidatePath("/approvals");revalidatePath("/drivers/"+saved.data.driver_id)}catch{/* The transaction has already committed. */}
  return{success:true,id:saved.data.id,driverId:saved.data.driver_id,version:saved.data.version,status:saved.data.status}
 }catch{return failure("unknown")}
}
