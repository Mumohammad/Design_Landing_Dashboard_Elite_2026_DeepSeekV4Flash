"use client"
import {useEffect,useState} from "react"
import {useInvoicePage} from "@/hooks/use-invoice-page"
import type {InvoicePartyOption} from "@/lib/accounting/invoice-pages"
import {AccountingPageControls} from "./accounting-page-controls"
import {Label} from "@/components/ui/label"
export function InvoicePartyPicker({kind,value,onChange,label,id,ar,disabled=false,selectedLabel,onAvailabilityChange}:{kind:"customers"|"suppliers";value:string;onChange:(value:string)=>void;label:string;id:string;ar:boolean;disabled?:boolean;selectedLabel?:string|null;onAvailabilityChange:(value:boolean)=>void}){
 const page=useInvoicePage<InvoicePartyOption>(kind),[selected,setSelected]=useState<InvoicePartyOption|null>(null)
 const options=selected&&selected.id===value&&!page.rows.some(row=>row.id===value)?[selected,...page.rows]:page.rows
 useEffect(()=>{onAvailabilityChange(!page.loading&&!page.error);return()=>onAvailabilityChange(false)},[page.loading,page.error,onAvailabilityChange])
 return <fieldset disabled={disabled} className="min-w-0 space-y-2 rounded-lg border border-border/60 p-2" data-testid="invoice-party-picker">
  <Label htmlFor={id}>{label}</Label><AccountingPageControls state={page}/>
  <select id={id} aria-label={label} value={value} disabled={page.loading||page.error||disabled} onChange={e=>{onChange(e.target.value);setSelected(options.find(row=>row.id===e.target.value)??null)}} className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring">
   <option value="">{ar?"اختر من القائمة":"Choose an option"}</option>
   {value&&!options.some(row=>row.id===value)&&<option value={value}>{selectedLabel|| (ar?"الطرف المحدد سابقاً":"Previously selected party")}</option>}
   {options.map(row=><option key={row.id} value={row.id}>{row.code} · {ar?(row.name_ar||row.name_en):(row.name_en||row.name_ar)}</option>)}
  </select>
 </fieldset>
}
