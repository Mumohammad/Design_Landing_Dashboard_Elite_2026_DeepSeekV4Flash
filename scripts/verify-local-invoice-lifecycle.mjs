// Called only after the MFA harness creates its synthetic tenant. Never targets production.
import { expect as baseExpect } from "@playwright/test"
import { randomUUID } from "node:crypto"
const expect = baseExpect.configure({ timeout: 30_000 })

export async function verifyInvoiceLifecycle(page, admin, tenantId, appUrl) {
  const backend = new URL(admin.supabaseUrl)
  const local = ["localhost", "127.0.0.1"].includes(backend.hostname) && backend.port === "58321"
  const staging = backend.origin === "https://viowrovartosrkqukjxy.supabase.co"
  if (!local && !staging) throw Error("Disposable local or approved staging backend required")
  const app = new URL(appUrl)
  if (local && !["http://localhost:3107", "http://localhost:3108"].includes(app.origin)) throw Error("Local app target required")
  if (staging && (!app.hostname.endsWith("-elitesaasc-5643.vercel.app") || app.protocol !== "https:")) throw Error("Staging preview target required")
  let stage = "lifecycle customer"
  const name = `Lifecycle ${randomUUID()}`
  const customer = await admin.from("customers").insert({tenant_id:tenantId,name_ar:name,name_en:name}).select("id").single()
  if (customer.error) throw Error("Synthetic lifecycle customer failed")
  const invoice = async id => {
    const result = await admin.from("invoices").select("id,invoice_number,status,updated_at,total").eq("tenant_id",tenantId).eq("id",id).single()
    if (result.error) throw Error("Synthetic invoice read failed")
    return result.data
  }
  const rowFor = number => page.getByRole("row").filter({hasText:number})
  const menu = async (number, label) => {
    const row = rowFor(number)
    await row.getByRole("button",{name:/Invoice actions|إجراءات الفاتورة/}).click()
    await page.getByRole("menuitem",{name:label,exact:true}).click()
  }
  const dashboardMoney = async (locale = "en") => {
    await page.goto(appUrl + "/dashboard?lang=" + locale)
    const labels = locale === "ar" ? ["الإيرادات المرحلة", "الذمم المدينة المتبقية"] : ["Posted Revenue", "Outstanding Receivables"]
    const values = []
    for (const label of labels) {
      const amount = page.getByRole("link", { name: label, exact: true }).locator("span.text-2xl")
      await expect(amount).toContainText(/-?[\d,]+\.\d{2}/)
      const match = (await amount.innerText()).match(/-?[\d,]+\.\d{2}/)
      if (!match) throw Error("Synthetic posted KPI currency unavailable")
      values.push(Math.round(Number(match[0].replaceAll(",", "")) * 100))
    }
    return values
  }
  const createDraft = async () => {
    await page.goto(`${appUrl}/invoices`)
    await page.getByRole("button",{name:/New invoice|فاتورة جديدة/}).click()
    const dialog = page.getByRole("dialog")
    await dialog.locator("#inv-party").selectOption(customer.data.id)
    await dialog.getByLabel(/Line description|وصف البند/).fill("Lifecycle verified service")
    await dialog.getByLabel(/Unit price|سعر الوحدة/).fill("100.25")
    await dialog.getByLabel(/Line VAT rate|ضريبة البند/).fill("0")
    await dialog.getByRole("button",{name:/Save draft|حفظ المسودة/}).click()
    await expect(dialog).toBeHidden()
    const rows = await admin.from("invoices").select("id,invoice_number").eq("tenant_id",tenantId).eq("customer_id",customer.data.id).eq("status","draft").is("deleted_at",null)
    if (rows.error || rows.data.length !== 1) throw Error("Synthetic draft persistence mismatch")
    return rows.data[0]
  }
  try {
    stage = "issue and finalize zero VAT"
    stage = "baseline posted ledger dashboard"
    const baseline = await dashboardMoney()
    stage = "lifecycle draft creation"
    const original = await createDraft()
    stage = "issue reviewed draft"
    await menu(original.invoice_number,/^(Issue|إصدار)$/)
    await expect.poll(async () => (await invoice(original.id)).status).toBe("issued")
    await expect(rowFor(original.invoice_number).getByText(/^(Issued|صادرة)$/)).toBeVisible()
    stage = "finalize issued invoice"
    await menu(original.invoice_number,/^(Finalize|اعتماد)$/)
    await expect.poll(async () => (await invoice(original.id)).status).toBe("finalized")
    await expect(rowFor(original.invoice_number).getByText(/^(Finalized|معتمدة)$/)).toBeVisible()
    stage = "verify specific posting event"
    const posting = await admin.from("financial_events").select("event_id,processing_status").eq("tenant_id",tenantId).eq("source_id",original.id).eq("event_type","InvoiceFinalizedEvent").single()
    if (posting.error || !["processed","skipped_duplicate"].includes(posting.data.processing_status)) throw Error("Finalized invoice posting incomplete")
    stage = "verify original journal"
    const journals = await admin.from("journal_entries").select("id").eq("tenant_id",tenantId).eq("source_entity_id",original.id).eq("entry_type","invoice").eq("status","posted").is("deleted_at",null)
    if (journals.error || journals.data.length !== 1) throw Error("Original journal missing or duplicated")
    stage = "verify zero-VAT journal lines"
    const lines = await admin.from("journal_entry_lines").select("debit_amount,credit_amount").eq("tenant_id",tenantId).eq("journal_entry_id",journals.data[0].id)
    if (lines.error || lines.data.length !== 2 || lines.data.reduce((a,l)=>a+Number(l.debit_amount)-Number(l.credit_amount),0)!==0) throw Error("Zero-VAT journal imbalance")

    stage = "posted revenue and receivable cents after finalization"
    expect(await dashboardMoney()).toEqual([baseline[0] + 10025, baseline[1] + 10025])
    await page.goto(appUrl + "/invoices?lang=en")
    stage = "debit note exact preview and posting"
    await menu(original.invoice_number,/^(Debit|مدين)$/)
    const dialog = page.getByRole("dialog")
    await dialog.locator("#dn-amount").fill("20")
    await dialog.locator("#dn-rate").fill("15")
    await dialog.locator("#dn-reason").fill("Synthetic additional service")
    await expect(dialog.getByText(/Total: 23.00 SAR/)).toBeVisible()
    await dialog.getByRole("button",{name:/^Issue debit note$|^إصدار الإشعار المدين$/}).click()
    await expect(dialog).toBeHidden()
    const debit = await admin.from("debit_notes").select("id,total").eq("tenant_id",tenantId).eq("reference_invoice_id",original.id).single()
    if (debit.error || Number(debit.data.total)!==23) throw Error("Debit note persistence mismatch")

    stage = "full credit posted with original receivable archived"
    await menu(original.invoice_number,/^(Credit|دائن)$/)
    await dialog.locator("#cn-reason").fill("Synthetic full invoice correction")
    await dialog.getByRole("button",{name:/^Issue credit note$|^إصدار الإشعار الدائن$/}).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await invoice(original.id)).status).toBe("credited")
    const credit = await admin.from("credit_notes").select("id,total").eq("tenant_id",tenantId).eq("reference_invoice_id",original.id).single()
    const ar = await admin.from("receivables").select("source_entity_type,source_entity_id,total_amount,deleted_at").eq("tenant_id",tenantId).in("source_entity_id",[original.id,debit.data.id])
    if (credit.error || Number(credit.data.total)!==100.25 || ar.error || ar.data.length!==2 || !ar.data.some(r=>r.source_entity_id===original.id&&r.deleted_at) || !ar.data.some(r=>r.source_entity_id===debit.data.id&&!r.deleted_at&&Number(r.total_amount)===23)) throw Error("Credit/debit receivable effects mismatch")
    const noteEvents = await admin.from("financial_events").select("processing_status").eq("tenant_id",tenantId).in("source_id",[credit.data.id,debit.data.id])
    if (noteEvents.error || noteEvents.data.length!==2 || noteEvents.data.some(e=>e.processing_status!=="processed")) throw Error("Atomic note posting incomplete")

    stage = "full credit dashboard and retained debit balance in both languages"
    expect(await dashboardMoney("en")).toEqual([baseline[0] + 2000, baseline[1] + 2300])
    expect(await dashboardMoney("ar")).toEqual([baseline[0] + 2000, baseline[1] + 2300])
    await page.goto(appUrl + "/invoices?lang=en")
    stage = "issued cancellation without financial effects"
    const cancelled = await createDraft()
    await menu(cancelled.invoice_number,/^(Issue|إصدار)$/)
    await expect.poll(async () => (await invoice(cancelled.id)).status).toBe("issued")
    await expect(rowFor(cancelled.invoice_number).getByText(/^(Issued|صادرة)$/)).toBeVisible()
    await menu(cancelled.invoice_number,/^(Cancel|إلغاء)$/)
    await dialog.locator("#cancel-reason").fill("Synthetic unposted cancellation")
    await dialog.getByRole("button",{name:/^Cancel invoice$|^إلغاء الفاتورة$/}).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await invoice(cancelled.id)).status).toBe("cancelled")
    const events = await admin.from("financial_events").select("event_type").eq("tenant_id",tenantId).eq("source_id",cancelled.id)
    const effects = await admin.from("journal_entries").select("id").eq("tenant_id",tenantId).eq("source_entity_id",cancelled.id)
    if (events.error || effects.error || effects.data.length || events.data.some(e=>e.event_type!=="InvoiceIssuedEvent")) throw Error("Unposted cancellation created financial effects")
    await page.reload()
    await expect(rowFor(cancelled.invoice_number).getByText(/^(Cancelled|ملغاة)$/)).toBeVisible()
    console.log("PASS: invoice issue → zero-VAT finalize → journal balance → debit preview/posting → full credit/AR archive with debit balance retained → posted GL/AR cents in English/Arabic → issued cancellation → reload")
  } catch (error) {
    console.error(JSON.stringify({invoiceLifecycleStage:stage, failure:/^(Synthetic |Finalized invoice posting incomplete|Original journal missing or duplicated|Zero-VAT journal imbalance|Debit note persistence mismatch|Credit\/debit receivable effects mismatch|Atomic note posting incomplete|Unposted cancellation created financial effects)/.test(error.message)?error.message:"browser-or-service-assertion"}))
    throw error
  }
}
