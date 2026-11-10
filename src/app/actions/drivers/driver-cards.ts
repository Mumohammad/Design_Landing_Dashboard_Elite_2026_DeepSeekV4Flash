"use server"
import {z} from "zod"
import {callDriverEvidence,evidenceFailure,type EvidenceResult} from "@/lib/drivers/evidence-actions"
const identity={driverId:z.uuid(),expectedDriverVersion:z.number().int().positive()}
const reviewed={...identity,cardId:z.uuid(),expectedVersion:z.number().int().positive()}
const issue=z.object(identity).strict(),revoke=z.object({...reviewed,reason:z.string().trim().min(5).max(500)}).strict(),print=z.object({...reviewed,format:z.enum(["pvc","a4","screen"]),batchRef:z.string().trim().max(100).optional()}).strict()
export async function issueDriverCard(input:unknown):Promise<EvidenceResult>{const p=issue.safeParse(input);if(!p.success)return evidenceFailure("EVIDENCE_INPUT");return callDriverEvidence("card_issue",{driverId:p.data.driverId,expectedDriverVersion:p.data.expectedDriverVersion})}
export async function revokeDriverCard(input:unknown):Promise<EvidenceResult>{const p=revoke.safeParse(input);if(!p.success)return evidenceFailure("EVIDENCE_INPUT");return callDriverEvidence("card_revoke",{driverId:p.data.driverId,expectedDriverVersion:p.data.expectedDriverVersion,id:p.data.cardId,expectedVersion:p.data.expectedVersion,input:{reason:p.data.reason}})}
export async function recordCardPrint(input:unknown):Promise<EvidenceResult>{const p=print.safeParse(input);if(!p.success)return evidenceFailure("EVIDENCE_INPUT");return callDriverEvidence("card_print",{driverId:p.data.driverId,expectedDriverVersion:p.data.expectedDriverVersion,id:p.data.cardId,expectedVersion:p.data.expectedVersion,input:{format:p.data.format,...(p.data.batchRef?{batch_ref:p.data.batchRef}:{})}})}
