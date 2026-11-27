import { describe, expect, it, vi } from "vitest"
import { loadZatcaSourceDocument } from "./zatca-source"
import type { createAdminClient } from "@/lib/supabase/admin"

vi.mock("server-only", () => ({}))
const invoice = { id: "invoice-id", invoice_number: "INV-1", invoice_type: "sales", status: "finalized", customer_id: null, issue_date: "2026-11-09", currency: "SAR", subtotal: 100, discount: 0, vat_amount: 15, total: 115, vat_rate: 15 }
function database({status="finalized",invoiceError=false,prepared=false,preparationError=false,noteError=false,referenceError=false,missingReference=false}={}) {
 const reads: Array<{table:string; filters:unknown[][]}>=[]
 const client={from(table:string){
  const read={table,filters:[] as unknown[][]};reads.push(read)
  const result=table==="invoices" ? reads.filter(x=>x.table==="invoices").length===1&&!reads.some(x=>["credit_notes","debit_notes"].includes(x.table))
   ? {data:{...invoice,status},error:invoiceError?{}:null}
   : {data:missingReference?null:{invoice_number:"INV-1"},error:referenceError?{}:null}
   : table==="zatca_document_issuances"?{data:prepared?{id:"issuance-id"}:null,error:preparationError?{}:null}
   : ["credit_notes","debit_notes"].includes(table)?{data:{id:"note-id",credit_note_number:"CN-1",debit_note_number:"DN-1",reference_invoice_id:"invoice-id",customer_id:null,issue_date:"2026-11-09",currency:"SAR",subtotal:100,discount:0,vat_amount:15,total:115,reason:"Correction",lines:[]},error:noteError?{}:null}
   : {data:[{line_no:1,item_name:"Service",description:"Delivery",quantity:1,unit_price:100,discount:0,amount:100,vat_rate:15,vat_amount:15}],error:null}
  const query={select(){return query},eq(...args:unknown[]){read.filters.push(args);return query},order(){return query},maybeSingle:async()=>result,then(resolve:(value:typeof result)=>unknown){return Promise.resolve(result).then(resolve)}}
  return query
 }}
 return {client:client as unknown as ReturnType<typeof createAdminClient>,reads}
}
describe("shared ZATCA source and retained preparation retries",()=>{
 it("loads finalized invoice lines for an offline dry run",async()=>{
  const db=database();const source=await loadZatcaSourceDocument(db.client,"tenant-id","invoice","invoice-id")
  expect(source).toMatchObject({invoiceId:"invoice-id",docRef:"INV-1",total:115,lines:[{item_name:"Service",description:"Delivery"}]})
  expect(db.reads.map(x=>x.table)).toEqual(["invoices","invoice_lines"])
 })
 it.each(["paid","partially_paid","overdue"])("skips %s without an exact existing preparation environment",async status=>{
  const db=database({status,prepared:true});expect(await loadZatcaSourceDocument(db.client,"tenant-id","invoice","invoice-id")).toBe("skipped")
  expect(db.reads.map(x=>x.table)).toEqual(["invoices"])
 })
 it.each(["paid","partially_paid","overdue"])("allows %s to reuse only its retained exact-environment preparation",async status=>{
  const db=database({status,prepared:true});expect(await loadZatcaSourceDocument(db.client,"tenant-id","invoice","invoice-id",{existingPreparationEnvironment:"simulation"})).toMatchObject({invoiceId:"invoice-id"})
  expect(db.reads[1]).toEqual({table:"zatca_document_issuances",filters:[["tenant_id","tenant-id"],["environment","simulation"],["source_type","invoice"],["source_id","invoice-id"]]})
 })
 it("never creates a new identity for a paid invoice lacking retained preparation",async()=>{
  const db=database({status:"paid"});expect(await loadZatcaSourceDocument(db.client,"tenant-id","invoice","invoice-id",{existingPreparationEnvironment:"simulation"})).toBe("skipped")
  expect(db.reads).toHaveLength(2)
 })
 it("fails rather than treating an unreadable preparation as absent",async()=>{
  const db=database({status:"paid",preparationError:true});expect(await loadZatcaSourceDocument(db.client,"tenant-id","invoice","invoice-id",{existingPreparationEnvironment:"simulation"})).toBe("failed")
 })
 it("reports source read errors as failure rather than skipped documents",async()=>{
  expect(await loadZatcaSourceDocument(database({invoiceError:true}).client,"tenant-id","invoice","invoice-id")).toBe("failed")
  expect(await loadZatcaSourceDocument(database({noteError:true}).client,"tenant-id","credit_note","note-id")).toBe("failed")
 })
 it.each(["credit_note","debit_note"] as const)("requires a readable same-tenant original invoice for %s",async type=>{
  for(const config of [{referenceError:true},{missingReference:true}])expect(await loadZatcaSourceDocument(database(config).client,"tenant-id",type,"note-id")).toBe("failed")
  const db=database();expect(await loadZatcaSourceDocument(db.client,"tenant-id",type,"note-id")).toMatchObject({referenceInvoiceNumber:"INV-1",invoiceId:"invoice-id"})
  expect(db.reads[1].filters).toContainEqual(["tenant_id","tenant-id"])
 })
})
