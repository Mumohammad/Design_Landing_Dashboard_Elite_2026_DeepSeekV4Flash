import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks=vi.hoisted(()=>({
  rpc:vi.fn(),from:vi.fn(),credential:vi.fn(),sign:vi.fn(),transmit:vi.fn(),audit:vi.fn(),environment:vi.fn(),base:vi.fn(),
}))
vi.mock("server-only",()=>({}))
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:mocks.rpc,from:mocks.from})}))
vi.mock("@/lib/auth/sessions",()=>({writeAuditLog:mocks.audit}))
vi.mock("./zatca-config",()=>({getZatcaNetworkBase:mocks.base}))
vi.mock("./zatca-environment",()=>({resolveTenantZatcaEnvironment:mocks.environment}))
vi.mock("./zatca-cert",()=>({certificateFromToken:()=>"synthetic certificate"}))
vi.mock("./zatca-credentials",()=>({getZatcaCsidCredential:mocks.credential}))
vi.mock("./zatca-signer",()=>({signZatcaInvoice:mocks.sign,ZatcaSigningError:class extends Error{}}))
vi.mock("./zatca-transport",()=>({transmitToZatca:mocks.transmit,ZatcaTransportError:class extends Error{}}))
import { submitPreparedZatcaDocumentAs } from "./zatca-submission-core"

const actor={tenantId:"15700000-0000-4000-8000-000000000001",authUserId:"15700000-0000-4000-8000-000000000002"}
const id="15700000-0000-4000-8000-000000000003"
const issuance={id,tenant_id:actor.tenantId,environment:"sandbox",doc_ref:"SYNTHETIC",invoice_hash:"stored hash",unsigned_xml:`<Invoice><cbc:UUID>${id}</cbc:UUID><cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode></Invoice>`}
let insert:ReturnType<typeof vi.fn>,eq:ReturnType<typeof vi.fn>
beforeEach(()=>{
  vi.clearAllMocks()
  mocks.rpc.mockResolvedValue({data:true,error:null})
  mocks.environment.mockResolvedValue("sandbox")
  mocks.base.mockReturnValue("https://synthetic-gateway.test")
  mocks.credential.mockResolvedValue({csidBase64:"synthetic token",secret:"synthetic secret",privateKeyPem:"synthetic key"})
  mocks.sign.mockReturnValue({invoiceHash:"stored hash",signedXml:"retained signed bytes"})
  mocks.transmit.mockResolvedValue({status:"reported",raw:{httpStatus:200,validationResults:{warningMessages:[]}}})
  insert=vi.fn().mockResolvedValue({error:null})
  const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:issuance,error:null}),insert}
  eq=query.eq
  mocks.from.mockReturnValue(query)
})

describe("prepared submission authorization and persistence boundaries",()=>{
  it("rechecks operator authorization before reading credentials, document bytes or sending",async()=>{
    mocks.rpc.mockResolvedValue({data:false,error:null})
    expect(await submitPreparedZatcaDocumentAs(actor,id)).toEqual({success:false,error:"The ZATCA operator is no longer authorized."})
    expect(mocks.rpc).toHaveBeenCalledWith("zatca_operator_authorized",{p_tenant:actor.tenantId,p_user:actor.authUserId})
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.environment).not.toHaveBeenCalled()
    expect(mocks.credential).not.toHaveBeenCalled()
    expect(mocks.sign).not.toHaveBeenCalled()
    expect(mocks.transmit).not.toHaveBeenCalled()
  })
  it("fails closed on an authorization lookup error without exposing it",async()=>{
    mocks.rpc.mockResolvedValue({data:true,error:{message:"private authorization detail"}})
    expect(await submitPreparedZatcaDocumentAs(actor,id)).toEqual({success:false,error:"The ZATCA operator is no longer authorized."})
    expect(mocks.credential).not.toHaveBeenCalled()
  })
  it("scopes the retained issuance to the actor tenant and retains signed attempt bytes",async()=>{
    expect(await submitPreparedZatcaDocumentAs(actor,id)).toMatchObject({success:true,status:"reported",pipeline:"reporting"})
    expect(eq).toHaveBeenCalledWith("tenant_id",actor.tenantId)
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.credential.mock.invocationCallOrder[0])
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.environment.mock.invocationCallOrder[0])
    expect(mocks.environment).toHaveBeenCalledWith(expect.any(Object),actor.tenantId)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({tenant_id:actor.tenantId,issuance_id:id,environment:"sandbox",pipeline:"reporting",status:"reported",signed_xml:"retained signed bytes",created_by:actor.authUserId}))
  })
  it.each(["production",null])("stops unavailable %s environments before credentials or source bytes",async environment=>{
    mocks.environment.mockResolvedValue(environment)
    expect(await submitPreparedZatcaDocumentAs(actor,id)).toMatchObject({success:false,error:expect.any(String)})
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.credential).not.toHaveBeenCalled()
    expect(mocks.transmit).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })
  it("stops environment resolution failures before loading credentials or source bytes",async()=>{
    mocks.environment.mockRejectedValueOnce(new Error("ZATCA production submission is disabled."))
    expect(await submitPreparedZatcaDocumentAs(actor,id)).toEqual({success:false,error:"ZATCA production submission is disabled."})
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.credential).not.toHaveBeenCalled()
    expect(mocks.transmit).not.toHaveBeenCalled()
  })
  it("refuses a prepared artifact from another environment before signing or network",async()=>{
    mocks.environment.mockResolvedValue("simulation")
    expect(await submitPreparedZatcaDocumentAs(actor,id)).toEqual({success:false,error:"The document was prepared for another ZATCA environment."})
    expect(mocks.credential).not.toHaveBeenCalled()
    expect(mocks.sign).not.toHaveBeenCalled()
    expect(mocks.transmit).not.toHaveBeenCalled()
  })
  it("does not claim an accepted result if its submission evidence could not be retained",async()=>{
    insert.mockResolvedValue({error:{message:"private database detail"}})
    expect(await submitPreparedZatcaDocumentAs(actor,id)).toEqual({success:false,pipeline:"reporting",error:"Unable to retain the ZATCA submission evidence. Retry with the same prepared document."})
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it("rejects a signed hash mismatch before sending or storing an attempt",async()=>{
    mocks.sign.mockReturnValue({invoiceHash:"changed hash",signedXml:"changed bytes"})
    expect(await submitPreparedZatcaDocumentAs(actor,id)).toEqual({success:false,error:"Prepared document hash mismatch."})
    expect(mocks.transmit).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })
})
