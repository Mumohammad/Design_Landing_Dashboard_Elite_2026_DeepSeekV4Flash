import {assertModuleTestTarget} from "./assert-module-test-target.mjs"
import { expect as baseExpect } from "@playwright/test"
const expect = baseExpect.configure({ timeout: 20_000 })

/** Real authenticated UI + persisted local rows. Called only by the loopback MFA harness. */
export async function verifyDriverProfileOperations(page, admin, tenantId, appUrl) {
  await assertModuleTestTarget(page,admin.supabaseUrl,appUrl)
  let stage = "driver fixture"
  try {
    const created = await admin.from("drivers").insert({ tenant_id: tenantId, full_name_ar: "سائق اختبار العمليات", full_name_en: "Driver operation fixture", primary_mobile: "0501320001", category: "freelancer", status: "active" }).select("id").single()
    if (created.error) throw new Error("Driver fixture failed")
    const driverId = created.data.id
    const read = async (table, where = {}) => {
      let query = admin.from(table).select("*").eq("tenant_id", tenantId).eq("driver_id", driverId)
      for (const [key, value] of Object.entries(where)) query = query.eq(key, value)
      const result = await query.single()
      if (result.error) throw new Error(`${table} persisted row unavailable`)
      return result.data
    }
    const choose = async (id, name) => { await page.locator(`#${id}`).click(); await page.getByRole("option", { name, exact: true }).click() }
    const save = async (creating = false) => {
      const selectedTabName = (await page.getByRole("tab", { selected: true }).innerText()).trim()
      const dialog = page.getByRole("dialog")
      await Promise.all([
        page.waitForResponse(response => {
          const url = new URL(response.url())
          return response.request().method() === "GET" && url.pathname === "/rest/v1/drivers" && url.searchParams.get("id") === `eq.${driverId}` && response.status() === 200
        }),
        (async () => {
          await dialog.getByRole("button", { name: creating ? "Add" : "Save changes", exact: true }).click()
          await expect(dialog).toBeHidden()
        })(),
      ])
      await expect(page.getByRole("tab", { name: selectedTabName, exact: true })).toHaveAttribute("aria-selected", "true")
    }
    await page.evaluate(() => localStorage.setItem("elite-locale", "en"))
    await page.goto(`${appUrl}/drivers/${driverId}`)

    stage = "first training record from empty state"
    await page.getByRole("tab", { name: "Training", exact: true }).click()
    await expect(page.getByText("No training records yet", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Add training record", exact: true }).click()
    let dialog = page.getByRole("dialog")
    await dialog.locator("#training-course_name").fill("Browser safety training")
    await dialog.locator("#training-training_date").fill("2098-10-21")
    await dialog.locator("#training-score").fill("88")
    await save(true)
    expect((await read("training_records")).course_name).toBe("Browser safety training")

    stage = "training edit and result state"
    let row = page.getByRole("row").filter({ hasText: "Browser safety training" })
    await expect(row).toBeVisible()
    await expect(page.getByRole("tab", { name: "Training", exact: true })).toHaveAttribute("aria-selected", "true")
    await row.getByRole("button", { name: "Edit", exact: true }).click()
    await dialog.locator("#training-provider").fill("Browser provider edited")
    await choose("training-is_passed", "Passed")
    await save()
    expect(await read("training_records")).toMatchObject({ provider: "Browser provider edited", is_passed: true })
    await expect(row).toContainText("Browser provider edited")
    await expect(row).toContainText("Passed")
    stage = "training mobile dialog and archive"
    await page.setViewportSize({ width: 375, height: 812 })
    await row.getByRole("button", { name: "Edit", exact: true }).click()
    await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2)
    await page.screenshot({ path: "supabase/.temp/driver-operations-mobile.png" })
    await dialog.getByRole("button", { name: "Archive", exact: true }).click()
    await dialog.getByRole("button", { name: "Confirm archive", exact: true }).click()
    await expect(dialog).toBeHidden()
    expect((await read("training_records")).deleted_at).toBeTruthy()
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(page.getByText("No training records yet", { exact: true })).toBeVisible()

    stage = "attendance Saudi timestamp creation"
    await page.getByRole("tab", { name: "Attendance", exact: true }).click()
    await page.getByRole("button", { name: "Add attendance day", exact: true }).click()
    await dialog.locator("#attendance-attendance_date").fill("2098-10-21")
    await dialog.locator("#attendance-check_in_time").fill("00:15")
    await dialog.locator("#attendance-check_out_time").fill("09:30")
    await save(true)
    let attendance = await read("driver_attendance")
    expect(new Date(attendance.check_in_time).toISOString()).toBe("2098-10-20T21:15:00.000Z")
    row = page.getByRole("row").filter({ hasText: "2098-10-21" })
    await row.getByRole("button", { name: "Edit", exact: true }).click()
    await expect(dialog.locator("#attendance-check_in_time")).toHaveValue("00:15")
    await dialog.locator("#attendance-notes").fill("Attendance edited")
    await save()
    expect((await read("driver_attendance")).notes).toBe("Attendance edited")
    stage = "locked attendance error persists with entered values"
    const locked = await admin.from("attendance_periods").insert({ tenant_id: tenantId, period_year: 2098, period_month: 10, start_date: "2098-10-01", end_date: "2098-10-31", status: "locked" })
    if (locked.error) throw new Error("Period lock fixture failed")
    await row.getByRole("button", { name: "Edit", exact: true }).click()
    await dialog.locator("#attendance-notes").fill("Locked edit must fail")
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(dialog.getByRole("alert")).toContainText("PAY_PREPARATION_LOCKED")
    await expect(dialog.locator("#attendance-notes")).toHaveValue("Locked edit must fail")
    expect((await read("driver_attendance")).notes).toBe("Attendance edited")
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()

    stage = "HR review create and guarded completion"
    await page.getByRole("tab", { name: "Performance", exact: true }).click()
    await page.getByRole("button", { name: "Add performance review", exact: true }).click()
    await dialog.locator("#performance-review_period").fill("Browser review")
    await dialog.locator("#performance-review_date").fill("2098-10-21")
    for (const key of ["attendance_score", "violations_score", "platform_kpi_score", "overall_score"]) await dialog.locator(`#performance-${key}`).fill("85")
    await save(true)
    row = page.getByRole("row").filter({ hasText: "Browser review" })
    await row.getByRole("button", { name: "Edit", exact: true }).click()
    await choose("performance-status", "in progress")
    await save()
    await row.getByRole("button", { name: "Edit", exact: true }).click()
    await choose("performance-status", "completed")
    await save()
    expect((await read("performance_reviews")).status).toBe("completed")
    await row.getByRole("button", { name: "Edit", exact: true }).click()
    await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled()
    await expect(dialog.getByRole("button", { name: "Archive", exact: true })).toHaveCount(0)
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()

    stage = "manual violation without preseeded catalog"
    await page.getByRole("tab", { name: "Violations", exact: true }).click()
    await page.getByRole("button", { name: "Add violation", exact: true }).click()
    await dialog.locator("#incident_date").fill("2098-10-21")
    await dialog.locator("#incident_description").fill("Browser violation fixture")
    await dialog.locator("#deduction_amount").fill("12.34")
    await dialog.getByRole("button", { name: "Save", exact: true }).click()
    await expect(dialog).toBeHidden()
    let violation = await read("violations")
    expect(violation.status).toBe("open")
    expect(violation.violation_type_id).toBeNull()
    row = page.getByRole("row").filter({ hasText: violation.violation_ref })
    stage = "violation edit then review to pending payroll deduction"
    await row.getByRole("button", { name: "Edit", exact: true }).click()
    await dialog.locator("#violations-incident_location").fill("Browser location edited")
    await choose("violations-status", "under review")
    await save()
    await row.getByRole("button", { name: "Edit", exact: true }).click()
    await choose("violations-status", "resolved")
    await dialog.locator("#violations-review_notes").fill("Reviewed browser deduction")
    await dialog.locator("#violations-deduction_month").fill("2098-11")
    await save()
    violation = await read("violations")
    expect(violation).toMatchObject({ status: "resolved", incident_location: "Browser location edited", deduction_applied: false })
    const ledger = await admin.from("violation_deduction_ledger").select("status,deduction_month,deduction_amount").eq("tenant_id", tenantId).eq("violation_id", violation.id).single()
    expect(ledger.error).toBeNull()
    expect(ledger.data).toMatchObject({ status: "pending", deduction_month: "2098-11", deduction_amount: 12.34 })
    await row.getByRole("button", { name: "Edit", exact: true }).click()
    await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled()
    await expect(dialog.getByRole("button", { name: "Archive", exact: true })).toHaveCount(0)
    await page.screenshot({ path: "supabase/.temp/driver-operations-desktop.png" })
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    stage = "another driver opens its own Overview section"
    const otherDriverName = `سائق اختبار ملف آخر ${driverId.slice(0, 8)}`
    const otherDriver = await admin.from("drivers").insert({ tenant_id: tenantId, full_name_ar: otherDriverName, full_name_en: "Second driver section fixture", primary_mobile: "0501320002", category: "freelancer", status: "active" }).select("id").single()
    if (otherDriver.error) throw new Error("Second driver fixture failed")
    await page.getByRole("button", { name: "Back", exact: true }).click()
    await expect(page).toHaveURL(`${appUrl}/drivers`)
    await page.getByText(otherDriverName, { exact: true }).click()
    await expect(page).toHaveURL(`${appUrl}/drivers/${otherDriver.data.id}`)
    await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tab", { name: "Violations", exact: true })).toHaveAttribute("aria-selected", "false")
    console.log("PASS: authenticated driver profile training create/edit/result/archive with retained section and fresh rows, Saudi attendance create/edit/lock denial, HR completion/history, violation review/pending deduction/history, isolated next-driver Overview")
  } catch (error) {
    console.error(JSON.stringify({ check: "driver-profile-operations", stage, errorType: error.name }))
    throw new Error(`Driver profile operations browser verification failed: ${stage}`)
  }
}
