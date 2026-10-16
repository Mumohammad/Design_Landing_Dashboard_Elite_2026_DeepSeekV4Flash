import { expect as baseExpect } from "@playwright/test"
const expect = baseExpect.configure({ timeout: 20_000 })

// Only invoked by the loopback-only MFA harness, using disposable tenant data.
export async function verifyJournalCrud(page, admin, tenantId, appUrl) {
  let stage = "journal accounts"
  try {
    const fixture = await admin.from("chart_of_accounts").insert([
      { tenant_id: tenantId, account_code: "8301", name_ar: "Test cash", name_en: "Test cash", account_type: "asset", normal_balance: "debit" },
      { tenant_id: tenantId, account_code: "8302", name_ar: "Test income", name_en: "Test income", account_type: "income", normal_balance: "credit" },
    ]).select("id,account_code")
    if (fixture.error) throw new Error("Journal accounts failed")
    const cash = fixture.data.find((account) => account.account_code === "8301").id
    const income = fixture.data.find((account) => account.account_code === "8302").id
    stage = "create journal"
    await page.goto(`${appUrl}/accounting`)
    await page.getByRole("button", { name: /New entry|قييد جديد/ }).click()
    const dialog = page.getByRole("dialog")
    await dialog.locator("#entryDesc").fill("Browser journal fixture")
    await dialog.getByLabel(/^(Account|الحساب) 1$/).selectOption(cash)
    await dialog.getByLabel(/^(Account|الحساب) 2$/).selectOption(income)
    await dialog.getByLabel(/^(Debit|مدين) 1$/).fill("12.34")
    await dialog.getByLabel(/^(Credit|دائن) 2$/).fill("12.34")
    await dialog.getByRole("button", { name: /Save draft|حفظ كمسودة/ }).click()
    await expect(dialog).toBeHidden()
    const row = page.getByRole("row").filter({ hasText: "Browser journal fixture" })
    await expect(row).toBeVisible()
    const read = () => admin.from("journal_entries").select("id,status,updated_at,deleted_at,journal_entry_lines(debit_amount,credit_amount)")
      .eq("tenant_id", tenantId).eq("description_ar", "Browser journal fixture").single()
    const created = await read()
    if (created.error || created.data.status !== "draft") throw new Error("Draft persistence mismatch")
    stage = "edit journal"
    await row.getByRole("button", { name: /^(Edit|تعديل)$/ }).click()
    await dialog.getByLabel(/^(Debit|مدين) 1$/).fill("20.10")
    await dialog.getByLabel(/^(Credit|دائن) 2$/).fill("20.10")
    await dialog.getByRole("button", { name: /Save draft|حفظ كمسودة/ }).click()
    await expect(dialog).toBeHidden()
    const edited = await read()
    if (edited.error || edited.data.updated_at === created.data.updated_at ||
      edited.data.journal_entry_lines.length !== 2 ||
      edited.data.journal_entry_lines.reduce((sum, line) => sum + Number(line.debit_amount), 0) !== 20.10) throw new Error("Edit persistence mismatch")
    await page.screenshot({ path: "supabase/.temp/journal-desktop.png" })
    stage = "mobile journal editor"
    await page.setViewportSize({ width: 375, height: 812 })
    await row.getByRole("button", { name: /^(Edit|تعديل)$/ }).click()
    await expect(dialog).toBeVisible()
    await expect.poll(() => dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2)
    await page.screenshot({ path: "supabase/.temp/journal-mobile.png" })
    await dialog.getByRole("button", { name: "Close", exact: true }).click()
    await page.setViewportSize({ width: 1280, height: 900 })
    stage = "delete journal"
    await row.getByRole("button", { name: /^(Delete|حذف)$/ }).click()
    await dialog.getByRole("button", { name: /^(Delete draft|حذف المسودة)$/ }).click()
    await expect(dialog).toBeHidden()
    await expect(row).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole("row").filter({ hasText: "Browser journal fixture" })).toHaveCount(0)
    const deleted = await read()
    if (deleted.error || !deleted.data.deleted_at || deleted.data.journal_entry_lines.length !== 2) throw new Error("Journal soft deletion mismatch")
    const audit = await admin.from("audit_log").select("action").eq("tenant_id", tenantId).eq("entity_id", created.data.id)
    if (audit.error || !["journal_draft_created", "journal_draft_updated", "journal_draft_deleted"]
      .every((action) => audit.data.some((entry) => entry.action === action))) throw new Error("Journal audit incomplete")
    console.log("PASS: journal browser create → edit → persisted lines → mobile editor → soft delete → reload → audit")
  } catch (error) {
    console.error(JSON.stringify({ journalStage: stage }))
    await page.screenshot({ path: "supabase/.temp/journal-crud-failure.png" })
    throw error
  }
}
