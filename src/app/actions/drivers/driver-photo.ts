"use server"
import {z} from "zod"
import {createClient} from "@/lib/supabase/server"
import {callDriverEvidence,evidenceFailure} from "@/lib/drivers/evidence-actions"
import {DRIVER_PHOTO_BUCKET,DRIVER_PHOTO_MAX_BYTES,DRIVER_PHOTO_MIME_TYPES} from "@/lib/drivers/photo"
const identity={driverId:z.uuid(),expectedDriverVersion:z.number().int().positive()}
const update=z.object({...identity,filePath:z.string().min(8).max(400),contentType:z.string().refine(v=>DRIVER_PHOTO_MIME_TYPES.has(v)).optional(),size:z.number().int().positive().max(DRIVER_PHOTO_MAX_BYTES).optional()}).strict(),remove=z.object(identity).strict()
type Result={ok:true;filePath:string|null;signedUrl:string|null;profileVersion:number}|{ok:false;error:string;errorAr:string}
export async function updateDriverPhoto(input:unknown):Promise<Result>{
 const p=update.safeParse(input);if(!p.success)return evidenceFailure("EVIDENCE_INPUT") as Extract<Result,{ok:false}>
 const v=p.data,result=await callDriverEvidence("photo_update",{driverId:v.driverId,expectedDriverVersion:v.expectedDriverVersion,input:{file_path:v.filePath,...(v.contentType?{mime_type:v.contentType}:{}),...(v.size?{file_size:v.size}:{})}})
 if(!result.ok)return result
 let signedUrl:string|null=null
 try{const caller=await createClient(),signed=await caller.storage.from(DRIVER_PHOTO_BUCKET).createSignedUrl(v.filePath,3600);signedUrl=signed.data?.signedUrl??null}catch{/* Retain the committed pointer even if signing is temporarily unavailable. */}
 return{ok:true,filePath:v.filePath,signedUrl,profileVersion:result.profileVersion}
}
export async function removeDriverPhoto(input:unknown):Promise<Result>{const p=remove.safeParse(input);if(!p.success)return evidenceFailure("EVIDENCE_INPUT") as Extract<Result,{ok:false}>;const result=await callDriverEvidence("photo_remove",{driverId:p.data.driverId,expectedDriverVersion:p.data.expectedDriverVersion});if(!result.ok)return result;return{ok:true,filePath:null,signedUrl:null,profileVersion:result.profileVersion}}
