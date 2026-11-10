"use server"

import {revalidatePath} from "next/cache"
import {z} from "zod"
import {createClient} from "@/lib/supabase/server"
import {getCurrentUser,requirePermission} from "@/lib/auth/authorization"
import {rateLimitDrivers} from "@/lib/auth/rate-limit"
import {driverCreateSchema,driverUpdateSchema,driverStatusSchema,type DriverCreateInput,type DriverUpdateInput} from "@/types/drivers"
import {emit} from "@/lib/webhooks/events"
export type ActionResult={success:boolean;error?:string;id?:string;profile_version?:number}
const identity=z.object({id:z.uuid(),version:z.number().int().positive()})
function message(error:unknown){return error instanceof z.ZodError?error.issues[0]?.message??"Check the form values.":error instanceof Error?error.message:"Could not save the driver. Try again."}
async function perform(action:"create"|"update"|"status"|"archive",input:Record<string,unknown>,id?:string,version?:number):Promise<ActionResult>{
 try{
  await requirePermission("drivers",action==="archive"?"delete":action==="create"?"create":"update")
  const user=await getCurrentUser();if(!user)throw new Error("Not authenticated.")
  if(!(await rateLimitDrivers(user.id)).success)throw new Error("Rate limit exceeded. Try again later.")
  if(action!=="create")identity.parse({id,version})
  const db=await createClient(),{data,error}=await db.rpc("mutate_driver_profile",{p_action:action,p_input:input,p_id:id??null,p_expected_version:version??null})
  if(error)throw new Error(error.code==="23505"?"A driver with this code or identity already exists.":error.message)
  if(!data?.id)throw new Error("The driver was not saved. Reload and try again.")
  revalidatePath("/drivers");revalidatePath("/drivers/"+data.id);revalidatePath("/payroll/preparation")
  if(action==="create")emit("driver.created",user.tenantId,{id:data.id,name:String(input.full_name_ar??""),code:String(input.driver_code??""),status:String(input.status??"draft")})
  return{success:true,id:data.id,profile_version:data.profile_version}
 }catch(error){return{success:false,error:message(error)}}
}
function normalized(input:Record<string,unknown>){return Object.fromEntries(Object.entries(input).filter(([,value])=>value!==undefined).map(([key,value])=>[key,typeof value==="string"?value.trim()||null:value]))}
export async function createDriver(input:DriverCreateInput):Promise<ActionResult>{
 try{return await perform("create",normalized(driverCreateSchema.parse(input)))}catch(error){return{success:false,error:message(error)}}
}
export async function updateDriver(driverId:string,input:DriverUpdateInput,expectedVersion:number):Promise<ActionResult>{
 try{
  const parsed=driverUpdateSchema.parse(input)
  if(parsed.status!==undefined||parsed.current_vehicle_id!==undefined||parsed.payroll_rule_id!==undefined)throw new Error("Use the dedicated status, vehicle assignment or payroll rule workflow.")
  return await perform("update",normalized(parsed),driverId,expectedVersion)
 }catch(error){return{success:false,error:message(error)}}
}
const statusInput=z.object({driverId:z.uuid(),expectedVersion:z.number().int().positive(),status:driverStatusSchema,reason:z.string().trim().max(500).optional(),note:z.string().trim().max(1000).optional(),terminationDate:z.iso.date().optional()})
export async function setDriverStatus(input:unknown):Promise<ActionResult>{
 try{const parsed=statusInput.parse(input);return await perform("status",normalized({status:parsed.status,reason:parsed.reason,note:parsed.note,termination_date:parsed.terminationDate}),parsed.driverId,parsed.expectedVersion)}catch(error){return{success:false,error:message(error)}}
}
const archiveInput=z.object({driverId:z.uuid(),expectedVersion:z.number().int().positive(),reason:z.string().trim().min(5).max(500)})
export async function archiveDriver(input:unknown):Promise<ActionResult>{
 try{const parsed=archiveInput.parse(input);return await perform("archive",{reason:parsed.reason},parsed.driverId,parsed.expectedVersion)}catch(error){return{success:false,error:message(error)}}
}
