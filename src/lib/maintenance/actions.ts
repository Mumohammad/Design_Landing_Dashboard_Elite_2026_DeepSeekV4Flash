"use server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { rateLimitVehicles } from "@/lib/auth/rate-limit"
import { fetchFleetRows } from "@/lib/vehicles/query-pages"
import { toCsv } from "@/lib/accounting/csv-utils"
import { maintenanceEventCreateSchema,maintenanceEventUpdateSchema,maintenanceEventCompleteSchema,maintenanceEventCancelSchema,odometerLogCreateSchema,type MaintenanceEventCreateInput,type MaintenanceEventUpdateInput,type MaintenanceEventCompleteInput,type MaintenanceEventCancelInput,type OdometerLogCreateInput } from "@/types/maintenance"
export type MaintenanceActionResult={success:boolean;error?:string;id?:string;version?:number}
export type MaintenanceExportResult={success:boolean;csv?:string;error?:string}
function errorMessage(e:unknown){return e instanceof z.ZodError?e.issues[0]?.message??"Invalid form values":e instanceof Error?e.message:"The operation failed. Reload and try again."}
async function mutate(action:"create"|"update"|"start"|"complete"|"cancel"|"archive",input:Record<string,unknown>,id?:string,version?:number):Promise<MaintenanceActionResult>{
 try{
  await requirePermission("maintenance",action==="create"?"create":action==="archive"?"delete":"update")
  const me=await getCurrentUser();if(!me)return{success:false,error:"Not authenticated."}
  if(!(await rateLimitVehicles(me.id)).success)return{success:false,error:"Rate limit exceeded. Try again later."}
  if(id)z.uuid().parse(id);if(action!=="create")z.number().int().positive().parse(version)
  const client=await createClient();const {data,error}=await client.rpc("mutate_maintenance_event",{p_action:action,p_input:input,p_id:id??null,p_expected_version:version??null})
  if(error)throw new Error(error.message);if(!data?.id)throw new Error("The event was not saved. Reload and try again.")
  revalidatePath("/maintenance");revalidatePath("/vehicles");revalidatePath("/vehicles/"+data.vehicle_id)
  return{success:true,id:data.id,version:data.version}
 }catch(e){return{success:false,error:errorMessage(e)}}
}
export async function createMaintenanceEvent(input:MaintenanceEventCreateInput){try{return await mutate("create",maintenanceEventCreateSchema.parse(input))}catch(e){return{success:false,error:errorMessage(e)}}}
export async function updateMaintenanceEvent(input:MaintenanceEventUpdateInput){try{const{id,expected_version,...values}=maintenanceEventUpdateSchema.parse(input);return await mutate("update",values,id,expected_version)}catch(e){return{success:false,error:errorMessage(e)}}}
export async function startMaintenanceEvent(id:string,expectedVersion:number){return mutate("start",{},id,expectedVersion)}
export async function completeMaintenanceEvent(input:MaintenanceEventCompleteInput){try{const{id,expected_version,...values}=maintenanceEventCompleteSchema.parse(input);return await mutate("complete",values,id,expected_version)}catch(e){return{success:false,error:errorMessage(e)}}}
export async function cancelMaintenanceEvent(input:MaintenanceEventCancelInput){try{const{id,expected_version,...values}=maintenanceEventCancelSchema.parse(input);return await mutate("cancel",values,id,expected_version)}catch(e){return{success:false,error:errorMessage(e)}}}
export async function archiveMaintenanceEvent(id:string,expectedVersion:number,reason:string){try{return await mutate("archive",{reason:z.string().trim().min(3).max(500).parse(reason)},id,expectedVersion)}catch(e){return{success:false,error:errorMessage(e)}}}
export async function addOdometerReading(input:OdometerLogCreateInput):Promise<MaintenanceActionResult>{
 try{await requirePermission("maintenance","create");const me=await getCurrentUser();if(!me)return{success:false,error:"Not authenticated."};if(!(await rateLimitVehicles(me.id)).success)return{success:false,error:"Rate limit exceeded. Try again later."};const v=odometerLogCreateSchema.parse(input);const client=await createClient();const{data,error}=await client.rpc("record_fleet_odometer",{p_vehicle_id:v.vehicle_id,p_reading:v.reading,p_recorded_at:v.recorded_at||null,p_source:v.source??"manual",p_notes:v.notes||null});if(error)throw new Error(error.message);if(!data?.id)throw new Error("The reading was not saved.");revalidatePath("/maintenance");revalidatePath("/vehicles");return{success:true,id:data.id}}catch(e){return{success:false,error:errorMessage(e)}}
}
// ── CSV export (RFC-4180 + UTF-8 BOM) ───────────────────────────────────────

type MaintenanceListRow = {
  id: string
  maintenance_type: string
  status: string
  reported_at: string
  fault_description: string | null
  provider: string | null
  cost: number | null
  parts_replaced: string | null
  odometer_at_service: number | null
  date_in: string | null
  date_out: string | null
  next_service_km: number | null
  next_service_date: string | null
  vehicle: { plate_number: string | null; make: string | null; model: string | null } | null
  driver: { full_name_ar: string | null; full_name_en: string | null } | null
}

export async function exportMaintenanceCsv(): Promise<MaintenanceExportResult> {
  try {
    await requirePermission("maintenance", "export")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    const rl = await rateLimitVehicles(currentUser.id)
    if (!rl.success) return { success: false, error: "Rate limit exceeded. Try again later." }

    const admin = createAdminClient()
    const { data, error } = await fetchFleetRows<MaintenanceListRow>(()=>admin
      .from("vehicle_maintenance_events")
      .select(
        "id,maintenance_type,status,reported_at,fault_description,provider,cost,parts_replaced,odometer_at_service,date_in,date_out,next_service_km,next_service_date," +
          "vehicle:vehicles(plate_number,make,model),driver:drivers(full_name_ar,full_name_en)"
      )
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .order("reported_at", { ascending: false })
      .order("id"))
    if (error) return { success: false, error: error.message }

    const rows = (data as unknown as MaintenanceListRow[] | null) ?? []
    if(rows.length>10_000) return {success:false,error:"Export exceeds 10,000 records. Use a narrower reporting period."}
    const csv =
      "\uFEFF" +
      toCsv(
        ["Reported At", "Vehicle Plate", "Make/Model", "Type", "Status", "Reported By", "Fault", "Provider", "Cost (SAR)", "Odometer", "Date In", "Date Out", "Next Service (km)", "Next Service Date", "Parts Replaced"],
        rows.map((r) => [
          r.reported_at?.slice(0, 10) ?? "",
          r.vehicle?.plate_number ?? "",
          `${r.vehicle?.make ?? ""} ${r.vehicle?.model ?? ""}`.trim(),
          r.maintenance_type,
          r.status,
          r.driver?.full_name_en ?? r.driver?.full_name_ar ?? "",
          r.fault_description ?? "",
          r.provider ?? "",
          r.cost != null ? Number(r.cost).toFixed(2) : "",
          r.odometer_at_service ?? "",
          r.date_in?.slice(0, 10) ?? "",
          r.date_out?.slice(0, 10) ?? "",
          r.next_service_km ?? "",
          r.next_service_date ?? "",
          r.parts_replaced ?? "",
        ])
      )

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "maintenance",
      action: "maintenance_exported",
      entityType: "vehicle_maintenance_event",
      entityId: null,
      newValues: { rows: rows.length },
    })

    return { success: true, csv }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}
