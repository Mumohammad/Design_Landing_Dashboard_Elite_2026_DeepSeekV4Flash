"use server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser,requirePermission } from "@/lib/auth/authorization"
import { rateLimitVehicles } from "@/lib/auth/rate-limit"
import { emit } from "@/lib/webhooks/events"
export type AssignmentActionResult={success:boolean;error?:string;assignmentId?:string}
const schema=z.object({vehicleId:z.uuid(),driverId:z.uuid(),assignment_reason:z.string().trim().max(500).nullable().optional(),handover_odometer:z.number().int().min(0).max(5000000).nullable().optional(),return_odometer:z.number().int().min(0).max(5000000).nullable().optional(),notes:z.string().trim().max(500).nullable().optional(),expectedVersion:z.number().int().positive().optional()}).strict()
async function mutate(action:"assign"|"unassign",input:unknown):Promise<AssignmentActionResult>{try{await requirePermission("assignments",action==="assign"?"create":"update");const me=await getCurrentUser();if(!me)return{success:false,error:"Not authenticated."};if(!(await rateLimitVehicles(me.id)).success)return{success:false,error:"Rate limit exceeded. Try again later."};const{vehicleId,driverId,expectedVersion,...values}=schema.parse(input);if(action==="unassign")z.number().int().positive().parse(expectedVersion);const client=await createClient();const{data,error}=await client.rpc("mutate_fleet_assignment",{p_action:action,p_vehicle_id:vehicleId,p_driver_id:driverId,p_input:values,p_expected_version:expectedVersion??null});if(error)throw new Error(error.message);if(!data?.id)throw new Error("The assignment was not changed. Reload and try again.");emit(action==="assign"?"vehicle.assigned":"vehicle.unassigned",me.tenantId,{vehicleId,driverId});revalidatePath("/vehicles");revalidatePath("/vehicles/"+vehicleId);revalidatePath("/drivers");revalidatePath("/drivers/"+driverId);return{success:true,assignmentId:data.id}}catch(e){return{success:false,error:e instanceof z.ZodError?e.issues[0]?.message??"Invalid values":e instanceof Error?e.message:"The assignment could not be saved."}}}
export async function assignVehicleToDriver(input:unknown){return mutate("assign",input)}
export async function unassignVehicleFromDriver(input:unknown){return mutate("unassign",input)}
