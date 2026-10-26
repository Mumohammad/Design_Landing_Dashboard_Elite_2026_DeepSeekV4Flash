import type { SupabaseClient } from "@supabase/supabase-js"
import { isMasterDate, isMasterId, isMasterTimestamp } from "./master-contract"

export const INVOICE_STATUSES = ["draft","issued","finalized","paid","partially_paid","overdue","cancelled","credited"] as const
export type InvoiceListRow = {
 id:string;invoice_number:string;invoice_type:"sales"|"purchase";issue_date:string;due_date:string;show_due_date:boolean;status:string;
 subtotal:number;discount:number;vat_amount:number;total:number;currency:string;updated_at:string;customer_id:string|null;supplier_id:string|null;vat_rate:number;notes:string|null;
 customer_name:string|null;customer_name_en:string|null;supplier_name:string|null;supplier_name_en:string|null;
}
export type InvoiceSummary={total:number;drafts:number;finalized:number;value_sar:string}
export type InvoicePartyOption={id:string;code:string;name_ar:string|null;name_en:string|null}
export type InvoicePage<T>={rows:T[];total:number;page:number;page_size:number;summary?:InvoiceSummary}
export type InvoiceReadOptions={search?:string;status?:string;page?:number;pageSize?:number;exporting?:boolean;signal?:AbortSignal}
const plain=(x:unknown):x is Record<string,unknown>=>x!==null&&typeof x==="object"&&!Array.isArray(x)
const count=(x:unknown):x is number=>typeof x==="number"&&Number.isSafeInteger(x)&&x>=0
const nullableText=(x:unknown)=>x===null||typeof x==="string"
const amount=(x:unknown):x is number=>typeof x==="number"&&Number.isFinite(x)&&x>=0&&x<=9999999999.99&&/^\d+(?:\.\d{1,2})?$/.test(String(x))
export class InvoiceReadError extends Error {
 readonly exportLimit:boolean
 constructor(exportLimit=false){super(exportLimit?"Narrow the invoice export search.":"Unable to load complete invoice records.");this.name="InvoiceReadError";this.exportLimit=exportLimit}
}
function options(input:InvoiceReadOptions){
 const {search="",status="all",page=1,pageSize=50,exporting=false}=input
 if(typeof search!=="string"||search.length>200||typeof status!=="string"||!(status==="all"||INVOICE_STATUSES.some(x=>x===status))||!count(page)||page<1||page>1000000||!count(pageSize)||pageSize<1||pageSize>100||typeof exporting!=="boolean")throw new InvoiceReadError()
 return {search,status,page,pageSize,exporting}
}
export function parseInvoicePage<T>(value:unknown,kind:"invoices"|"customers"|"suppliers",request:InvoiceReadOptions={}):InvoicePage<T>{
 const {page,pageSize,exporting}=options(request)
 if(!plain(value)||!Array.isArray(value.rows)||!count(value.total)||value.page!==(exporting?1:page)||value.page_size!==pageSize||value.rows.length>(exporting?10000:pageSize)||value.rows.length!==Math.min(exporting?10000:pageSize,Math.max(0,value.total-(exporting?0:(page-1)*pageSize))))throw new InvoiceReadError()
 if(exporting&&value.total>10000)throw new InvoiceReadError(true)
 const seen=new Set<string>()
 for(const row of value.rows){
  if(!plain(row)||!isMasterId(row.id)||seen.has(row.id))throw new InvoiceReadError();seen.add(row.id)
  if(kind!=="invoices"){
   if(typeof row.code!=="string"||!row.code||!nullableText(row.name_ar)||!nullableText(row.name_en)||!(row.name_ar||row.name_en))throw new InvoiceReadError()
  }else{
   if(typeof row.invoice_number!=="string"||!row.invoice_number||!(["sales","purchase"] as unknown[]).includes(row.invoice_type)||!INVOICE_STATUSES.some(x=>x===row.status)||!isMasterDate(row.issue_date)||!isMasterDate(row.due_date)||typeof row.show_due_date!=="boolean"||typeof row.currency!=="string"||!/^[A-Z]{3}$/.test(row.currency)||!isMasterTimestamp(row.updated_at)||!([row.customer_id,row.supplier_id].every(x=>x===null||isMasterId(x)))||!nullableText(row.notes)||![row.customer_name,row.customer_name_en,row.supplier_name,row.supplier_name_en].every(nullableText)||![row.subtotal,row.discount,row.vat_amount,row.total].every(amount)||typeof row.vat_rate!=="number"||!Number.isFinite(row.vat_rate)||row.vat_rate<0||row.vat_rate>100)throw new InvoiceReadError()
  }
 }
 let summary:InvoiceSummary|undefined
 if(kind==="invoices"){
  const s=value.summary
  if(!plain(s)||!count(s.total)||!count(s.drafts)||!count(s.finalized)||s.total<value.total||s.drafts>s.total||s.finalized>s.total||s.drafts+s.finalized>s.total||typeof s.value_sar!=="string"||!/^\d+\.\d{2}$/.test(s.value_sar))throw new InvoiceReadError()
  summary={total:s.total,drafts:s.drafts,finalized:s.finalized,value_sar:s.value_sar}
 }
 return {rows:value.rows as T[],total:value.total,page:value.page as number,page_size:pageSize,...(summary?{summary}:{})}
}
export async function readInvoicePage<T=InvoiceListRow>(client:SupabaseClient,kind:"invoices"|"customers"|"suppliers",request:InvoiceReadOptions={}):Promise<InvoicePage<T>>{
 const p=options(request)
 if(!["invoices","customers","suppliers"].includes(kind)||(kind!=="invoices"&&p.exporting))throw new InvoiceReadError()
 try{
  let query=kind==="invoices"?client.rpc("read_my_invoice_page",{p_search:p.search,p_status:p.status,p_page:p.page,p_page_size:p.pageSize,p_export:p.exporting}):client.rpc("read_my_invoice_party_page",{p_kind:kind,p_search:p.search,p_page:p.page,p_page_size:p.pageSize})
  if(request.signal)query=query.abortSignal(request.signal)
  const {data,error}=await query
  if(error||request.signal?.aborted)throw new InvoiceReadError(error?.message?.startsWith("INV_EXPORT_LIMIT:")??false)
  return parseInvoicePage<T>(data,kind,request)
 }catch(error){throw error instanceof InvoiceReadError?error:new InvoiceReadError()}
}
export function formatInvoiceSummary(value:string|null|undefined):string{
 if(value==null)return "—"
 if(!/^\d+\.\d{2}$/.test(value))throw new InvoiceReadError()
 const [whole,fraction]=value.split(".");return whole.replace(/\B(?=(\d{3})+(?!\d))/g,",")+"."+fraction
}
