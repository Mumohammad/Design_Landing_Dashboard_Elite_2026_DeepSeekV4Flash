import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { readClaimDisplayNames, readCompleteAttachments, readCompleteClaims } from "./complete-reads"

function fixture({total=0,cap=500,errorPage=-1,countChange=false,foreign=false}={}) {
 let pages=0
 const reads:Array<{table:string; select:string; ids:string[]; filters:unknown[][]; orders:string[]}>=[]
 const client={from(table:string){
  const read={table,select:"",ids:[] as string[],filters:[] as unknown[][],orders:[] as string[]};reads.push(read)
  const query={
   select(columns:string){read.select=columns;return query},
   eq(...values:unknown[]){read.filters.push(values);return query},is(...values:unknown[]){read.filters.push(values);return query},
   in(_key:string,ids:string[]){read.ids=ids;return query},order(key:string){read.orders.push(key);return query},
   async range(from:number,to:number){
    const page=pages++
    if(page===errorPage)return{data:null,error:{message:"private database detail"},count:null}
    const data=Array.from({length:Math.min(cap,to-from+1,Math.max(0,total-from))},(_,i)=>({id:String(from+i),claim_id:foreign?"foreign-id":read.ids[0],auth_user_id:foreign?"foreign-id":read.ids[0],full_name_en:"Visible actor"}))
    return{data,error:null,count:countChange&&page>0?total+1:total}
   },
   then:Promise.resolve({data:[],error:null,count:total}).then,
  };return query
 }}
 return{client:client as unknown as SupabaseClient,reads}
}
describe("complete expense reads",()=>{
 it("reads every row past the former 20,000 cap with stable ID ordering",async()=>{
  const db=fixture({total:20001});const rows=await readCompleteClaims(db.client)
  expect(rows).toHaveLength(20001);expect(rows[rows.length - 1]?.id).toBe("20000")
  expect(db.reads.every(read=>read.orders.join(',')==='expense_date,created_at,id')).toBe(true)
 })
 it("handles API caps below the requested page size",async()=>{
  expect(await readCompleteClaims(fixture({total:1201,cap:123}).client)).toHaveLength(1201)
 })
 it("rejects a failed later page and changed count rather than returning partial claims",async()=>{
  await expect(readCompleteClaims(fixture({total:800,errorPage:1}).client)).rejects.toThrow('no partial file')
  await expect(readCompleteClaims(fixture({total:800,countChange:true}).client)).rejects.toThrow('changed')
 })
 it("rejects an explicit excessive export budget rather than silently truncating",async()=>{
  await expect(readCompleteClaims(fixture({total:100001}).client)).rejects.toThrow('100,000')
 })
 it("collects all receipt attachments beyond a backend page cap",async()=>{
  const db=fixture({total:1601,cap:97});expect(await readCompleteAttachments(db.client,['claim-id'])).toHaveLength(1601)
  expect(db.reads.every(read=>read.ids.join(',')==='claim-id'&&read.orders.join(',')==='id')).toBe(true)
 })
 it("distinguishes empty evidence from failed evidence and rejects foreign scope",async()=>{
  expect(await readCompleteAttachments(fixture().client,['claim-id'])).toEqual([])
  await expect(readCompleteAttachments(fixture({total:1,errorPage:0}).client,['claim-id'])).rejects.toThrow()
  await expect(readCompleteAttachments(fixture({total:1,foreign:true}).client,['claim-id'])).rejects.toThrow('scope')
 })
 it("restricts privileged display lookups to known tenant and actor IDs, without email",async()=>{
  const db=fixture({total:1});expect(await readClaimDisplayNames(db.client,'tenant-id',['actor-id','actor-id'])).toEqual({'actor-id':'Visible actor'})
  expect(db.reads).toHaveLength(1);expect(db.reads[0].filters).toEqual([['tenant_id','tenant-id'],['deleted_at',null]])
  expect(db.reads[0].ids).toEqual(['actor-id']);expect(db.reads[0].select).not.toContain('email')
 })
 it("does not open a directory request for no actors; rejects unexpected identities",async()=>{
  const db=fixture();expect(await readClaimDisplayNames(db.client,'tenant-id',[])).toEqual({});expect(db.reads).toHaveLength(0)
  await expect(readClaimDisplayNames(fixture({total:1,foreign:true}).client,'tenant-id',['actor-id'])).rejects.toThrow('identity')
 })
})
