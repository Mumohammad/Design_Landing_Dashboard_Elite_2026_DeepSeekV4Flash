"use client"
import {useState} from "react"
import {useRouter} from "next/navigation"
import {toast} from "sonner"
import {Pencil,Archive,Loader2} from "lucide-react"
import {useTranslation} from "@/hooks/use-translation"
import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import {Label} from "@/components/ui/label"
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from "@/components/ui/dialog"
import {CreateVehicleDialog} from "@/app/(dashboard)/vehicles/components/create-vehicle-dialog"
import {archiveVehicle} from "@/lib/vehicles/actions"
import type {VehicleCreateInput} from "@/types/vehicles"
export function VehicleRecordControls({vehicle,onSaved}:{vehicle:VehicleCreateInput&{id:string;version:number};onSaved:()=>void}){
 const{locale}=useTranslation();const ar=locale==="ar";const router=useRouter();const[edit,setEdit]=useState(false);const[archive,setArchive]=useState(false);const[reason,setReason]=useState("");const[busy,setBusy]=useState(false)
 async function remove(){setBusy(true);const result=await archiveVehicle(vehicle.id,vehicle.version,reason);setBusy(false);if(!result.success)return toast.error(result.error);toast.success(ar?"تمت أرشفة المركبة":"Vehicle archived");router.push("/vehicles")}
 return <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={()=>setEdit(true)}><Pencil className="me-2 size-4"/>{ar?"تعديل المركبة":"Edit vehicle"}</Button><Button variant="outline" size="sm" onClick={()=>setArchive(true)}><Archive className="me-2 size-4"/>{ar?"أرشفة المركبة":"Archive vehicle"}</Button><CreateVehicleDialog key={vehicle.version} open={edit} onOpenChange={setEdit} initialVehicle={vehicle} onSaved={onSaved}/><Dialog open={archive} onOpenChange={setArchive}><DialogContent><DialogHeader><DialogTitle>{ar?"أرشفة المركبة":"Archive vehicle"}</DialogTitle><DialogDescription>{ar?"يجب إنهاء التعيينات والصيانة النشطة أولاً. تُحفظ السجلات السابقة.":"End active assignments and maintenance first. Previous records are retained."}</DialogDescription></DialogHeader><Label htmlFor="vehicle-archive-reason">{ar?"السبب":"Reason"}</Label><Input id="vehicle-archive-reason" value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/><DialogFooter><Button variant="outline" onClick={()=>setArchive(false)}>{ar?"إلغاء":"Cancel"}</Button><Button disabled={busy||reason.trim().length<3} onClick={()=>void remove()}>{busy&&<Loader2 className="me-2 size-4 animate-spin"/>}{ar?"أرشفة":"Archive"}</Button></DialogFooter></DialogContent></Dialog></div>
}
