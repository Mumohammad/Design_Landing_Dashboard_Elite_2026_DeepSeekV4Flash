import { describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { documentDriverNeedle, readDocumentDriver, searchDocumentDrivers } from "./document-quick-read"
function fixture(data: unknown, error: unknown = null) {
 const calls: unknown[][] = []
 const client={from(table:string){calls.push(['from',table]);const q={
  select(fields:string){calls.push(['select',fields]);return q},eq(...args:unknown[]){calls.push(['eq',...args]);return q},is(...args:unknown[]){calls.push(['is',...args]);return q},
  or(value:string){calls.push(['or',value]);return q},order(value:string){calls.push(['order',value]);return q},limit(value:number){calls.push(['limit',value]);return q},
  abortSignal(signal:AbortSignal){calls.push(['signal',signal]);return q},maybeSingle:async()=>({data,error}),then(resolve:(value:{data:unknown;error:unknown})=>unknown){return Promise.resolve({data,error}).then(resolve)},
 };return q}}
 return{client:client as unknown as SupabaseClient,calls}
}
describe('driver document quick picker boundaries',()=>{
 it('reads current driver version and forwards an abort signal',async()=>{
  const db=fixture({id:'driver-id',full_name_en:'Driver',profile_version:7}),signal=new AbortController().signal
  expect(await readDocumentDriver(db.client,'driver-id',signal)).toEqual({driverId:'driver-id',version:7,name:'Driver'})
  expect(db.calls).toContainEqual(['eq','id','driver-id']);expect(db.calls).toContainEqual(['is','deleted_at',null]);expect(db.calls).toContainEqual(['signal',signal])
 })
 it.each([null,{id:'other',profile_version:1},{id:'driver-id',profile_version:null},{id:'driver-id',profile_version:0},{id:'driver-id',profile_version:1.5},{id:'driver-id',profile_version:'1'}])('never invents a version or accepts a different/missing driver',async data=>{
  await expect(readDocumentDriver(fixture(data).client,'driver-id',new AbortController().signal)).rejects.toThrow('unavailable')
 })
 it('database selection failure is not a successful empty read',async()=>{
  await expect(readDocumentDriver(fixture(null,{message:'private-detail'}).client,'driver-id',new AbortController().signal)).rejects.toThrow('Driver is unavailable')
 })
 it('short searches open no database request',async()=>{
  const db=fixture([]);expect(await searchDocumentDrivers(db.client,'a',new AbortController().signal)).toEqual([]);expect(db.calls).toEqual([])
 })
 it('failed search is distinct from an actual empty result',async()=>{
  const signal=new AbortController().signal
  await expect(searchDocumentDrivers(fixture(null,{message:'private-detail'}).client,'Driver',signal)).rejects.toThrow('Driver search is unavailable')
  expect(await searchDocumentDrivers(fixture([]).client,'Driver',signal)).toEqual([])
 })
 it('bounds and normalizes query syntax, uses deterministic result ordering',async()=>{
  expect(documentDriverNeedle('x'.repeat(1000))).toHaveLength(200)
  expect(documentDriverNeedle('a%,()*\\"b')).toBe('a       b')
  const db=fixture([{id:'driver-id'}]),signal=new AbortController().signal
  expect(await searchDocumentDrivers(db.client,'Driver',signal)).toEqual([{id:'driver-id'}])
  expect(db.calls.filter(call=>call[0]==='order')).toEqual([['order','full_name_en'],['order','id']]);expect(db.calls).toContainEqual(['signal',signal]);expect(db.calls).toContainEqual(['limit',10])
 })
})
