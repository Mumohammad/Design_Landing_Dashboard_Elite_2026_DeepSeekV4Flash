import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks=vi.hoisted(()=>({
  rpc:vi.fn(),from:vi.fn(),session:vi.fn(),sign:vi.fn(),transmit:vi.fn(),audit:vi.fn(),environment:vi.fn(),base:vi.fn(),
}))
vi.mock("server-only",()=>({}))
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:mocks.rpc,from:mocks.from})}))
vi.mock("@/lib/auth/authorization",()=>({requirePermission:mocks.session,getCurrentUser:async()=>null}))
vi.mock("@/lib/auth/sessions",()=>({writeAuditLog:mocks.audit}))
vi.mock("./zatca-config",()=>({getZatcaNetworkBase:mocks.base}))
vi.mock("./zatca-environment",()=>({resolveTenantZatcaEnvironment:mocks.environment}))
vi.mock("./zatca-cert",()=>({certificateFromToken:()=>"synthetic certificate"}))
vi.mock("./zatca-signer",()=>({signZatcaInvoice:mocks.sign,ZatcaSigningError:class extends Error{}}))
vi.mock("./zatca-transport",()=>({transmitToZatca:mocks.transmit,ZatcaTransportError:class extends Error{}}))
import { submitPreparedZatcaDocumentAs } from "./zatca-submission-core"

const actor={tenantId:"15700000-0000-4000-8000-000000000001",authUserId:"15700000-0000-4000-8000-000000000002"}
const id="15700000-0000-4000-8000-000000000003"
const issuance={id,tenant_id:actor.tenantId,environment:"sandbox",doc_ref:"SYNTHETIC",invoice_hash:"stored hash",unsigned_xml:`<Invoice><cbc:UUID>${id}</cbc:UUID><cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode></Invoice>`}
const token = "15700000-0000-4000-8000-000000000099"
const recordedAt = "2026-11-26T18:00:00.000Z"
let insert:ReturnType<typeof vi.fn>,eq:ReturnType<typeof vi.fn>,issuanceRead:ReturnType<typeof vi.fn>
let credentialRead:ReturnType<typeof vi.fn>,credentialEq:ReturnType<typeof vi.fn>
let evidenceRows: Record<string, unknown>[]
let evidenceReadError: { message: string } | null
let evidenceFilters: Record<string, unknown>
beforeEach(()=>{
  vi.clearAllMocks()
  mocks.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === "zatca_operator_authorized") return { data: true, error: null }
    if (name === "claim_zatca_submission") return { data: { state: "claimed", token }, error: null }
    if (name === "finish_zatca_submission") return { data: recordedAt, error: null }
    throw new Error(`Unexpected RPC: ${name}`)
  })
  mocks.environment.mockResolvedValue("sandbox")
  mocks.base.mockReturnValue("https://synthetic-gateway.test")
  mocks.session.mockRejectedValue(new Error("No browser session"))
  credentialRead = vi.fn().mockResolvedValue({
    data: { csid_base64: "synthetic token", secret: "synthetic secret", private_key: "synthetic key" },
    error: null,
  })
  mocks.sign.mockReturnValue({invoiceHash:"stored hash",signedXml:"retained signed bytes"})
  mocks.transmit.mockResolvedValue({status:"reported",raw:{httpStatus:200,validationResults:{warningMessages:[]}}})
  insert=vi.fn().mockResolvedValue({error:null})
  const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:issuance,error:null}),insert}
  eq=query.eq
  issuanceRead=query.maybeSingle
  const credentialQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: credentialRead,
  }
  credentialEq = credentialQuery.eq
  evidenceRows = []
  evidenceReadError = null
  evidenceFilters = {}
  const evidenceQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockImplementation(function (this: unknown, field: string, value: unknown) {
      evidenceFilters[field] = value
      return this
    }),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockImplementation(async () => ({
      data: evidenceRows.find(row => Object.entries(evidenceFilters).every(([field, value]) => row[field] === value)) ?? null,
      error: evidenceReadError,
    })),
    insert,
  }
  mocks.from.mockImplementation((table: string) => {
    if (table === "zatca_document_issuances") return query
    if (table === "zatca_submission_attempts") return evidenceQuery
    if (table === "zatca_csids") return credentialQuery
    throw new Error(`Unexpected table: ${table}`)
  })
})

const reportedAttempt = {
  tenant_id: actor.tenantId,
  issuance_id: id,
  environment: issuance.environment,
  invoice_hash: issuance.invoice_hash,
  pipeline: "reporting",
  status: "reported",
  created_at: "2026-11-24T12:34:56.000Z",
  response: { validationResults: { warningMessages: [{ code: "SYNTHETIC-WARNING" }] } },
}

describe("prepared submission authorization and persistence boundaries",()=>{
  it("rechecks operator authorization before reading credentials, document bytes or sending",async()=>{
    mocks.rpc.mockResolvedValue({data:false,error:null})
    expect(await submitPreparedZatcaDocumentAs(actor,id)).toEqual({success:false,error:"The ZATCA operator is no longer authorized."})
    expect(mocks.rpc).toHaveBeenCalledWith("zatca_operator_authorized",{p_tenant:actor.tenantId,p_user:actor.authUserId})
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.environment).not.toHaveBeenCalled()
    expect(credentialRead).not.toHaveBeenCalled()
    expect(mocks.sign).not.toHaveBeenCalled()
    expect(mocks.transmit).not.toHaveBeenCalled()
  })
  it("fails closed on an authorization lookup error without exposing it",async()=>{
    mocks.rpc.mockResolvedValue({data:true,error:{message:"private authorization detail"}})
    expect(await submitPreparedZatcaDocumentAs(actor,id)).toEqual({success:false,error:"The ZATCA operator is no longer authorized."})
    expect(credentialRead).not.toHaveBeenCalled()
  })
  it("submits without a browser session using only the authorized operator's tenant credential",async()=>{
    expect(await submitPreparedZatcaDocumentAs(actor,id)).toMatchObject({success:true,status:"reported",pipeline:"reporting"})
    expect(eq).toHaveBeenCalledWith("tenant_id",actor.tenantId)
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(credentialRead.mock.invocationCallOrder[0])
    expect(credentialEq.mock.calls).toEqual([
      ["tenant_id", actor.tenantId], ["environment", "sandbox"], ["kind", "production"], ["status", "issued"],
    ])
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.environment.mock.invocationCallOrder[0])
    expect(mocks.environment).toHaveBeenCalledWith(expect.any(Object),actor.tenantId)
    expect(mocks.rpc).toHaveBeenCalledWith("claim_zatca_submission", {
      p_tenant: actor.tenantId, p_actor: actor.authUserId, p_issuance: id, p_environment: "sandbox", p_pipeline: "reporting",
    })
    expect(mocks.rpc).toHaveBeenCalledWith("finish_zatca_submission", {
      p_tenant: actor.tenantId, p_actor: actor.authUserId, p_issuance: id, p_token: token,
      p_attempt: expect.objectContaining({ status: "reported", signed_xml: "retained signed bytes" }),
    })
    expect(insert).not.toHaveBeenCalled()
  })
  it.each(["production",null])("stops unavailable %s environments before credentials or source bytes",async environment=>{
    mocks.environment.mockResolvedValue(environment)
    expect(await submitPreparedZatcaDocumentAs(actor,id)).toMatchObject({success:false,error:expect.any(String)})
    expect(mocks.from).not.toHaveBeenCalled()
    expect(credentialRead).not.toHaveBeenCalled()
    expect(mocks.transmit).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })
  it("stops environment resolution failures before loading credentials or source bytes",async()=>{
    mocks.environment.mockRejectedValueOnce(new Error("ZATCA production submission is disabled."))
    expect(await submitPreparedZatcaDocumentAs(actor,id)).toEqual({success:false,error:"ZATCA production submission is disabled."})
    expect(mocks.from).not.toHaveBeenCalled()
    expect(credentialRead).not.toHaveBeenCalled()
    expect(mocks.transmit).not.toHaveBeenCalled()
  })
  it("refuses a prepared artifact from another environment before signing or network",async()=>{
    mocks.environment.mockResolvedValue("simulation")
    expect(await submitPreparedZatcaDocumentAs(actor,id)).toEqual({success:false,error:"The document was prepared for another ZATCA environment."})
    expect(credentialRead).not.toHaveBeenCalled()
    expect(mocks.sign).not.toHaveBeenCalled()
    expect(mocks.transmit).not.toHaveBeenCalled()
  })
  it("does not claim an accepted result if its submission evidence could not be retained",async()=>{
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: { state: "claimed", token }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "private database detail" } })
    expect(await submitPreparedZatcaDocumentAs(actor,id)).toEqual({success:false,pipeline:"reporting",unconfirmed:true,error:"Unable to retain the ZATCA submission evidence. Retry with the same prepared document."})
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it("replays retained acceptance without fetching credentials or submitting a duplicate", async () => {
    evidenceRows = [{ ...reportedAttempt, status: "rejected" }, reportedAttempt]
    credentialRead.mockResolvedValue({ data: null, error: null })

    expect(await submitPreparedZatcaDocumentAs(actor, id)).toEqual({
      success: true, status: "reported", pipeline: "reporting",
      warnings: [{ code: "SYNTHETIC-WARNING" }], errors: [],
      transmittedAt: reportedAttempt.created_at,
    })
    expect(credentialRead).not.toHaveBeenCalled()
    expect(mocks.sign).not.toHaveBeenCalled()
    expect(mocks.transmit).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it("replays a standard invoice only from cleared evidence", async () => {
    issuanceRead.mockResolvedValue({ data: { ...issuance, unsigned_xml: issuance.unsigned_xml.replace("0200000", "0100000") }, error: null })
    evidenceRows = [reportedAttempt, { ...reportedAttempt, pipeline: "clearance", status: "cleared" }]

    expect(await submitPreparedZatcaDocumentAs(actor, id)).toMatchObject({ success: true, status: "cleared", pipeline: "clearance" })
    expect(mocks.transmit).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })
  it("runs explicit compliance checks separately from retained reporting acceptance", async () => {
    evidenceRows = [reportedAttempt]

    expect(await submitPreparedZatcaDocumentAs(actor, id, "compliance")).toMatchObject({ success: true, pipeline: "compliance" })
    expect(credentialEq).toHaveBeenCalledWith("kind", "compliance")
    expect(mocks.transmit).toHaveBeenCalledWith(expect.objectContaining({ pipeline: "compliance" }))
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ pipeline: "compliance" }))
    expect(mocks.rpc).not.toHaveBeenCalledWith("claim_zatca_submission", expect.anything())
  })
  it("allows only the worker holding the database claim to contact the gateway", async () => {
    let claimed = false
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_zatca_submission") {
        if (claimed) return { data: { state: "busy" }, error: null }
        claimed = true
        return { data: { state: "claimed", token }, error: null }
      }
      if (name === "finish_zatca_submission") return { data: recordedAt, error: null }
      return { data: true, error: null }
    })
    let reply!: (response: { status: string; raw: Record<string, unknown> }) => void
    const response = new Promise<{ status: string; raw: Record<string, unknown> }>(resolve => { reply = resolve })
    let markStarted!: () => void
    const started = new Promise<void>(resolve => { markStarted = resolve })
    mocks.transmit.mockImplementationOnce(() => {
      markStarted()
      return response
    })
    const first = submitPreparedZatcaDocumentAs(actor, id)
    await Promise.race([
      started,
      first.then(() => { throw new Error("The claimed worker completed before contacting the gateway.") }),
    ])
    try {
      expect(await submitPreparedZatcaDocumentAs(actor, id)).toMatchObject({ inProgress: true })
      expect(mocks.transmit).toHaveBeenCalledOnce()
    } finally {
      reply({ status: "reported", raw: { httpStatus: 200 } })
      await first
    }
    expect(await first).toMatchObject({ success: true, status: "reported", transmittedAt: recordedAt })
  })
  it("uses acceptance that was retained while the worker prepared its signature", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: { state: "accepted", response: reportedAttempt.response, created_at: recordedAt }, error: null })

    expect(await submitPreparedZatcaDocumentAs(actor, id)).toMatchObject({
      success: true, status: "reported", transmittedAt: recordedAt,
    })
    expect(mocks.transmit).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalledWith("finish_zatca_submission", expect.anything())
  })
  it("fails closed when the database cannot claim the submission", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "private database detail" } })

    expect(await submitPreparedZatcaDocumentAs(actor, id)).toMatchObject({
      success: false, error: "Unable to claim the ZATCA submission.",
    })
    expect(mocks.transmit).not.toHaveBeenCalled()
  })
  it("submits when no accepted attempt matches the prepared document and reporting pipeline", async () => {
    evidenceRows = [
      { ...reportedAttempt, tenant_id: "other tenant" },
      { ...reportedAttempt, issuance_id: "other issuance" },
      { ...reportedAttempt, environment: "simulation" },
      { ...reportedAttempt, invoice_hash: "other hash" },
      { ...reportedAttempt, pipeline: "compliance" },
      { ...reportedAttempt, status: "failed" },
    ]

    expect(await submitPreparedZatcaDocumentAs(actor, id)).toMatchObject({ success: true, status: "reported" })
    expect(mocks.transmit).toHaveBeenCalledOnce()
    expect(mocks.rpc).toHaveBeenCalledWith("finish_zatca_submission", expect.anything())
  })
  it("stops before sending when it cannot check retained evidence", async () => {
    evidenceReadError = { message: "private database detail" }

    expect(await submitPreparedZatcaDocumentAs(actor, id)).toEqual({
      success: false, pipeline: "reporting", unconfirmed: true, error: "Unable to verify the previous ZATCA submission.",
    })
    expect(credentialRead).not.toHaveBeenCalled()
    expect(mocks.transmit).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })
  it("rejects a signed hash mismatch before sending or storing an attempt",async()=>{
    mocks.sign.mockReturnValue({invoiceHash:"changed hash",signedXml:"changed bytes"})
    expect(await submitPreparedZatcaDocumentAs(actor,id)).toEqual({success:false,error:"Prepared document hash mismatch."})
    expect(mocks.transmit).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })
})
