import { beforeEach,describe,expect,it,vi } from "vitest"
const f=vi.hoisted(()=>({rpc:vi.fn(),client:vi.fn(),permission:vi.fn(),user:vi.fn(),limit:vi.fn(),audit:vi.fn(),revalidate:vi.fn()}))
vi.mock("@/lib/supabase/server",()=>({createClient:f.client}))
vi.mock("@/lib/auth/authorization",()=>({requirePermission:f.permission,getCurrentUser:f.user}))
vi.mock("@/lib/auth/rate-limit",()=>({rateLimitOrders:f.limit}))
vi.mock("@/lib/auth/sessions",()=>({writeAuditLog:f.audit}))
vi.mock("next/cache",()=>({revalidatePath:f.revalidate}))
import {createOrderEntry,updateOrderEntry,deleteOrderEntry,listOrderEntries,exportOrdersCsv} from "./actions"
const id="13500000-0000-4000-8000-000000000011",stamp="2026-10-22T12:00:00.000Z"
const input={driver_id:id,platform_id:"13500000-0000-4000-8000-000000000021",entry_date:"2098-11-15",orders_delivered:5,gross_revenue:12.25}
beforeEach(()=>{vi.clearAllMocks();f.permission.mockResolvedValue(undefined);f.user.mockResolvedValue({id:"app-user",tenantId:"tenant",authUserId:"auth"});f.limit.mockResolvedValue({success:true});f.client.mockResolvedValue({rpc:f.rpc});f.rpc.mockResolvedValue({data:{id,updated_at:stamp},error:null});f.audit.mockResolvedValue(undefined)})
describe("Orders caller-bound actions",()=>{
 it("sends parsed creation to session-bound RPC and refreshes preparation",async()=>{expect(await createOrderEntry({...input,tenant_id:"foreign"} as typeof input)).toMatchObject({success:true,id});expect(f.rpc).toHaveBeenCalledWith("save_order_entry",{p_input:input,p_id:null,p_expected_updated_at:null});expect(f.revalidate).toHaveBeenCalledWith("/payroll/preparation")})
 it("requires update permission and sends concurrency token",async()=>{await updateOrderEntry(id,stamp,input);expect(f.permission).toHaveBeenCalledWith("platforms","update");expect(f.rpc).toHaveBeenCalledWith("save_order_entry",expect.objectContaining({p_id:id,p_expected_updated_at:stamp}))})
 it("requires archive version and uses archive RPC",async()=>{await deleteOrderEntry(id,stamp);expect(f.permission).toHaveBeenCalledWith("platforms","delete");expect(f.rpc).toHaveBeenCalledWith("archive_order_entry",{p_id:id,p_expected_updated_at:stamp})})
 it("denies before database access",async()=>{f.permission.mockRejectedValue(new Error("Denied"));expect(await createOrderEntry(input)).toMatchObject({success:false,error:"Denied"});expect(f.client).not.toHaveBeenCalled()})
 it("rejects unauthenticated mutation before client",async()=>{f.user.mockResolvedValue(null);expect((await createOrderEntry(input)).success).toBe(false);expect(f.client).not.toHaveBeenCalled()})
 it("enforces rate limit before database call",async()=>{f.limit.mockResolvedValue({success:false});expect((await updateOrderEntry(id,stamp,input)).success).toBe(false);expect(f.rpc).not.toHaveBeenCalled()})
 it.each([{entry_date:"2098-02-31"},{orders_delivered:1.5},{orders_failed:-1},{gross_revenue:1.001},{platform_id:"foreign"}])("rejects invalid source input %j",async invalid=>{expect((await createOrderEntry({...input,...invalid})).success).toBe(false);expect(f.rpc).not.toHaveBeenCalled()})
 it("does not refresh a rejected locked change",async()=>{f.rpc.mockResolvedValue({data:null,error:{message:"PAY_PREPARATION_LOCKED"}});expect(await deleteOrderEntry(id,stamp)).toMatchObject({success:false,error:"PAY_PREPARATION_LOCKED"});expect(f.revalidate).not.toHaveBeenCalled()})
 it("rejects stale token format before RPC",async()=>{expect((await deleteOrderEntry(id,"not-a-date")).success).toBe(false);expect(f.rpc).not.toHaveBeenCalled()})
 it("returns explicit failed read instead of successful empty data",async()=>{f.rpc.mockResolvedValue({data:null,error:{message:"Database unavailable"}});expect(await listOrderEntries("2098-11")).toMatchObject({success:false,error:"Database unavailable",rows:[]})})
 it("delegates whole-period filtering and paging",async()=>{f.rpc.mockResolvedValue({data:{rows:[],total:1101,summary:{delivered:2202,failed:1101,revenue:3578.25}},error:null});expect((await listOrderEntries("2098-11","fixture",23,50)).total).toBe(1101);expect(f.rpc).toHaveBeenCalledWith("list_order_entries",{p_month:"2098-11",p_search:"fixture",p_page:23,p_page_size:50})})
 it("exports complete1101-row snapshot with safe CSV cells",async()=>{const row={...input,id,shift_label:null,driver:{full_name_en:"=DANGEROUS()"},platform:{name_en:"Fixture"},orders_failed:0,orders_returned:0,orders_cancelled:0,total_distance_km:null,platform_reported_revenue:null,revenue_variance:0,is_locked:false};f.rpc.mockResolvedValue({data:Array.from({length:1101},()=>row),error:null});const result=await exportOrdersCsv("2098-11");expect(result.success).toBe(true);expect(result.csv?.split("\n")).toHaveLength(1102);expect(result.csv).toContain("\t=DANGEROUS()");expect(f.rpc).toHaveBeenCalledWith("export_order_entries",{p_month:"2098-11"});expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({newValues:{month:"2098-11",rows:1101}}))})
 it("does not publish CSV when the complete snapshot fails",async()=>{f.rpc.mockResolvedValue({data:null,error:{message:"Database unavailable"}});expect((await exportOrdersCsv("2098-11")).success).toBe(false);expect(f.audit).not.toHaveBeenCalled()})
})
