import { z } from "zod"
import { EXPENSE_TYPES } from "./constants"
const amount=z.number().finite().min(0.01).max(99_999_999.99).refine(v=>Math.abs(v*100-Math.round(v*100))<0.00001,"Use two decimal places")
const rate=z.number().finite().min(0).max(100).refine(v=>Math.abs(v*100-Math.round(v*100))<0.00001,"Use two decimal places")
export const pendingExpenseDetailsSchema=z.object({expense_type:z.enum(EXPENSE_TYPES),category:z.string().trim().max(200).nullable().optional(),amount,expense_date:z.iso.date(),vendor:z.string().trim().max(200).nullable().optional(),description:z.string().trim().max(2000).nullable().optional(),vat_rate:rate})
export const expenseCorrectionSchema=z.object({id:z.string().uuid(),expectedVersion:z.number().int().positive(),requestId:z.string().uuid(),operation:z.enum(["update","cancel"]),reason:z.string().trim().min(5).max(500),details:pendingExpenseDetailsSchema.optional()}).superRefine((v,ctx)=>{
 if(v.operation==="update"&&!v.details)ctx.addIssue({code:"custom",message:"Expense details are required"})
 if(v.operation==="cancel"&&v.details)ctx.addIssue({code:"custom",message:"Cancellation does not change expense details"})
})
const messages:Record<string,[string,string]>={
 EXP_EDIT_STALE:["This expense changed. Reload and review it before saving again.","تغير المصروف. أعد تحميله وراجعه قبل الحفظ مجدداً."],
 EXP_EDIT_DECIDED:["This expense already has a final decision. Reload its current status.","يوجد قرار نهائي لهذا المصروف. أعد تحميل حالته الحالية."],
 EXP_CANCELLED:["This expense was cancelled. Its history is preserved.","أُلغي هذا المصروف وحُفظ سجله."],
 EXP_EDIT_MAKER_REQUIRED:["Only the original expense creator can correct or cancel a pending expense.","يمكن لمنشئ المصروف الأصلي فقط تصحيح المصروف المعلق أو إلغاءه."],
 EXP_EDIT_FORBIDDEN:["You do not have permission to change this expense, or MFA is required.","ليس لديك إذن لتعديل المصروف أو يلزم التحقق الثنائي."],
 EXP_EDIT_FINANCE_REVIEW:["Accounting evidence already exists. Ask Accounting to review the correction.","توجد أدلة محاسبية سابقة. اطلب مراجعة التصحيح من المحاسبة."],
 EXP_EDIT_RETRY_MISMATCH:["This request already saved different details. Reload the original expense.","حفظ هذا الطلب تفاصيل مختلفة مسبقاً. أعد تحميل المصروف الأصلي."],
 EXP001:["Expense not found. Reload the list.","المصروف غير موجود. أعد تحميل القائمة."],
 EXP_EDIT_INPUT:["Check the amounts, date and change reason.","تحقق من المبالغ والتاريخ وسبب التعديل."],
}
export function expenseCorrectionMessage(message:string){const code=/^[A-Z0-9_]+/.exec(message)?.[0]??"";const pair=messages[code];return pair?{error:pair[0],errorAr:pair[1]}:{error:"Unable to confirm the change. Retry with unchanged details.",errorAr:"تعذر تأكيد التعديل. أعد المحاولة بالتفاصيل نفسها."}}
