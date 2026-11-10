import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn(), client: vi.fn(), admin: vi.fn() }))
vi.mock("@/lib/auth/authorization", () => ({ getCurrentUser: mocks.user }))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }))
import { fetchApprovalsPage } from "./queries"
const id = "92000000-0000-4000-8000-000000000001"
const row = { item_type: "expense", item_id: id, subject: "EXP-1", subject_meta: {}, requester: "Vendor", requested_at: "2026-10-20T12:00:00+00:00" }
const result = () => ({ rows: [row], kpis: { total: 1, expenses: 1, leaves: 0, applications: 0, stale: 0 }, page: 1, pageSize: 50, totalPages: 1 })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ tenantId: "session-tenant" })
  mocks.client.mockResolvedValue({ rpc: mocks.rpc })
  mocks.rpc.mockResolvedValue({ data: result(), error: null })
})
describe("approval queue server boundary", () => {
  it("uses the session client/tenant, literal search and Saudi date bounds without a roster read", async () => {
    await fetchApprovalsPage({ type: "expense", search: '  %_,"أحمد  ', from: "2026-10-01", to: "2026-10-20", ...{tenantId:"spoof"} })
    expect(mocks.rpc).toHaveBeenCalledWith("fetch_pending_approvals_page", {
      p_tenant_id:"session-tenant",p_type:"expense",p_search:'%_,"أحمد',
      p_from:"2026-10-01T00:00:00+03:00",p_to:"2026-10-20T23:59:59.999+03:00",p_page:1,p_page_size:50,
    })
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it("accepts a genuine empty queue and a server-clamped last page", async () => {
    mocks.rpc.mockResolvedValue({data:{...result(),rows:[],kpis:{total:0,expenses:0,leaves:0,applications:0,stale:0}},error:null})
    expect((await fetchApprovalsPage({},50,99)).rows).toEqual([])
    mocks.rpc.mockResolvedValue({data:{...result(),page:2,kpis:{...result().kpis,total:51,expenses:51},totalPages:2},error:null})
    expect((await fetchApprovalsPage({},50,99)).page).toBe(2)
  })
  it("whitelists and masks applicant data before serialization without inferred consent", async () => {
    mocks.rpc.mockResolvedValue({data:{...result(),rows:[{...row,item_type:"application",requester:"Raw Name",subject:"APP-1",subject_meta:{full_name:"Ahmed Saleh",city:"Riyadh",vendor:"Raw Name",reason:"Private reason",mobile:"0500000000",identity_number:"secret"}}],kpis:{...result().kpis,expenses:0,applications:1}},error:null})
    const data=await fetchApprovalsPage()
    expect(data.rows[0]).toEqual({id:`application:${id}`,item_type:"application",item_id:id,subject:"APP-1",requester:"",requested_at:row.requested_at,subject_meta:{full_name:"A. S.",city:"Riyadh"}})
    expect(JSON.stringify(data)).not.toMatch(/Ahmed|Saleh|Raw Name|Private reason|0500000000|secret|requesterOptions/)
  })
  it.each([null, {}, {...result(),rows:[]}, {...result(),kpis:{...result().kpis,total:2}}, {...result(),page:2}, {...result(),pageSize:100}, {...result(),totalPages:2}, {...result(),kpis:{...result().kpis,stale:2}}, {...result(),rows:[{...row,item_id:"unsafe"}]}])("rejects incomplete/malformed queue responses", async payload => {
    mocks.rpc.mockResolvedValue({data:payload,error:null})
    await expect(fetchApprovalsPage()).rejects.toThrow("Could not load the approvals queue")
  })
  it("does not convert provider failures or expired sessions into a successful empty queue", async () => {
    const log=vi.spyOn(console,"error").mockImplementation(()=>{})
    try {
      mocks.rpc.mockResolvedValue({data:null,error:{message:"personal provider detail"}})
      await expect(fetchApprovalsPage()).rejects.toThrow(/^Could not load the approvals queue$/)
      expect(log).not.toHaveBeenCalled()
      mocks.user.mockResolvedValue(null)
      mocks.rpc.mockClear()
      await expect(fetchApprovalsPage()).rejects.toThrow("Could not load the approvals queue")
      expect(mocks.rpc).not.toHaveBeenCalled()
    } finally { log.mockRestore() }
  })
  it.each([{type:"unsupported"},{search:"x".repeat(201)},{from:"2026-02-30"},{from:"2026-10-20",to:"2026-10-01"}])("rejects bad filters before the database", async input => {
    await expect(fetchApprovalsPage(input as never)).rejects.toThrow("Could not load the approvals queue")
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("normalizes nonfinite and excessive page arguments", async () => {
    await fetchApprovalsPage({},NaN,Infinity)
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({p_page:1,p_page_size:50})
    mocks.rpc.mockResolvedValue({data:{...result(),pageSize:100},error:null})
    await fetchApprovalsPage({},9999,Number.MAX_VALUE)
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({p_page:2147483647,p_page_size:100})
  })
})
