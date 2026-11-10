"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { PaginationData } from "@/components/dashboard/enterprise-module-page"

export function DriverHistoryToolbar({search,onSearchChange,pagination,loading,error,onRefresh,isAr}: {
 search:string;onSearchChange:(value:string)=>void;pagination:PaginationData;loading:boolean;error:boolean;onRefresh:()=>void;isAr:boolean
}) {
 return <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid="driver-history-toolbar">
  <Input type="search" value={search} onChange={event=>onSearchChange(event.target.value)} maxLength={200} className="w-full min-w-0 sm:max-w-sm" aria-label={isAr?"بحث في السجل":"Search history"} placeholder={isAr?"بحث في السجل":"Search history"}/>
  <div className="flex flex-wrap items-center gap-2"><span aria-live="polite" className="text-xs text-muted-foreground">{loading?(isAr?"جارٍ التحميل…":"Loading…"):error?"—":isAr?pagination.totalRecords+" سجل · الصفحة "+pagination.currentPage+" من "+pagination.totalPages:pagination.totalRecords+" records · Page "+pagination.currentPage+" of "+pagination.totalPages}</span>
   <Button size="sm" variant="outline" disabled={loading||error||pagination.currentPage<=1} onClick={()=>pagination.onPageChange(pagination.currentPage-1)} aria-label={isAr?"الصفحة السابقة":"Previous page"}>{isAr?"السابق":"Previous"}</Button>
   <Button size="sm" variant="outline" disabled={loading||error||pagination.currentPage>=pagination.totalPages} onClick={()=>pagination.onPageChange(pagination.currentPage+1)} aria-label={isAr?"الصفحة التالية":"Next page"}>{isAr?"التالي":"Next"}</Button>
   <Button size="sm" variant="outline" disabled={loading} onClick={onRefresh}>{isAr?"تحديث":"Refresh"}</Button>
  </div>
 </div>
}
