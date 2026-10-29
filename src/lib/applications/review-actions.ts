"use server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser,requirePermission } from "@/lib/auth/authorization"
import { rateLimitApplications } from "@/lib/auth/rate-limit"
import { applicationReviewMessage,applicationReviewSchema,applicationsPageSchema,APPLICATION_STATUSES,type ApplicationsPageData } from "./review-schema"
const receiptSchema=z.object({id:z.uuid(),version:z.number().int().positive(),status:z.enum(APPLICATION_STATUSES),archived:z.boolean()})
export async function mutateApplicationReview(input:unknown){
 const parsed=applicationReviewSchema.safeParse(input)
 if(!parsed.success)return {success:false,...applicationReviewMessage("APP_INPUT")}
 try{await requirePermission("hr","approve")}catch{return {success:false,...applicationReviewMessage("APP_FORBIDDEN")}}
 try{
  const user=await getCurrentUser();if(!user)return {success:false,...applicationReviewMessage("APP_FORBIDDEN")}
  if(!(await rateLimitApplications(user.id)).success)return {success:false,error:"Rate limit exceeded. Try again later.",errorAr:"تجاوزت عدد المحاولات المسموح. حاول لاحقاً."}
  const v=parsed.data,caller=await createClient()
  const {data,error}=await caller.rpc("mutate_application_review_atomic",{p_id:v.applicationId,p_expected_version:v.expectedVersion,p_action:v.action,p_reason:v.reason,p_surface:v.surface})
  if(error)return {success:false,...applicationReviewMessage(error.message)}
  const receipt=receiptSchema.safeParse(data)
  if(!receipt.success||receipt.data.id!==v.applicationId||receipt.data.version<=v.expectedVersion)return {success:false,...applicationReviewMessage("unknown")}
  const saved=receipt.data
  const finalStatus=["approved","rejected","withdrawn"].includes(saved.status)
  const expectedStatus=v.action==="withdraw"?"withdrawn":v.action
  if(v.action==="archive"||v.action==="restore"){
   if(!finalStatus||saved.archived!==(v.action==="archive"))return {success:false,...applicationReviewMessage("unknown")}
  }else if(saved.status!==expectedStatus||saved.archived)return {success:false,...applicationReviewMessage("unknown")}
  try{revalidatePath("/applications");revalidatePath(`/applications/${v.applicationId}`);revalidatePath("/approvals")}catch{/* The durable transaction already committed. */}
  return {success:true,...receipt.data}
 }catch{return {success:false,...applicationReviewMessage("unknown")}}
}
const querySchema=z.object({search:z.string().max(200).default(""),status:z.enum(["all",...APPLICATION_STATUSES]).default("all"),archived:z.boolean().default(false),page:z.number().int().min(1).max(2147483647).default(1),pageSize:z.number().int().min(1).max(100).default(25)})
export async function fetchApplicationsPage(input:unknown={}):Promise<ApplicationsPageData>{
 try{
  await requirePermission("hr","read");if(!await getCurrentUser())throw Error("Unauthenticated")
  const v=querySchema.parse(input),caller=await createClient()
  const {data,error}=await caller.rpc("fetch_applications_page",{p_search:v.search.trim(),p_status:v.status,p_archived:v.archived,p_page:v.page,p_page_size:v.pageSize})
  if(error)throw Error("Unavailable")
  const result=applicationsPageSchema.parse(data)
  if(result.pageSize!==v.pageSize||result.totalPages!==Math.max(1,Math.ceil(result.total/v.pageSize))||result.page!==Math.min(v.page,result.totalPages)||result.rows.length!==Math.min(v.pageSize,Math.max(0,result.total-(result.page-1)*v.pageSize))||result.summary.total!==result.summary.pending+result.summary.approved+result.summary.rejected+result.summary.withdrawn||result.total>result.summary.total)throw Error("Incomplete applications page")
  return result
 }catch{throw Error("Could not load applications and their totals")}
}
