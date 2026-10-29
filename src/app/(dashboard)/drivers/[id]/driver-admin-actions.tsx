"use client"

import DriverActionsMenu from "@/components/drivers/driver-actions-menu"
import type{Driver}from"@/types/drivers"

/** The profile and list use one version-checked edit/status/archive workflow. */
export default function DriverAdminActions({driver,isAr,onUpdated}:{driver:Driver;isAr:boolean;onUpdated:()=>void}){
 return <DriverActionsMenu driverId={driver.id} driver={driver} isAr={isAr} onUpdated={onUpdated} redirectAfterArchive="/drivers"/>
}
