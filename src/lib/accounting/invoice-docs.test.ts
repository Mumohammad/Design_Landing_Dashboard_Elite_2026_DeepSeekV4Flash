import { beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
const mocks = vi.hoisted(() => ({ permission: vi.fn(), user: vi.fn(), from: vi.fn(), storage: vi.fn(),
  upload: vi.fn(), sign: vi.fn(), audit: vi.fn(), read: vi.fn(), render: vi.fn(), queries: [] as Array<{table:string; builder:Record<string, ReturnType<typeof vi.fn>>}>,
  results: {} as Record<string, {data:unknown;error:unknown}>, existing: null as unknown, existingError: null as unknown,
  saveError: null as unknown, fonts: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: mocks.permission, getCurrentUser: mocks.user }))
vi.mock("@/lib/auth/sessions", () => ({ writeAuditLog: mocks.audit }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from, storage: { from: mocks.storage } }) }))
vi.mock("node:fs/promises", () => ({ readFile: mocks.read }))
vi.mock("./invoice-pdf", () => ({ renderInvoicePdf: mocks.render, loadInvoiceReferenceFonts: mocks.fonts }))
vi.mock("./invoice-qr", () => ({ buildTaxQrPayload: vi.fn(), qrPngDataUrl: async () => "data:image/png;base64,AAAA" }))
import { generateInvoiceDocument } from "./invoice-docs"
const invoiceId="80111111-1111-4111-8111-111111111111"
const pdf=new TextEncoder().encode("%PDF-1.7\nfixture")
beforeEach(() => {
  vi.resetAllMocks()
  mocks.queries=[];mocks.existing=null;mocks.existingError=null;mocks.saveError=null
  mocks.permission.mockResolvedValue(undefined)
  mocks.user.mockResolvedValue({tenantId:"tenant-a",authUserId:"auth-a"})
  mocks.read.mockResolvedValue(Buffer.from("asset"))
  mocks.render.mockResolvedValue(pdf)
  mocks.fonts.mockResolvedValue({})
  mocks.upload.mockResolvedValue({error:null})
  mocks.sign.mockResolvedValue({data:{signedUrl:"https://example.test/private.pdf"},error:null})
  mocks.storage.mockReturnValue({upload:mocks.upload,createSignedUrl:mocks.sign})
  mocks.results={
    invoices:{data:{id:invoiceId,invoice_number:"INV-fixture",invoice_type:"sales",customer_id:"customer-a",status:"draft",
      issue_date:"2026-10-19",due_date:"2026-10-20",currency:"SAR",subtotal:4.1,discount:0,vat_amount:0.62,total:4.72},error:null},
    invoice_lines:{data:[{line_no:1,description:"Service",quantity:1,unit_price:4.1,amount:4.1,discount:0,vat_rate:15,vat_amount:0.62}],error:null},
    customers:{data:{name_ar:"Customer",name_en:"Customer",tax_number:null,address:"City",phone:null},error:null},
    tenants:{data:{name_ar:"Company",name_en:"Company",vat_number:"300000000000003",address:"City"},error:null},
    receivables:{data:[{paid_amount:0.1},{paid_amount:0.2}],error:null},
    bank_accounts:{data:{bank_name:"Test bank",account_name:"Company",iban:"SA-fixture"},error:null},
  }
  mocks.from.mockImplementation((table:string)=>{
    const builder:Record<string,ReturnType<typeof vi.fn>>={}
    for(const method of ["select","eq","is","order","insert","update"]) builder[method]=vi.fn().mockReturnValue(builder)
    builder.maybeSingle=vi.fn().mockImplementation(async()=>table==="generated_documents"
      ? {data:mocks.existing,error:mocks.existingError}:mocks.results[table])
    builder.single=vi.fn().mockImplementation(async()=>({data:{id:"document-a"},error:mocks.saveError}))
    builder.then=vi.fn().mockImplementation(resolve=>Promise.resolve(table==="generated_documents"
      ? {data:null,error:mocks.saveError}:mocks.results[table]).then(resolve))
    mocks.queries.push({table,builder})
    return builder
  })
})

describe("retained invoice PDFs",()=>{
  it("stores and returns identical private PDF bytes and a hash, after scoped authoritative reads",async()=>{
    const result=await generateInvoiceDocument(invoiceId,"bank-a")
    expect(result.success).toBe(true)
    expect(result.pdf).toEqual(pdf)
    const hash=createHash("sha256").update(pdf).digest("hex")
    expect(mocks.upload).toHaveBeenCalledWith(`tenant-a/${invoiceId}/${hash}.pdf`,pdf,expect.objectContaining({contentType:"application/pdf"}))
    expect(mocks.storage).toHaveBeenCalledWith("invoice-documents")
    for(const {table,builder} of mocks.queries) {
      if(table==="tenants") expect(builder.eq).toHaveBeenCalledWith("id","tenant-a")
      else if(!builder.insert.mock.calls.length) expect(builder.eq).toHaveBeenCalledWith("tenant_id","tenant-a")
    }
    const record=mocks.queries.find(query=>query.table==="generated_documents"&&query.builder.insert.mock.calls.length)
    expect(record?.builder.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id:"tenant-a",file_url:"https://example.test/private.pdf",
      generated_data:expect.objectContaining({file_format:"pdf",layout_version:"reference-letter-1",font_source:"system_or_cairo",pdf_sha256:hash,qr_kind:"internal_unvalidated"}),
    }))
    expect(mocks.render.mock.calls[0][0]).toContain('aria-label="SAR 0.30"')
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({tenantId:"tenant-a",entityId:"document-a"}))
  })
  it("uses only operator-loaded reference fonts and fails before rendering when configured fonts are invalid",async()=>{
    mocks.fonts.mockResolvedValueOnce({referenceFontDataUrl:"data:font/ttf;base64,AAAA",referenceBoldFontDataUrl:"data:font/ttf;base64,BBBB"})
    expect((await generateInvoiceDocument(invoiceId)).success).toBe(true)
    expect(mocks.render.mock.calls[0][0]).toContain('format("truetype"); font-weight: 400')
    const record=mocks.queries.find(query=>query.table==="generated_documents"&&query.builder.insert.mock.calls.length)
    expect(record?.builder.insert).toHaveBeenCalledWith(expect.objectContaining({generated_data:expect.objectContaining({font_source:"protected_reference"})}))
    mocks.render.mockClear();mocks.upload.mockClear()
    mocks.fonts.mockRejectedValueOnce(new Error("Invoice reference fonts are unavailable or invalid"))
    expect((await generateInvoiceDocument(invoiceId)).success).toBe(false)
    expect(mocks.render).not.toHaveBeenCalled();expect(mocks.upload).not.toHaveBeenCalled()
  })
  it("never renders or uploads without permission and an assured current user",async()=>{
    mocks.permission.mockRejectedValueOnce(new Error("Forbidden"))
    expect((await generateInvoiceDocument(invoiceId)).success).toBe(false)
    mocks.user.mockResolvedValueOnce(null)
    expect((await generateInvoiceDocument(invoiceId)).success).toBe(false)
    expect(mocks.render).not.toHaveBeenCalled();expect(mocks.upload).not.toHaveBeenCalled()
  })
  it.each(["invoices","invoice_lines","customers","tenants","receivables"])("does not render incomplete %s reads",async table=>{
    mocks.results[table]={data:null,error:{message:"Synthetic read failure"}}
    expect((await generateInvoiceDocument(invoiceId)).success).toBe(false)
    expect(mocks.render).not.toHaveBeenCalled();expect(mocks.upload).not.toHaveBeenCalled()
  })
  it("rejects empty lines, null balances, missing VAT and foreign/inactive bank options",async()=>{
    mocks.results.invoice_lines={data:[],error:null}
    expect((await generateInvoiceDocument(invoiceId)).success).toBe(false)
    mocks.results.invoice_lines={data:[{line_no:1}],error:null}
    mocks.results.receivables={data:null,error:null}
    expect((await generateInvoiceDocument(invoiceId)).success).toBe(false)
    mocks.results.receivables={data:[],error:null}
    mocks.results.tenants={data:{vat_number:null},error:null}
    expect((await generateInvoiceDocument(invoiceId)).success).toBe(false)
    mocks.results.tenants={data:{vat_number:"300000000000003"},error:null}
    mocks.results.bank_accounts={data:null,error:null}
    expect((await generateInvoiceDocument(invoiceId,"foreign-bank")).success).toBe(false)
    expect(mocks.render).not.toHaveBeenCalled()
  })
  it("does not record a generated document when rendering fails",async()=>{
    mocks.render.mockRejectedValueOnce(new Error("Browser unavailable"))
    expect(await generateInvoiceDocument(invoiceId)).toMatchObject({success:false,retryable:true})
    expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.audit).not.toHaveBeenCalled()
  })
  it("regenerates/restores the existing tenant-scoped record without claiming a physical print",async()=>{
    mocks.existing={id:"document-a",deleted_at:"2026-10-18T00:00:00Z"}
    expect((await generateInvoiceDocument(invoiceId)).success).toBe(true)
    const records=mocks.queries.filter(query=>query.table==="generated_documents")
    for(const {builder} of records) {
      expect(builder.insert).not.toHaveBeenCalled()
      expect(builder.eq).toHaveBeenCalledWith("tenant_id","tenant-a")
      for(const [values] of builder.update.mock.calls) expect(values).not.toHaveProperty("printed_at")
    }
  })
  it("does not report success or audit after failed upload, link or metadata writes",async()=>{
    mocks.upload.mockResolvedValueOnce({error:{message:"Upload failed"}})
    expect((await generateInvoiceDocument(invoiceId)).success).toBe(false)
    mocks.sign.mockResolvedValueOnce({data:null,error:{message:"Link failed"}})
    expect((await generateInvoiceDocument(invoiceId)).success).toBe(false)
    mocks.saveError={message:"Save failed"}
    expect((await generateInvoiceDocument(invoiceId)).success).toBe(false)
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
