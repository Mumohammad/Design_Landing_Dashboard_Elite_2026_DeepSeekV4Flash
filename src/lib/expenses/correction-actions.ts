"use server"
import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { rateLimitExpenses } from "@/lib/auth/rate-limit"
import { expenseCorrectionMessage,expenseCorrectionSchema } from "./correction-schema"
const resultSchema=z.object({id:z.string().uuid(),version:z.number().int().positive(),replayed:z.boolean()})
export async function correctPendingExpense(input:unknown):Promise<{success:boolean;id?:string;version?:number;replayed?:boolean;error?:string;errorAr?:string}>{
 const parsed=expenseCorrectionSchema.safeParse(input)
 if(!parsed.success)return {success:false,...expenseCorrectionMessage("EXP_EDIT_INPUT")}
 try{await requirePermission("expenses","update")}catch{return {success:false,...expenseCorrectionMessage("EXP_EDIT_FORBIDDEN")}}
 try{
  const user=await getCurrentUser()
  if(!user)return {success:false,...expenseCorrectionMessage("EXP_EDIT_FORBIDDEN")}
  if(!(await rateLimitExpenses(user.id)).success)return {success:false,error:"Rate limit exceeded. Try again later.",errorAr:"تجاوزت عدد المحاولات المسموح. حاول لاحقاً."}
  const v=parsed.data;const client=await createClient()
  const {data,error}=await client.rpc("correct_pending_expense_atomic",{p_id:v.id,p_expected_version:v.expectedVersion,p_request_id:v.requestId,p_operation:v.operation,p_reason:v.reason,p_details:v.details?{...v.details,category:v.details.category||null,vendor:v.details.vendor||null,description:v.details.description||null}:null})
  if(error)return {success:false,...expenseCorrectionMessage(error.message)}
  const result=resultSchema.safeParse(data)
  if(!result.success||result.data.id!==v.id)return {success:false,...expenseCorrectionMessage("unknown")}
  try{revalidatePath("/expenses");revalidatePath("/approvals")}catch{/* The durable transaction already committed; refresh reads it. */}
  return {success:true,...result.data}
 }catch{return {success:false,...expenseCorrectionMessage("unknown")}}
}
