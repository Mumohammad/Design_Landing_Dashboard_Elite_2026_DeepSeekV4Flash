"use client"
import { useAccountingPage } from "@/hooks/use-accounting-page"
import { AccountingPageControls } from "./accounting-page-controls"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { decimalRound } from "@/lib/accounting/decimal"
import { formatVatMoney } from "@/lib/accounting/vat-position"
type AllocationRow={id:string;invoice_ref:string;outstanding:string;party_name_ar:string|null;party_name_en:string|null}
export type AllocationDraft={key:number;id:string;receivable_id:string|null;payable_id:string|null;label:string;party:string;outstanding:number;amount:string;selected:boolean}
export function PaymentAllocationPicker({direction,partyId,selected,onChange,ar,disabled}:{direction:"in"|"out";partyId:string;selected:AllocationDraft[];onChange:(value:AllocationDraft[])=>void;ar:boolean;disabled?:boolean}){
 const page=useAccountingPage<AllocationRow>(partyId?(direction==="in"?"open_ar":"open_ap"):null,0,partyId)
 const toggle=(row:AllocationRow,checked:boolean)=>{
  if(!checked){onChange(selected.filter(item=>item.id!==row.id));return}
  if(selected.some(item=>item.id===row.id))return
  onChange([...selected,{key:selected.length,id:row.id,receivable_id:direction==="in"?row.id:null,payable_id:direction==="out"?row.id:null,label:row.invoice_ref,party:(ar?row.party_name_ar:row.party_name_en)||row.party_name_ar||row.party_name_en||"",outstanding:decimalRound(row.outstanding),amount:"",selected:true}])
 }
 return <fieldset disabled={disabled} className="min-w-0 space-y-2 rounded-lg border border-border/60 p-2" data-testid="payment-allocation-picker">
  <legend className="px-1 text-sm font-medium">{ar?"التخصيصات":"Allocations"}</legend>
  {!partyId?<p className="p-2 text-sm text-muted-foreground">{ar?"اختر العميل أو المورد لعرض المستحقات.":"Choose a customer or supplier to browse outstanding documents."}</p>:<>
   <AccountingPageControls state={page}/>
   {!page.loading&&!page.error&&<div className="max-h-48 space-y-1 overflow-y-auto">
    {page.rows.length===0&&<p className="p-2 text-sm text-muted-foreground">{ar?"لا توجد مستحقات مطابقة.":"No matching outstanding documents."}</p>}
    {page.rows.map(row=><label key={row.id} className="flex min-w-0 items-center gap-2 rounded-md p-2 hover:bg-muted/40">
     <input type="checkbox" checked={selected.some(item=>item.id===row.id)} onChange={e=>toggle(row,e.target.checked)} className="h-4 w-4 accent-elite-blue-600"/>
     <span className="min-w-0 flex-1 break-words text-sm">{row.invoice_ref}</span><span dir="ltr" className="text-xs tabular-nums">{formatVatMoney(row.outstanding)}</span>
    </label>)}
   </div>}
  </>}
  {selected.length>0&&<div className="space-y-2 border-t border-border/50 pt-2">
   <p className="text-xs text-muted-foreground">{ar?"المستندات المحددة محفوظة أثناء البحث والتنقل.":"Selected documents stay selected while searching and paging."}</p>
   {selected.map(item=><div key={item.id} className="flex flex-wrap items-center gap-2">
    <label htmlFor={"allocation-"+item.id} className="min-w-0 flex-1 break-words text-sm">{item.label}</label>
    <Input id={"allocation-"+item.id} type="number" min="0" max={item.outstanding} step="0.01" value={item.amount} onChange={e=>onChange(selected.map(row=>row.id===item.id?{...row,amount:e.target.value}:row))} className="h-9 w-28 text-end tabular-nums" dir="ltr"/>
    <Button type="button" variant="outline" size="sm" onClick={()=>onChange(selected.filter(row=>row.id!==item.id))}>{ar?"إزالة":"Remove"}</Button>
   </div>)}
  </div>}
 </fieldset>
}
