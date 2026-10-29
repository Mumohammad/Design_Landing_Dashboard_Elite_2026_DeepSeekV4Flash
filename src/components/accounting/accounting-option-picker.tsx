"use client"
import { useState } from "react"
import { useAccountingPage } from "@/hooks/use-accounting-page"
import { AccountingPageControls } from "./accounting-page-controls"
import { Label } from "@/components/ui/label"
type Option={id:string;name_ar:string|null;name_en:string|null;account_code?:string;account_type?:string}
export function AccountingOptionPicker({kind,value,onChange,label,id,ar,code=false,disabled=false}:{kind:"customers"|"suppliers"|"accounts"|"asset_accounts";value:string;onChange:(value:string)=>void;label:string;id:string;ar:boolean;code?:boolean;disabled?:boolean}){
 const page=useAccountingPage<Option>(kind)
 const [selected,setSelected]=useState<Option|null>(null)
 const key=(row:Option)=>code?row.account_code??row.id:row.id
 const options=selected&&key(selected)===value&&!page.rows.some(row=>key(row)===value)?[selected,...page.rows]:page.rows
 return <fieldset disabled={disabled} className="min-w-0 space-y-2 rounded-lg border border-border/60 p-2" data-testid={id+"-picker"}>
  <Label htmlFor={id}>{label}</Label>
  <AccountingPageControls state={page}/>
  <select id={id} aria-label={label} value={value} disabled={page.loading||page.error} onChange={e=>{onChange(e.target.value);setSelected(options.find(row=>key(row)===e.target.value)??null)}} className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring">
   <option value="">{ar?"اختر من القائمة":"Choose an option"}</option>
   {value&&!options.some(row=>key(row)===value)&&<option value={value}>{value}</option>}
   {options.map(row=><option key={row.id} value={key(row)}>{row.account_code?row.account_code+" · ":""}{ar?(row.name_ar||row.name_en):(row.name_en||row.name_ar)}</option>)}
  </select>
 </fieldset>
}
