"use server"
import {z} from "zod"
import {callDriverEvidence,evidenceFailure,type EvidenceResult} from "@/lib/drivers/evidence-actions"
const identity={driverId:z.uuid(),expectedDriverVersion:z.number().int().positive()}
const create=z.object({...identity,requirement:z.enum(["identity","driving_license","health_certificate","home_delivery_permit","ajeer_permit"]),reason:z.string().trim().min(5).max(500),days:z.union([z.literal(7),z.literal(30),z.literal(90)]),attachmentUrl:z.string().max(1000).refine(value=>{try{const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password}catch{return false}}).optional()}).strict()
const revoke=z.object({...identity,overrideId:z.uuid(),expectedVersion:z.number().int().positive()}).strict()
export async function createComplianceOverride(input:unknown):Promise<EvidenceResult>{const p=create.safeParse(input);if(!p.success)return evidenceFailure("EVIDENCE_INPUT");const v=p.data;return callDriverEvidence("override_create",{driverId:v.driverId,expectedDriverVersion:v.expectedDriverVersion,input:{requirement:v.requirement,reason:v.reason,days:v.days,...(v.attachmentUrl?{attachment_url:v.attachmentUrl}:{})}})}
export async function revokeComplianceOverride(input:unknown):Promise<EvidenceResult>{const p=revoke.safeParse(input);if(!p.success)return evidenceFailure("EVIDENCE_INPUT");return callDriverEvidence("override_revoke",{driverId:p.data.driverId,expectedDriverVersion:p.data.expectedDriverVersion,id:p.data.overrideId,expectedVersion:p.data.expectedVersion})}
