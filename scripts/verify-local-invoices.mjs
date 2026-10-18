import { expect as baseExpect } from "@playwright/test"
import { randomInt } from "node:crypto"

const expect = baseExpect.configure({ timeout: 20_000 })

// Called only from the loopback-only MFA harness after authenticated enrollment.
export async function verifyInvoiceCrud(page, admin, tenantId, appUrl) {
  let stage = "customer fixture"
  try {
    const customer = await admin.from("customers").insert({
      tenant_id: tenantId, name_ar: "Invoice browser fixture", name_en: "Invoice browser fixture",
    }).select("id").single()
    if (customer.error) throw new Error("Invoice customer fixture failed")
    stage = "open invoice page"
    await page.goto(`${appUrl}/invoices`)
    await page.getByRole("button", { name: /New invoice|فاتورة جديدة/ }).click()
    const dialog = page.getByRole("dialog")
    stage = "fill invoice"
    await dialog.locator("#inv-party").selectOption(customer.data.id)
    await dialog.getByLabel(/Line description|وصف البند/).fill("Browser verified service")
    await dialog.getByLabel(/Unit price|سعر الوحدة/).fill("4.10")
    stage = "verify decimal preview"
    await expect(dialog.getByText("4.72", { exact: true })).toBeVisible()
    await dialog.getByRole("button", { name: /Save draft|حفظ المسودة/ }).click()
    await expect(dialog).toBeHidden()
    await page.screenshot({ path: "supabase/.temp/invoice-desktop.png", fullPage: true })
    const readInvoice = () => admin.from("invoices").select("id,total,status,updated_at,deleted_at")
      .eq("tenant_id", tenantId).eq("customer_id", customer.data.id).single()
    stage = "verify persisted create"
    const created = await readInvoice()
    if (created.error || Number(created.data.total) !== 4.72 || created.data.status !== "draft") {
      throw new Error("Invoice creation persistence mismatch")
    }
    const row = page.getByRole("row").filter({ hasText: "Invoice browser fixture" })
    stage = "edit draft"
    await row.getByRole("button", { name: /Invoice actions|إجراءات الفاتورة/ }).click()
    await page.getByRole("menuitem", { name: /^(Edit|تعديل)$/ }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByLabel(/Unit price|سعر الوحدة/).fill("10")
    await expect(dialog.getByText("11.50", { exact: true })).toBeVisible()
    await dialog.getByRole("button", { name: /Save draft|حفظ المسودة/ }).click()
    await expect(dialog).toBeHidden()
    stage = "verify persisted edit"
    const edited = await readInvoice()
    if (edited.error || edited.data.id !== created.data.id || Number(edited.data.total) !== 11.5 ||
        edited.data.updated_at === created.data.updated_at) throw new Error("Invoice update persistence mismatch")

    stage = "mobile layout"
    await page.setViewportSize({ width: 375, height: 812 })
    await row.getByRole("button", { name: /Invoice actions|إجراءات الفاتورة/ }).click()
    await page.getByRole("menuitem", { name: /^(Edit|تعديل)$/ }).click()
    await expect(dialog).toBeVisible()
    await expect.poll(() => dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2)
    await page.screenshot({ path: "supabase/.temp/invoice-mobile.png" })
    const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
    if (widths[0] > widths[1] + 2) throw new Error("Invoice mobile viewport overflows")
    await dialog.getByRole("button", { name: /^(Cancel|إلغاء)$/ }).click()
    await page.setViewportSize({ width: 1280, height: 900 })
    stage = "invoice print and PDF preview"
    const fixtureVat = `3${randomInt(1_000_000_000_000, 10_000_000_000_000)}3`
    const vat = await admin.from("tenants").update({ vat_number: fixtureVat }).eq("id", tenantId)
    if (vat.error) throw new Error("Print tenant fixture failed")
    await page.context().addInitScript(() => { window.print = () => { window.__invoicePrinted = true } })
    await row.getByRole("button", { name: /Invoice actions|إجراءات الفاتورة/ }).click()
    await page.getByRole("menuitem", { name: /Print \/ Save PDF|طباعة \/ حفظ PDF/ }).click()
    await expect(dialog.getByRole("note")).toContainText(/current QR is internal|الرمز الحالي داخلي/)
    const popupPromise = page.waitForEvent("popup")
    await dialog.getByRole("button", { name: /Open invoice for printing|فتح الفاتورة للطباعة/ }).click()
    const popup = await popupPromise
    await expect(popup.locator(".items tbody tr")).toHaveCount(1)
    await expect(popup.locator(".items tbody td:last-child")).toHaveText("11.50")
    await expect(popup.locator(".status")).toContainText("Draft")
    await expect(popup.getByRole("note")).toContainText("Internal QR only.")
    await expect.poll(() => popup.evaluate(() => window.__invoicePrinted === true)).toBe(true)
    if (!await popup.locator(".logo").evaluate((img) => img.complete && img.naturalWidth > 0)) throw new Error("Invoice logo did not load")
    await popup.pdf({ path: "supabase/.temp/invoice-browser-print.pdf", preferCSSPageSize: true, printBackground: true })
    await popup.close()
    await expect(dialog).toBeHidden()
    stage = "delete draft"
    await row.getByRole("button", { name: /Invoice actions|إجراءات الفاتورة/ }).click()
    await page.getByRole("menuitem", { name: /^(Delete|حذف)$/ }).click()
    await dialog.getByRole("button", { name: /^(Delete draft|حذف المسودة)$/ }).click()
    await expect(dialog).toBeHidden()
    await expect(row).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole("row").filter({ hasText: "Invoice browser fixture" })).toHaveCount(0)
    const deleted = await readInvoice()
    if (deleted.error || !deleted.data.deleted_at) throw new Error("Invoice soft deletion persistence mismatch")
    const audit = await admin.from("audit_log").select("action")
      .eq("tenant_id", tenantId).eq("entity_id", created.data.id)
    if (audit.error || !["invoice_draft_created", "invoice_draft_updated", "invoice_draft_deleted"]
      .every((action) => audit.data.some((entry) => entry.action === action))) throw new Error("Invoice audit lifecycle incomplete")
    console.log("PASS: invoice browser create → exact VAT → edit → mobile → print/PDF with loaded logo and gross VAT → soft delete → reload → audit")
  } catch (error) {
    console.error(JSON.stringify({ invoiceStage: stage }))
    await page.screenshot({ path: "supabase/.temp/invoice-crud-failure.png", fullPage: true })
    throw error
  }
}
