"use client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { PaginationData } from "@/components/dashboard/enterprise-module-page"
import { useTranslation } from "@/hooks/use-translation"
export type AccountingPageState = {search:string;setSearch:(value:string)=>void;pagination:PaginationData;loading:boolean;error:boolean;reload:()=>void}
export function AccountingPageControls({state}:{state:AccountingPageState}) {
 const {locale}=useTranslation(), ar=locale==="ar"
 return <div className="space-y-2 border-b border-border/50 p-3" data-testid="accounting-page-controls">
  <div className="flex flex-wrap items-center gap-2">
   <Input type="search" maxLength={200} value={state.search} onChange={e=>state.setSearch(e.target.value)} aria-label={ar?"البحث في السجلات":"Search records"} placeholder={ar?"بحث في السجلات":"Search records"} className="min-w-0 flex-1 sm:max-w-sm" />
   <span aria-live="polite" className="text-xs text-muted-foreground">{state.loading?(ar?"جارٍ التحميل…":"Loading…"):state.error?"—":ar?
    state.pagination.totalRecords+" سجل · الصفحة "+state.pagination.currentPage+" من "+state.pagination.totalPages:
    state.pagination.totalRecords+(state.pagination.totalRecords===1?" record · Page ":" records · Page ")+state.pagination.currentPage+" of "+state.pagination.totalPages}</span>
   <Button type="button" variant="outline" size="sm" disabled={state.loading||state.error||state.pagination.currentPage<=1} onClick={()=>state.pagination.onPageChange(state.pagination.currentPage-1)}>{ar?"السابق":"Previous records"}</Button>
   <Button type="button" variant="outline" size="sm" disabled={state.loading||state.error||state.pagination.currentPage>=state.pagination.totalPages} onClick={()=>state.pagination.onPageChange(state.pagination.currentPage+1)}>{ar?"التالي":"Next records"}</Button>
   <Button type="button" variant="outline" size="sm" disabled={state.loading} onClick={state.reload}>{ar?"تحديث":"Refresh records"}</Button>
  </div>
  {state.error&&<div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive"><span>{ar?"تعذر تحميل السجلات. أعد المحاولة قبل الاعتماد عليها.":"Could not load records. Retry before relying on them."}</span><Button type="button" variant="outline" size="sm" onClick={state.reload}>{ar?"إعادة المحاولة":"Retry"}</Button></div>}
 </div>
}
