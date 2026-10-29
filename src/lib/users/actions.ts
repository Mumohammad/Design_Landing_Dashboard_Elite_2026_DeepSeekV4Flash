"use server"
import {z} from "zod"
import {mutateUser,type ManagementResult} from "./management"
export type UserActionResult=ManagementResult
export async function updateUserStatus(input:unknown):Promise<UserActionResult>{const p=z.object({userId:z.uuid(),expectedVersion:z.number().int().positive(),status:z.enum(["active","inactive","locked","pending_invite","terminated"]),reason:z.string().trim().min(5).max(500)}).strict().safeParse(input);if(!p.success)return{success:false,error:"Reload the user and enter a reason before changing status."};return mutateUser("status",p.data.userId,p.data.expectedVersion,{status:p.data.status,reason:p.data.reason})}
export async function assignEmployeeCode(input:unknown):Promise<UserActionResult>{const p=z.object({userId:z.uuid(),expectedVersion:z.number().int().positive()}).strict().safeParse(input);if(!p.success)return{success:false,error:"Reload the user before assigning an employee code."};return mutateUser("employee_code",p.data.userId,p.data.expectedVersion,{})}
