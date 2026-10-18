import { expect } from "@playwright/test"

// Called only from the guarded disposable invoice/owner-MFA workflow.
export async function verifyZatcaDisplay(page, admin, tenantId, appUrl, invoiceId) {
  const database = new URL(admin.supabaseUrl)
  const local = ["localhost","127.0.0.1"].includes(database.hostname) && database.port === "58321"
  const staging = database.origin === "https://viowrovartosrkqukjxy.supabase.co"
  if (!local && !staging) throw new Error("ZATCA display verification requires a disposable database")
  if (staging) {
    const policy = (await fetch(appUrl+"/landing")).headers.get("content-security-policy") ?? ""
    if (!policy.includes(database.origin) || policy.includes("https://wwfnsbilmyxeawgzicmv.supabase.co")) throw new Error("App is not bound to isolated staging")
  } else if (!["localhost","127.0.0.1"].includes(new URL(appUrl).hostname)) throw new Error("Local app required")
  const viewport = page.viewportSize()
  const locale = await page.locator("html").getAttribute("lang")
  let fixtureId
  try {
    const record = await admin.from("zatca_transmissions").insert({tenant_id:tenantId,invoice_id:invoiceId,doc_type:"invoice",doc_ref:"SYNTHETIC-MOCK-NOT-SUBMITTED",payload_xml:"<Invoice/>",status:"reported",response:{sandbox:true,status:"reported",validationResults:{status:"NOT_VALIDATED"}}}).select("id").single()
    if (record.error) throw new Error("ZATCA mock display fixture failed")
    fixtureId = record.data.id
    for (const [lang,width,height] of [["en",1280,900],["ar",390,844]]) {
      await page.setViewportSize({width,height})
      await page.goto(`${appUrl}/accounting?lang=${lang}`)
      await page.getByRole("tab",{name:/ZATCA/}).click()
      const row = page.getByRole("row").filter({hasText:"SYNTHETIC-MOCK-NOT-SUBMITTED"})
      await expect(row.getByText(lang==="en"?"Mock — not submitted":"محاكاة — لم تُرسل للهيئة",{exact:true})).toBeVisible()
      await expect(page.getByRole("status").filter({hasText:lang==="en"?"ZATCA integration is incomplete":"ربط ZATCA غير مكتمل"})).toBeVisible()
      await expect(page.getByRole("button",{name:/Run adapter|تشغيل المحوّل/})).toBeDisabled()
      await row.getByRole("button",{name:/^View$|^عرض$/}).click()
      const detail=page.getByRole("dialog")
      await expect(detail).toContainText(lang==="en"?"Mock — not submitted":"محاكاة — لم تُرسل للهيئة")
      await page.keyboard.press("Escape")
      await expect(detail).toBeHidden()
      if (await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)) throw new Error("ZATCA mobile viewport overflow")
    }
    console.log("PASS: ZATCA historical mock is not authority acceptance; disabled submissions and English/Arabic mobile details")
  } finally {
    if (fixtureId) {
      const deleted=await admin.from("zatca_transmissions").delete().eq("id",fixtureId).eq("tenant_id",tenantId)
      if (deleted.error) throw new Error("ZATCA synthetic fixture cleanup failed")
    }
    if (viewport) await page.setViewportSize(viewport)
    await page.goto(`${appUrl}/invoices?lang=${locale==="ar"?"ar":"en"}`)
  }
}
