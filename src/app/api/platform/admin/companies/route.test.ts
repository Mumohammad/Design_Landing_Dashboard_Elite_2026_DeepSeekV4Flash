import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const m=vi.hoisted(()=>({allowed:true,rows:{} as Record<string,Record<string,unknown>[]>,fail:'',throwRead:false,ranges:[] as {table:string;from:number;to:number}[],orders:[] as {table:string;key:string}[],from:vi.fn()}))
vi.mock('@/lib/platform/admin-guard',()=>({verifyPlatformAdmin:async()=>m.allowed?{ok:true,service:{from:m.from},userId:'16000000-0000-4000-8000-000000000001'}:{ok:false,status:403}}))
import { GET } from './route'
type Result={data:Record<string,unknown>[]|null;error:{message:string}|null}
interface Chain extends PromiseLike<Result>{select:()=>Chain;is:()=>Chain;order:(key:string)=>Chain;range:(from:number,to:number)=>Promise<Result>}
const req=()=>new NextRequest('https://example.test/api/platform/admin/companies')
const id=(n:number)=>'16000000-0000-4000-8000-'+String(n).padStart(12,'0')
beforeEach(()=>{vi.clearAllMocks();m.allowed=true;m.rows={tenants:[],users:[]};m.fail='';m.throwRead=false;m.ranges=[];m.orders=[];m.from.mockImplementation((table:string)=>{const page=(from:number,to:number):Result=>({data:m.fail===table?null:(m.rows[table]??[]).slice(from,to+1),error:m.fail===table?{message:'PRIVATE database detail'}:null});const initial=Promise.resolve(page(0,999));const chain:Chain={select:()=>chain,is:()=>chain,order:(key)=>{m.orders.push({table,key});return chain},range:async(from,to)=>{if(m.throwRead)throw Error('PRIVATE transport detail');m.ranges.push({table,from,to});return page(from,to)},then:initial.then.bind(initial)};return chain})})
describe('complete platform company reads',()=>{
 it('guards before any privileged query',async()=>{m.allowed=false;expect((await GET(req())).status).toBe(403);expect(m.from).not.toHaveBeenCalled()})
 it('returns every company and complete user counts beyond the Data API page cap',async()=>{m.rows.tenants=Array.from({length:1001},(_,i)=>({id:id(i+1),name_en:'Synthetic '+i,name_ar:null,status:'active',created_at:'2026-10-27T00:00:00Z'}));m.rows.users=Array.from({length:2050},(_,i)=>({tenant_id:i<1000?id(1):id(1001)}));const response=await GET(req());expect(response.status).toBe(200);const body=await response.json();expect(body.companies).toHaveLength(1001);expect(body.companies.at(-1)).toMatchObject({id:id(1001),users_count:1050});expect(m.ranges).toContainEqual({table:'tenants',from:1000,to:1999});expect(m.ranges).toContainEqual({table:'users',from:2000,to:2999});expect(m.orders).toContainEqual({table:'tenants',key:'id'});expect(m.orders).toContainEqual({table:'users',key:'id'})})
 it.each(['tenants','users'])('fails visibly instead of returning partial counts when %s fails',async(table)=>{m.fail=table;const response=await GET(req());expect(response.status).toBe(503);const text=await response.text();expect(text).not.toContain('PRIVATE');expect(text).not.toContain('companies')})
 it('handles an unavailable query without exposing transport details',async()=>{m.throwRead=true;const response=await GET(req());expect(response.status).toBe(503);expect(await response.text()).not.toContain('PRIVATE')})
})
