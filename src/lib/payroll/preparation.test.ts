import { describe, it, expect, beforeEach, vi } from "vitest"
import { advanceSchema, attendancePreparationSchema, assertExplicitPayrollRule, periodBasisSchema, ruleSchema } from "./preparation-schema"
const driverId="10101010-1010-4010-8010-101010101010"
const explicit={driverId,category:"sponsored_type1",effectiveDate:"2026-02-01",workingDaysTarget:24,targetOrders:300,baseSalary:2700,bonusRate:0,deductionRate:0,minimumNetFloor:0,note:"Owner reviewed"}
describe("payroll preparation contract",()=>{
 it("requires explicit category amounts and keeps explicit zero rates",()=>{expect(ruleSchema.parse(explicit).bonusRate).toBe(0);expect(ruleSchema.safeParse({...explicit,baseSalary:undefined}).success).toBe(false)})
 it("requires package and rent values for type2",()=>{expect(ruleSchema.safeParse({...explicit,category:"sponsored_type2"}).success).toBe(false);expect(ruleSchema.safeParse({...explicit,category:"sponsored_type2",packageAmount:3000,thresholdOrders:0,carRentDeduction:0}).success).toBe(true)})
 it("requires freelancer caps instead of interpreting blanks",()=>{expect(ruleSchema.safeParse({...explicit,category:"freelancer"}).success).toBe(false)})
 it.each([Number.NaN,Infinity,-1,1.001])("rejects invalid money %s",value=>{expect(ruleSchema.safeParse({...explicit,baseSalary:value}).success).toBe(false)})
 it("requires the exact calendar, including leap days",()=>{const days=Array.from({length:29},(_,i)=>({date:`2028-02-${String(i+1).padStart(2,"0")}`,status:"day_off"}));const full={year:2028,month:2,driverId,expectedVersion:0,days,note:"Reviewed day off"};expect(attendancePreparationSchema.safeParse(full).success).toBe(true);expect(attendancePreparationSchema.safeParse({...full,days:days.slice(0,28)}).success).toBe(false);expect(attendancePreparationSchema.safeParse({...full,days:[...days.slice(0,28),days[0]]}).success).toBe(false)})
 it("refuses missing engine values in old rules",()=>{expect(()=>assertExplicitPayrollRule({category:"sponsored_type1",base_salary:2000},"sponsored_type1")).toThrow("PAY_RULE_INCOMPLETE")})
 it("requires advance cents, versions, and a repayment month after advance",()=>{const base={requestId:driverId,driverId,amount:1.23,advanceDate:"2026-01-31",repaymentMonth:"2026-02",reason:"Driver request"};expect(advanceSchema.safeParse(base).success).toBe(true);expect(advanceSchema.safeParse({...base,amount:1.234}).success).toBe(false);expect(advanceSchema.safeParse({...base,id:driverId}).success).toBe(false);expect(advanceSchema.safeParse({...base,repaymentMonth:"2025-12"}).success).toBe(false)})
})
const mock=vi.hoisted(()=>({rpc:vi.fn(async()=>({data:{id:driverId},error:null})),permission:vi.fn(async()=>undefined),current:vi.fn(async()=>({id:"profile",authUserId:"auth",tenantId:"tenant"})),limit:vi.fn(async()=>({success:true}))}))
vi.mock("@/lib/auth/authorization",()=>({requirePermission:mock.permission,getCurrentUser:mock.current}))
vi.mock("@/lib/auth/rate-limit",()=>({rateLimitPayroll:mock.limit}))
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:mock.rpc})}))
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}))
import {savePayrollRule,savePayrollAdvance,transitionPayrollAdvance,savePayrollAttendance,savePayrollPeriodBasis} from "./preparation-actions"
beforeEach(()=>{vi.clearAllMocks();mock.permission.mockResolvedValue(undefined);mock.current.mockResolvedValue({id:"profile",authUserId:"auth",tenantId:"tenant"});mock.limit.mockResolvedValue({success:true});mock.rpc.mockResolvedValue({data:{id:driverId},error:null})})
describe("caller-bound preparation actions",()=>{
 it("never calls persistence when permission is denied",async()=>{mock.permission.mockRejectedValue(new Error("Forbidden"));expect((await savePayrollRule(explicit)).success).toBe(false);expect(mock.rpc).not.toHaveBeenCalled()})
 it("never calls persistence without auth/MFA",async()=>{mock.current.mockResolvedValue(null as never);expect((await savePayrollRule(explicit)).success).toBe(false);expect(mock.rpc).not.toHaveBeenCalled()})
 it("sends no tenant, actor, or service client identity supplied by browser",async()=>{expect((await savePayrollRule({...explicit,tenantId:"forged",actorId:"forged"})).success).toBe(true);const args=mock.rpc.mock.calls[0] as unknown as [string,{p_payload:Record<string,unknown>}];expect(args[0]).toBe("payroll_preparation_mutate");expect(args[1].p_payload).not.toHaveProperty("tenantId");expect(args[1].p_payload).not.toHaveProperty("actorId")})
 it("refuses missing attendance instead of manufacturing days",async()=>{expect((await savePayrollAttendance({year:2026,month:2,driverId,expectedVersion:0,days:[],note:"Reviewed input"})).success).toBe(false);expect(mock.rpc).not.toHaveBeenCalled()})
 it("requires approve permission for advance approval and repayment",async()=>{await transitionPayrollAdvance({id:driverId,expectedVersion:1,to:"approved",note:"Owner approval"});expect(mock.permission).toHaveBeenCalledWith("payroll","approve")})
 it("does not use the expense advance writer",async()=>{await savePayrollAdvance({requestId:driverId,driverId,amount:100,advanceDate:"2026-01-01",repaymentMonth:"2026-02",reason:"Driver request"});expect(mock.rpc).toHaveBeenCalledWith("payroll_preparation_mutate",expect.objectContaining({p_action:"advance_save"}))})
})

const reviewedBasis={year:2026,month:2,driverId,expectedVersion:0,ruleId:driverId,ruleVersion:1,employedFrom:"2026-02-28",employedTo:"2026-02-28",periodBaseAmount:123.45,periodOrderTarget:1,periodAbsenceDeduction:0,periodMinimumFloor:0,ratesAcknowledged:true,note:"Owner reviewed one day"}
describe("reviewed employed interval",()=>{
 it("accepts one employed date and does not require invented days off",()=>{
  expect(attendancePreparationSchema.safeParse({year:2026,month:2,driverId,expectedVersion:0,employedFrom:"2026-02-28",employedTo:"2026-02-28",days:[{date:"2026-02-28",status:"present"}],note:"Reviewed one day"}).success).toBe(true)
 })
 it("refuses attendance outside declared employed dates",()=>{
  expect(attendancePreparationSchema.safeParse({year:2026,month:2,driverId,expectedVersion:0,employedFrom:"2026-02-28",employedTo:"2026-02-28",days:[{date:"2026-02-27",status:"present"}],note:"Reviewed one day"}).success).toBe(false)
 })
 it("requires explicit period money, target and rate acknowledgement",()=>{
  expect(periodBasisSchema.safeParse(reviewedBasis).success).toBe(true)
  for(const key of ["periodBaseAmount","periodOrderTarget","periodAbsenceDeduction","periodMinimumFloor","ratesAcknowledged"]) expect(periodBasisSchema.safeParse({...reviewedBasis,[key]:undefined}).success).toBe(false)
  expect(periodBasisSchema.safeParse({...reviewedBasis,ratesAcknowledged:false}).success).toBe(false)
 })
 it.each([NaN,Infinity,-1,1.001])("rejects invalid reviewed money %s",amount=>{expect(periodBasisSchema.safeParse({...reviewedBasis,periodBaseAmount:amount}).success).toBe(false)})
 it("requires approved period dates within the requested month",()=>{
  expect(periodBasisSchema.safeParse({...reviewedBasis,employedFrom:"2026-03-01"}).success).toBe(false)
  expect(periodBasisSchema.safeParse({...reviewedBasis,employedTo:"2026-02-27"}).success).toBe(false)
 })
 it("sends reviewed basis through approval permission and strips forged identity",async()=>{
  expect((await savePayrollPeriodBasis({...reviewedBasis,tenantId:"forged",actorId:"forged"})).success).toBe(true)
  expect(mock.permission).toHaveBeenCalledWith("payroll","approve")
  expect(mock.rpc).toHaveBeenCalledWith("payroll_preparation_mutate",{p_action:"basis_save",p_payload:reviewedBasis})
 })
 it("does not call persistence for unacknowledged or missing period values",async()=>{
  expect((await savePayrollPeriodBasis({...reviewedBasis,ratesAcknowledged:false})).success).toBe(false)
  expect(mock.rpc).not.toHaveBeenCalled()
 })
})
