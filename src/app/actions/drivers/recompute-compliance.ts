"use server"
import {z} from "zod"
import {callDriverEvidence,evidenceFailure} from "@/lib/drivers/evidence-actions"
const inputSchema=z.object({driverId:z.uuid(),expectedDriverVersion:z.number().int().positive()}).strict()
export type RecomputeResult={ok:true;profileVersion:number;level:string;score:number;blockers:number;missing:number;pending:number;warnings:number}|{ok:false;error:string;errorAr:string}
export async function recomputeDriverCompliance(input:unknown):Promise<RecomputeResult>{const p=inputSchema.safeParse(input);if(!p.success)return evidenceFailure("EVIDENCE_INPUT") as Extract<RecomputeResult,{ok:false}>;const result=await callDriverEvidence("recompute",{driverId:p.data.driverId,expectedDriverVersion:p.data.expectedDriverVersion});if(!result.ok)return result;if(!result.summary)return evidenceFailure("unknown") as Extract<RecomputeResult,{ok:false}>;return{ok:true,profileVersion:result.profileVersion,...result.summary}}
