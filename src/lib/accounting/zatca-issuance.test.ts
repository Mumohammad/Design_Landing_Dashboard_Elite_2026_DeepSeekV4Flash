import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { genesisPiH } from "./zatca-crypto"

const mocks=vi.hoisted(()=>({permission:vi.fn(),user:vi.fn(),admin:vi.fn(),from:vi.fn(),rpc:vi.fn()}))
vi.mock("server-only",()=>({}))
vi.mock("@/lib/auth/authorization",()=>({requirePermission:mocks.permission,getCurrentUser:mocks.user}))
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:mocks.admin}))
import { prepareZatcaDocument, riyadhLocal } from "./zatca-issuance"

const tenant="85000000-0000-4000-8000-000000000001", stream="85000000-0000-4000-8000-000000000002", source="85000000-0000-4000-8000-000000000003"
const input={docType:"invoice" as const,invoiceNumber:"SYNTHETIC-1",invoiceKind:"simplified" as const,currency:"SAR",
  seller:{name:"Synthetic seller",vatNumber:"399999999900003"},buyer:{name:"Synthetic buyer",vatNumber:null},
  lines:[{line_no:1,description:"Synthetic service",quantity:1,unit_price:100,amount:100,vat_rate:15,vat_amount:15}],subtotal:100,discount:0,vatAmount:15,total:115}
let streamResult: {data: Record<string, unknown>|null;error:unknown}
let existingResult: {data: Record<string, unknown>|null;error:unknown}
let filters: [string,string,unknown][]
beforeEach(()=>{
  vi.clearAllMocks();filters=[]
  mocks.permission.mockResolvedValue(undefined)
  mocks.user.mockResolvedValue({tenantId:tenant,authUserId:"85000000-0000-4000-8000-000000000004"})
  streamResult={data:{id:stream,environment:"sandbox",last_counter:0,last_invoice_hash:genesisPiH()},error:null}
  existingResult={data:null,error:null}
  mocks.from.mockImplementation(table=>{
    const query={select:vi.fn().mockReturnThis(),eq:vi.fn((key,value)=>{filters.push([table,key,value]);return query}),maybeSingle:vi.fn(async()=>table==="zatca_issuance_streams"?streamResult:existingResult)}
    return query
  })
  mocks.rpc.mockImplementation(async(_name,p)=>({data:{id:p.p_document_uuid,tenant_id:p.p_tenant,stream_id:p.p_stream,environment:"sandbox",
    source_id:p.p_source_id,source_type:p.p_source_type,doc_ref:input.invoiceNumber,issued_at:p.p_issued_at,invoice_counter:1,
    previous_invoice_hash:p.p_previous_hash,invoice_hash:p.p_invoice_hash,unsigned_xml:p.p_xml},error:null}))
  mocks.admin.mockReturnValue({from:mocks.from,rpc:mocks.rpc})
})
afterEach(()=>{vi.useRealTimers()})

describe("server-only non-production ZATCA preparation",()=>{
  it("authorizes before privileged access and binds both reads to the active tenant",async()=>{
    const stored=await prepareZatcaDocument(stream,source,input)
    expect(mocks.permission).toHaveBeenCalledWith("accounting","approve")
    expect(mocks.permission.mock.invocationCallOrder[0]).toBeLessThan(mocks.admin.mock.invocationCallOrder[0])
    expect(filters).toContainEqual(["zatca_issuance_streams","tenant_id",tenant])
    expect(filters).toContainEqual(["zatca_document_issuances","tenant_id",tenant])
    expect(stored.source_id).toBe(source)
  })
  it("never instantiates an admin client for unauthorized/anonymous calls",async()=>{
    mocks.permission.mockRejectedValueOnce(new Error("Forbidden"))
    await expect(prepareZatcaDocument(stream,source,input)).rejects.toThrow("Forbidden")
    mocks.user.mockResolvedValueOnce(null)
    await expect(prepareZatcaDocument(stream,source,input)).rejects.toThrow("Not authenticated")
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it("overrides proposed identity/time with one captured UUID/time/counter/hash set",async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-19T12:13:14.999Z"))
    const result=await prepareZatcaDocument(stream,source,{...input,...{uuid:"forged",invoiceCounter:999,issueDate:"2000-01-01",issueTime:"00:00:00"}})
    const p=mocks.rpc.mock.calls[0][1]
    expect(p.p_issued_at).toBe("2026-10-19T12:13:14Z")
    expect(p.p_xml).toContain(`<cbc:UUID>${result.id}</cbc:UUID>`)
    expect(p.p_xml).toContain("<cbc:IssueDate>2026-10-19</cbc:IssueDate>")
    expect(p.p_xml).toContain("<cbc:IssueTime>15:13:14</cbc:IssueTime>")
    expect(p.p_xml).not.toContain("forged")
    expect(p.p_expected_counter).toBe(0)
    expect(p.p_canonical_xml).not.toContain("<cbc:ID>QR</cbc:ID>")
    expect(p.p_invoice_hash).toMatch(/^[A-Za-z0-9+/]{43}=$/)
  })
  it("reuses original persisted artifact after time/profile changes without rebuilding or recording",async()=>{
    existingResult.data={id:"stored",tenant_id:tenant,stream_id:stream,environment:"sandbox",source_type:"invoice",source_id:source,
      doc_ref:"SYNTHETIC-1",issued_at:"2026-10-18T09:00:00Z",invoice_counter:1,previous_invoice_hash:genesisPiH(),invoice_hash:"stored hash",
      unsigned_xml:"original bytes",source_snapshot:{private:"evidence"},canonical_xml:"private canonical bytes"}
    const result=await prepareZatcaDocument(stream,source,{...input,seller:{name:"changed",vatNumber:null}})
    expect(result.unsigned_xml).toBe("original bytes")
    expect(result.issued_at).toBe("2026-10-18T09:00:00Z")
    expect(result).not.toHaveProperty("source_snapshot")
    expect(result).not.toHaveProperty("canonical_xml")
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("uses the note's identity rather than the reference invoice's identity",async()=>{
    await prepareZatcaDocument(stream,source,{...input,docType:"credit_note",referenceInvoiceNumber:"SYNTHETIC-ORIGINAL",noteReason:"Synthetic adjustment"})
    expect(mocks.rpc.mock.calls[0][1].p_source_type).toBe("credit_note")
    expect(mocks.rpc.mock.calls[0][1].p_source_id).toBe(source)
  })
  it.each(["production","unknown"])("blocks %s streams before XML is prepared",async environment=>{
    streamResult.data!.environment=environment
    await expect(prepareZatcaDocument(stream,source,input)).rejects.toThrow("production preparation is disabled")
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([-1,1.2,Number.MAX_SAFE_INTEGER,"invalid"])("rejects invalid/exhausted counter %s",async counter=>{
    streamResult.data!.last_counter=counter
    await expect(prepareZatcaDocument(stream,source,input)).rejects.toThrow("counter")
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("fails read errors instead of generating a new copy",async()=>{
    existingResult.error={message:"private query data"}
    await expect(prepareZatcaDocument(stream,source,input)).rejects.toThrow("Unable to load the existing ZATCA preparation.")
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("maps stale allocation and other DB errors without returning private bodies",async()=>{
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message:"ZTC_CONFLICT: private diagnostic"}})
    await expect(prepareZatcaDocument(stream,source,input)).rejects.toThrow("Reload and retry")
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message:"sensitive SQL or credential data"}})
    await expect(prepareZatcaDocument(stream,source,input)).rejects.toThrow(/^Unable to persist the ZATCA preparation\.$/)
  })
  it("rejects unexpected cross-tenant RPC results",async()=>{
    mocks.rpc.mockResolvedValueOnce({data:{tenant_id:"other",source_id:source},error:null})
    await expect(prepareZatcaDocument(stream,source,input)).rejects.toThrow("Unexpected ZATCA preparation result")
  })
  it("requires real-format VAT data instead of substituting a demo identity",async()=>{
    await expect(prepareZatcaDocument(stream,source,{...input,seller:{name:"No VAT",vatNumber:null}})).rejects.toThrow("seller VAT identity")
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

describe("riyadhLocal (ZATCA IssueDate/IssueTime)",()=>{
  it("renders the Saudi calendar day so late-UTC documents land in the correct VAT period",()=>{
    expect(riyadhLocal("2026-12-31T22:30:00Z")).toBe("2027-01-01T01:30:00")
    expect(riyadhLocal("2026-10-19T12:13:14Z")).toBe("2026-10-19T15:13:14")
  })
  it("rejects invalid instants",()=>{
    expect(()=>riyadhLocal("not-a-date")).toThrow("Invalid ZATCA issuance time.")
  })
})
