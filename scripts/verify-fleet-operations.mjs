import { assertModuleTestTarget } from "./assert-module-test-target.mjs"
import { expect as baseExpect } from "@playwright/test"
const expect = baseExpect.configure({ timeout: 20_000 })
/** Real authenticated UI + persisted records; production is explicitly excluded. */
export async function verifyFleetOperations(page, admin, tenantId, appUrl) {
 await assertModuleTestTarget(page,admin.supabaseUrl,appUrl)
  const app = new URL(appUrl), backend = new URL(admin.supabaseUrl)
  const local = ["localhost", "127.0.0.1"].includes(app.hostname) && ["localhost", "127.0.0.1"].includes(backend.hostname)
  const staging = app.protocol === "https:" && app.hostname.endsWith(".vercel.app") && app.hostname !== "elite-dashboard-blush.vercel.app" && backend.hostname === "viowrovartosrkqukjxy.supabase.co"
  if (!local && !staging) throw new Error("Fleet verification requires loopback or the approved isolated staging project")
  let step = "synthetic fixture"
  try {
    const plate = String(Date.now()).slice(-7), suffix = crypto.randomUUID().slice(0, 8)
    const fixture = await admin.from("drivers").insert({ tenant_id: tenantId, full_name_ar: "سائق اختبار الأسطول " + suffix, full_name_en: "Fleet browser " + suffix, primary_mobile: "0501330001", category: "freelancer", status: "active" }).select("id").single()
    if (fixture.error) throw new Error("Synthetic driver fixture failed")
    const driverId = fixture.data.id
    const read = async (table, id) => {
      const result = await admin.from(table).select("*").eq("tenant_id", tenantId).eq("id", id).single()
      if (result.error) throw new Error("Persisted synthetic fleet row unavailable")
      return result.data
    }
    const vehicleRead = async () => {
      const result = await admin.from("vehicles").select("*").eq("tenant_id", tenantId).eq("plate_number", plate).single()
      if (result.error) throw new Error("Vehicle fixture unavailable")
      return result.data
    }
    const dialog = page.getByRole("dialog")
    step = "vehicle create and edit"
    await page.goto(appUrl + "/vehicles?lang=en")
    await page.getByRole("button", { name: "Add Vehicle", exact: true }).click()
    await dialog.locator('input[name="plate_number"]').fill(plate)
    await dialog.locator('input[name="make"]').fill("Toyota")
    await dialog.locator('input[name="model"]').fill("Browser fixture " + suffix)
    await dialog.getByRole("button", { name: "Create vehicle", exact: true }).click()
    await expect(page).toHaveURL(/\/vehicles\/[0-9a-f-]+/)
    const vehicleId = (await vehicleRead()).id
    expect(await vehicleRead()).toMatchObject({ status: "available", odometer_current: 0 })
    await page.getByRole("button", { name: "Edit vehicle", exact: true }).click()
    await dialog.locator('input[name="color"]').fill("Pearl")
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(dialog).toBeHidden()
    expect((await vehicleRead()).color).toBe("Pearl")

    step = "private document upload and edit from empty state"
    await page.getByRole("tab", { name: "Documents", exact: true }).click()
    await expect(page.getByText("No documents yet. Upload the first vehicle document.", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Upload document", exact: true }).click()
    await dialog.locator("#fleet-document-number").fill("Fleet doc " + suffix)
    await dialog.locator("#fleet-document-file").setInputFiles({ name: "fleet-fixture.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF") })
    await dialog.getByRole("button", { name: "Save document", exact: true }).click()
    await expect(dialog).toBeHidden()
    const documents = await admin.from("vehicle_documents").select("*").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).is("deleted_at", null)
    expect(documents.error).toBeNull()
    expect(documents.data).toHaveLength(1)
    const docId = documents.data[0].id
    expect(documents.data[0].file_url.startsWith(tenantId + "/" + vehicleId + "/")).toBeTruthy()
    let docRow = page.getByRole("article").filter({ hasText: "Fleet doc " + suffix })
    await docRow.getByRole("button", { name: "Edit", exact: true }).click()
    await dialog.locator("#fleet-document-number").fill("Edited fleet doc " + suffix)
    await dialog.getByRole("button", { name: "Save document", exact: true }).click()
    await expect(dialog).toBeHidden()
    expect((await read("vehicle_documents", docId)).doc_number).toBe("Edited fleet doc " + suffix)
    docRow = page.getByRole("article").filter({ hasText: "Edited fleet doc " + suffix })
    step = "private document open, verify and archive"
    const popupPromise = page.waitForEvent("popup")
    await docRow.getByRole("button", { name: "Open", exact: true }).click()
    const popup = await popupPromise
    await popup.waitForLoadState("domcontentloaded").catch(() => {})
    await popup.close()
    await docRow.getByRole("button", { name: "Verify", exact: true }).click()
    await expect(docRow.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0)
    expect((await read("vehicle_documents", docId)).is_verified).toBe(true)
    await docRow.getByRole("button", { name: "Archive", exact: true }).click()
    await dialog.locator("#document-archive-reason").fill("Superseded synthetic document")
    await dialog.getByRole("button", { name: "Archive", exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(await read("vehicle_documents", docId)).toMatchObject({ is_active: false, deleted_at: expect.any(String) })

    step = "assignment and handover workflow"
    await page.getByRole("tab", { name: "Overview", exact: true }).click()
    await page.getByRole("button", { name: "Assign driver", exact: true }).click()
    await dialog.locator("#assign-driver").selectOption(driverId)
    await dialog.getByRole("button", { name: "Assign", exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await vehicleRead()).status).toBe("assigned")
    const assigned = await admin.from("vehicle_assignments").select("*").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).eq("is_current", true).single()
    expect(assigned.error).toBeNull()
    expect(assigned.data.driver_id).toBe(driverId)
    const assignmentId = assigned.data.id
    await page.getByRole("tab", { name: "Handover Forms", exact: true }).click()
    const fillInspection = async () => {
      await dialog.locator("#handover-assignment").selectOption(assignmentId)
      await dialog.locator("#handover-odometer").fill("0")
      await dialog.locator("#handover-fuel").selectOption("full")
      await dialog.locator("#handover-overall").selectOption("good")
      for (const select of await dialog.locator('select[id^="handover-"]').all()) {
        const id = await select.getAttribute("id")
        if (["handover-assignment", "handover-type", "handover-fuel", "handover-overall"].includes(id)) continue
        const values = await select.locator("option").evaluateAll(options => options.map(option => option.value))
        await select.selectOption(values.includes("ok") ? "ok" : "true")
      }
    }
    await page.getByRole("button", { name: "Add handover", exact: true }).click()
    await fillInspection()
    await dialog.getByRole("button", { name: "Save inspection", exact: true }).click()
    await expect(dialog).toBeHidden()
    let forms = await admin.from("vehicle_handover_forms").select("*").eq("tenant_id", tenantId).eq("assignment_id", assignmentId).is("deleted_at", null)
    expect(forms.data).toHaveLength(1)
    const draftId = forms.data[0].id
    await page.getByRole("button", { name: "Edit inspection", exact: true }).click()
    await dialog.locator("#handover-notes").fill("Corrected physical observation")
    await page.setViewportSize({ width: 375, height: 812 })
    await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2)
    await page.screenshot({ path: "supabase/.temp/fleet-handover-mobile.png" })
    await dialog.getByRole("button", { name: "Save inspection", exact: true }).click()
    await expect(dialog).toBeHidden()
    expect((await read("vehicle_handover_forms", draftId)).notes).toBe("Corrected physical observation")
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole("article").filter({ hasText: "Draft" }).getByRole("button", { name: "Archive", exact: true }).click()
    await dialog.locator("#handover-archive-reason").fill("Replace draft after inspection")
    await dialog.getByRole("button", { name: "Archive", exact: true }).click()
    await expect(dialog).toBeHidden()
    expect((await read("vehicle_handover_forms", draftId)).deleted_at).toBeTruthy()
    await page.getByRole("button", { name: "Add handover", exact: true }).click()
    await fillInspection()
    await dialog.getByRole("checkbox").check()
    await dialog.getByRole("button", { name: "Save inspection", exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole("button", { name: "Edit inspection", exact: true })).toHaveCount(0)
    forms = await admin.from("vehicle_handover_forms").select("*").eq("tenant_id", tenantId).eq("assignment_id", assignmentId).is("deleted_at", null)
    expect(forms.data[0].finalized_at).toBeTruthy()
    expect(forms.data[0].driver_acknowledged_at).toBeNull()

    step = "maintenance create, edit, start and guarded vehicle release"
    await page.goto(appUrl + "/maintenance?lang=en")
    const createEvent = async (fault) => {
      await page.getByRole("button", { name: "Add maintenance event", exact: true }).click()
      await dialog.getByLabel("Vehicle", { exact: true }).selectOption(vehicleId)
      await dialog.getByLabel("Fault description", { exact: true }).fill(fault)
      await dialog.getByRole("button", { name: "Save", exact: true }).click()
      await expect(dialog).toBeHidden()
      const row = page.getByRole("row").filter({ hasText: fault })
      await expect(row).toBeVisible()
      return row
    }
    const faultOne = "Fleet service one " + suffix, faultTwo = "Fleet service two " + suffix
    let first = await createEvent(faultOne)
    await first.getByTitle("Edit", { exact: true }).click()
    await dialog.getByLabel("Provider", { exact: true }).fill("Browser garage")
    await dialog.getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog).toBeHidden()
    await createEvent(faultTwo)
    first = page.getByRole("row").filter({ hasText: faultOne })
    await first.getByTitle("Start work", { exact: true }).click()
    await expect.poll(async () => (await vehicleRead()).status).toBe("in_maintenance")
    await first.getByTitle("Complete event", { exact: true }).click()
    await dialog.getByLabel("Cost (SAR)", { exact: true }).fill("123.45")
    await dialog.getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog).toBeHidden()
    expect((await vehicleRead()).status).toBe("in_maintenance")
    await page.goto(appUrl + "/vehicles/" + vehicleId + "?lang=en")
    await page.getByRole("button", { name: "Unassign", exact: true }).click()
    await expect.poll(async () => (await read("drivers", driverId)).current_vehicle_id).toBeNull()
    expect((await vehicleRead()).status).toBe("in_maintenance")
    await page.goto(appUrl + "/maintenance?lang=en")
    const second = page.getByRole("row").filter({ hasText: faultTwo })
    await second.getByTitle("Cancel event", { exact: true }).click()
    await dialog.getByRole("textbox").fill("Second synthetic service not needed")
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await vehicleRead()).status).toBe("available")
    await second.getByTitle("Archive", { exact: true }).click()
    await dialog.getByRole("textbox").fill("Archive cancelled synthetic event")
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(second).toHaveCount(0)
    step = "safe vehicle archival"
    await page.goto(appUrl + "/vehicles/" + vehicleId + "?lang=en")
    await page.getByRole("button", { name: "Archive vehicle", exact: true }).click()
    await dialog.locator("#vehicle-archive-reason").fill("Retire synthetic browser vehicle")
    await dialog.getByRole("button", { name: "Archive", exact: true }).click()
    await expect(page).toHaveURL(/\/vehicles(?:\?[^/]*)?$/)
    expect(await vehicleRead()).toMatchObject({ status: "retired", deleted_at: expect.any(String) })
    console.log("PASS: fleet vehicle/document/handover CRUD, private upload/view/verify, assignment pointers, maintenance lifecycle, mobile form and cross-module vehicle holds")
  } catch (error) {
    console.error(JSON.stringify({ check: "fleet-operations", stage: step, errorType: error.name }))
    throw new Error("Fleet browser verification failed: " + step)
  }
}
