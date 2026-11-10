import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), requirePermission: vi.fn(), getCurrentUser: vi.fn(), revalidatePath: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: mocks.requirePermission, getCurrentUser: mocks.getCurrentUser }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }))
import { archiveDriverProfileOperation, saveDriverProfileOperation } from "./actions"
const driver="95000000-0000-4000-8000-000000000001", id="95000000-0000-4000-8000-000000000002", updated="2026-10-21T00:00:00+00:00"
beforeEach(() => { vi.clearAllMocks(); mocks.getCurrentUser.mockResolvedValue({tenantId:"own"}); mocks.rpc.mockResolvedValue({data:{id,updated_at:updated},error:null}); mocks.requirePermission.mockResolvedValue(undefined) })
describe("driver operational server action boundary", () => {
  it("passes Saudi timestamps through caller-bound RPC without client ownership", async () => {
    const result=await saveDriverProfileOperation("attendance",driver,{ attendance_date:"2026-10-21",status:"present",check_in_time:"00:15",tenant_id:"foreign" })
    expect(result.success).toBe(true)
    expect(mocks.requirePermission).toHaveBeenCalledWith("attendance","create")
    expect(mocks.rpc).toHaveBeenCalledWith("save_driver_profile_operation",{p_surface:"attendance",p_driver_id:driver,p_id:null,p_expected_updated_at:null,p_input:{attendance_date:"2026-10-21",status:"present",check_in_time:"2026-10-20T21:15:00.000Z",check_out_time:null,late_minutes:0,overtime_minutes:0}})
  })
  it("does not write on missing authentication, denied permission, or invalid values", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null)
    expect((await saveDriverProfileOperation("training",driver,{})).success).toBe(false)
    mocks.requirePermission.mockRejectedValueOnce(new Error("Denied"))
    expect((await saveDriverProfileOperation("training",driver,{})).error).toBe("Denied")
    expect((await saveDriverProfileOperation("training",driver,{course_name:"Safety",training_date:"2026-02-30"})).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("does not report success for an RLS, lock, stale-write or zero-row failure", async () => {
    for(const error of [{message:"PAY_PREPARATION_LOCKED"},{message:"OPS005: record changed; reload before saving"},null]) {
      mocks.rpc.mockResolvedValueOnce({data:null,error})
      expect((await saveDriverProfileOperation("training",driver,{course_name:"Safety",training_date:"2026-10-21"},id,updated)).success).toBe(false)
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
  it("checks delete permission and stale token for archive", async () => {
    expect((await archiveDriverProfileOperation("training",driver,id,updated)).success).toBe(true)
    expect(mocks.requirePermission).toHaveBeenCalledWith("hr","delete")
    expect(mocks.rpc).toHaveBeenCalledWith("archive_driver_profile_operation",{p_surface:"training",p_driver_id:driver,p_id:id,p_expected_updated_at:updated})
    mocks.rpc.mockClear()
    expect((await archiveDriverProfileOperation("training",driver,id,"")).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
