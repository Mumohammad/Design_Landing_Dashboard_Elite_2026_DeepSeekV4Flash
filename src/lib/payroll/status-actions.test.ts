import { beforeEach, describe, it, expect, vi } from "vitest"
const mock=vi.hoisted(()=>({permission:vi.fn(),current:vi.fn(),limit:vi.fn(),rpc:vi.fn(),emit:vi.fn(),revalidate:vi.fn()}))
vi.mock("@/lib/auth/authorization",()=>({requirePermission:mock.permission,getCurrentUser:mock.current}))
vi.mock("@/lib/auth/rate-limit",()=>({rateLimitPayroll:mock.limit}))
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:mock.rpc})}))
vi.mock("@/lib/webhooks/events",()=>({emit:mock.emit}))
vi.mock("next/cache",()=>({revalidatePath:mock.revalidate}))
import {transitionPayrollStatus} from "./status-actions"
const periodId="a9500000-0000-4000-8000-000000000008"
beforeEach(()=>{vi.clearAllMocks();mock.permission.mockResolvedValue(undefined);mock.current.mockResolvedValue({id:"profile",tenantId:"tenant"});mock.limit.mockResolvedValue({success:true});mock.rpc.mockResolvedValue({data:{id:periodId,period_year:2026,period_month:2,net_payroll:123.45},error:null})})
describe("caller-bound payroll status action",()=>{
 it.each(["approved","paid"])("requires the approval permission for %s",async to=>{expect((await transitionPayrollStatus({periodId,to})).success).toBe(true);expect(mock.permission).toHaveBeenCalledExactlyOnceWith("payroll","approve")})
 it("requires update for cancellation and sends reason to the single atomic RPC",async()=>{await transitionPayrollStatus({periodId,to:"cancelled",reason:"Owner reviewed correction",tenantId:"forged",actorId:"forged"});expect(mock.permission).toHaveBeenCalledExactlyOnceWith("payroll","update");expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("transition_payroll_status_atomic",{p_id:periodId,p_to:"cancelled",p_reason:"Owner reviewed correction",p_surface:"payroll"})})
 it("does not persist without permission",async()=>{mock.permission.mockRejectedValue(new Error("Forbidden"));expect((await transitionPayrollStatus({periodId,to:"approved"})).success).toBe(false);expect(mock.rpc).not.toHaveBeenCalled()})
 it("does not persist without a verified caller",async()=>{mock.current.mockResolvedValue(null);expect((await transitionPayrollStatus({periodId,to:"approved"})).success).toBe(false);expect(mock.rpc).not.toHaveBeenCalled()})
 it("does not persist when rate-limited",async()=>{mock.limit.mockResolvedValue({success:false});expect((await transitionPayrollStatus({periodId,to:"paid"})).success).toBe(false);expect(mock.rpc).not.toHaveBeenCalled()})
 it("does not accept an invalid state",async()=>{expect((await transitionPayrollStatus({periodId,to:"deleted"})).success).toBe(false);expect(mock.rpc).not.toHaveBeenCalled()})
 it("does not announce a failed database approval",async()=>{mock.rpc.mockResolvedValue({data:null,error:{message:"PAY_ADVANCE_SNAPSHOT_CHANGED"}});expect(await transitionPayrollStatus({periodId,to:"approved"})).toEqual({success:false,error:"PAY_ADVANCE_SNAPSHOT_CHANGED"});expect(mock.emit).not.toHaveBeenCalled();expect(mock.revalidate).not.toHaveBeenCalled()})
 it("announces committed approval with actual persisted totals",async()=>{await transitionPayrollStatus({periodId,to:"approved",surface:"approvals_inbox"});expect(mock.emit).toHaveBeenCalledWith("payroll.approved","tenant",{id:periodId,period:"2026-02",totalAmount:123.45,approvedBy:"profile"});expect(mock.revalidate).toHaveBeenCalledWith("/approvals")})
})
