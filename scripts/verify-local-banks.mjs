import { expect as baseExpect } from "@playwright/test"
const expect = baseExpect.configure({ timeout: 20_000 })

export async function verifyBankCrud(page, admin, tenantId, appUrl) {
  let stage = "bank fixture"
  try {
    const coa = await admin.from("chart_of_accounts").insert({ tenant_id: tenantId, account_code: "8401",
      name_ar: "Bank test asset", name_en: "Bank test asset", account_type: "asset", normal_balance: "debit" })
    if (coa.error) throw new Error("Bank ledger fixture failed")
    stage = "create bank account"
    await page.goto(`${appUrl}/accounting`)
    await page.getByRole("tab", { name: /^(Payments|المدفوعات والبنوك)$/ }).click()
    await page.getByRole("button", { name: /^(Add account|حساب جديد)$/ }).click()
    const dialog = page.getByRole("dialog")
    await dialog.locator("#bankName").fill("Browser Bank Fixture")
    await dialog.locator("#bankAccName").fill("Operating")
    await dialog.locator("#bankIban").fill("SA6084010000000000000001")
    await dialog.locator("#bankOpening").fill("12.34")
    await dialog.locator("#bankCoa").selectOption("8401")
    await dialog.getByRole("button", { name: /^(Add|إضافة)$/ }).click()
    await expect(dialog).toBeHidden()
    const card = page.getByTestId("bank-account-card").filter({ hasText: "Browser Bank Fixture" })
    await expect(card).toBeVisible()
    const read = () => admin.from("bank_accounts").select("id,account_name,opening_balance,updated_at,is_active,deleted_at")
      .eq("tenant_id", tenantId).eq("bank_name", "Browser Bank Fixture").single()
    const created = await read()
    if (created.error || Number(created.data.opening_balance) !== 12.34) throw new Error("Bank creation mismatch")
    stage = "edit bank account"
    await card.getByRole("button", { name: /^(Edit|تعديل)$/ }).click()
    await dialog.locator("#bankAccName").fill("Updated Operating")
    await dialog.getByRole("button", { name: /^(Save changes|حفظ التعديلات)$/ }).click()
    await expect(dialog).toBeHidden()
    await expect(card.getByText("Updated Operating", { exact: true })).toBeVisible()
    const edited = await read()
    if (edited.error || edited.data.account_name !== "Updated Operating" || edited.data.updated_at === created.data.updated_at) throw new Error("Bank edit mismatch")
    stage = "deactivate/reactivate bank account"
    for (const action of ["deactivate", "activate"]) {
      await card.getByRole("button", { name: action === "deactivate" ? /^(Deactivate|تعطيل)$/ : /^(Activate|تفعيل)$/ }).click()
      await dialog.getByRole("button", { name: /^(Confirm|تأكيد)$/ }).click()
      await expect(dialog).toBeHidden()
      await expect(card.getByRole("button", { name: action === "deactivate" ? /^(Activate|تفعيل)$/ : /^(Deactivate|تعطيل)$/ })).toBeVisible()
      const result = await read()
      if (result.error || result.data.is_active !== (action === "activate")) throw new Error("Bank state mismatch")
    }
    await page.screenshot({ path: "supabase/.temp/bank-desktop.png" })
    stage = "mobile bank editor"
    await page.setViewportSize({ width: 375, height: 812 })
    await card.getByRole("button", { name: /^(Edit|تعديل)$/ }).click()
    await expect(dialog).toBeVisible()
    await expect.poll(() => dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2)
    await page.screenshot({ path: "supabase/.temp/bank-mobile.png" })
    await dialog.getByRole("button", { name: "Close", exact: true }).click()
    await page.setViewportSize({ width: 1280, height: 900 })
    stage = "delete unused bank account"
    await card.getByRole("button", { name: /^(Delete|حذف)$/ }).click()
    await dialog.getByRole("button", { name: /^(Confirm|تأكيد)$/ }).click()
    await expect(dialog).toBeHidden()
    await expect(card).toHaveCount(0)
    await page.reload()
    await page.getByRole("tab", { name: /^(Payments|المدفوعات والبنوك)$/ }).click()
    await expect(card).toHaveCount(0)
    const deleted = await read()
    if (deleted.error || !deleted.data.deleted_at || deleted.data.is_active) throw new Error("Bank deletion mismatch")
    const audit = await admin.from("audit_log").select("action").eq("tenant_id", tenantId).eq("entity_id", created.data.id)
    if (audit.error || !["created", "updated", "deactivated", "activated", "deleted"]
      .every((action) => audit.data.some((entry) => entry.action === `bank_account_${action}`))) throw new Error("Bank audit incomplete")
    console.log("PASS: bank account browser create → edit → deactivate → reactivate → mobile → soft delete → reload → audit")
  } catch (error) {
    console.error(JSON.stringify({ bankStage: stage }))
    await page.screenshot({ path: "supabase/.temp/bank-crud-failure.png" })
    throw error
  }
}
