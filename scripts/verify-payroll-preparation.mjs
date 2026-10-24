import { expect as baseExpect } from "@playwright/test"
import { setTimeout as delay } from "node:timers/promises"
const expect = baseExpect.configure({ timeout: 20_000 })
// Respect the real ten-write/minute control; never disable it for acceptance.
let lastPayrollInteraction = 0
async function pacePayrollInteraction() {
  const remaining = 6_200 - (Date.now() - lastPayrollInteraction)
  if (remaining > 0) await delay(remaining)
  lastPayrollInteraction = Date.now()
}

/** Run first in a disposable MFA-owner tenant, before other module driver fixtures. */
export async function verifyPayrollPreparation(page, admin, tenantId, appUrl) {
  const databaseHost = new URL(admin.supabaseUrl).hostname
  if (!["127.0.0.1", "localhost", "viowrovartosrkqukjxy.supabase.co"].includes(databaseHost)) throw new Error("Payroll acceptance requires isolated local or staging database")
  if (new URL(appUrl).hostname === "elite-dashboard-blush.vercel.app") throw new Error("Payroll acceptance must not run against production")
  let stage = "empty synthetic tenant"
  try {
    const existing = await admin.from("drivers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("deleted_at", null)
    if (existing.error || existing.count !== 0) throw new Error("Payroll helper must run first in a fresh synthetic tenant")
    const created = await admin.from("drivers").insert({ tenant_id: tenantId, full_name_ar: "سائق اختبار تحضير الرواتب", full_name_en: "Payroll preparation fixture", primary_mobile: "0500960001", category: "sponsored_type1", status: "active", hire_date: "2000-01-01" }).select("id").single()
    if (created.error) throw new Error("Payroll driver fixture failed")
    const driverId = created.data.id
    const read = async (table, extra = {}) => {
      let query = admin.from(table).select("*").eq("tenant_id", tenantId).eq("driver_id", driverId)
      for (const [key, value] of Object.entries(extra)) query = query.eq(key, value)
      const result = await query.single()
      if (result.error) throw new Error(`${table} persisted row unavailable`)
      return result.data
    }
    await page.evaluate(() => localStorage.setItem("elite-locale", "en"))
    await page.goto(`${appUrl}/payroll/preparation?lang=en`)
    await page.getByLabel("Year", { exact: true }).fill("2001")
    await page.getByLabel("Month", { exact: true }).selectOption("2")
    await expect(page.getByLabel("Working days in this period", { exact: true })).toBeVisible()
    await page.getByLabel("Working days in this period", { exact: true }).fill("24")
    await pacePayrollInteraction(); await page.getByRole("button", { name: "Open preparation period", exact: true }).click()
    await expect(page.getByText("Period status:", { exact: false })).toContainText("Open")

    stage = "explicit pay rule create and edit"
    const ruleSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Pay rules", exact: true }) })
    await ruleSection.getByLabel("Effective date", { exact: true }).fill("2001-02-01")
    for (const [name, value] of [["Target working days", "24"], ["Monthly order target", "300"], ["Base salary (SAR)", "2700"], ["Bonus per extra order (SAR)", "0"], ["Deduction per missing order (SAR)", "0"], ["Minimum net floor (SAR)", "0"]]) await ruleSection.getByLabel(name, { exact: true }).fill(value)
    await ruleSection.getByLabel("Rule review note", { exact: true }).fill("Owner reviewed explicit pay values")
    await pacePayrollInteraction(); await ruleSection.getByRole("button", { name: "Create pay rule", exact: true }).click()
    await expect(ruleSection.getByRole("button", { name: "Edit rule", exact: true })).toBeVisible()
    await pacePayrollInteraction(); await ruleSection.getByRole("button", { name: "Edit rule", exact: true }).click()
    await ruleSection.getByLabel("Base salary (SAR)", { exact: true }).fill("2700.25")
    await ruleSection.getByLabel("Rule review note", { exact: true }).fill("Owner corrected agreed monthly salary")
    await pacePayrollInteraction(); await ruleSection.getByRole("button", { name: "Save rule changes", exact: true }).click()
    await expect.poll(async () => Number((await read("driver_payroll_rules")).base_salary)).toBe(2700.25)

    stage = "calendar classification and recorded zero-order review"
    for (let day = 1; day <= 28; day++) await page.getByLabel(`2001-02-${String(day).padStart(2, "0")}`, { exact: true }).selectOption(day <= 20 ? "present" : day === 21 ? "half_day" : day === 22 ? "absent_unexcused" : "day_off")
    await page.getByLabel("Attendance review note", { exact: true }).fill("Reviewed every calendar day explicitly")
    await pacePayrollInteraction(); await page.getByRole("button", { name: "Save and review attendance", exact: true }).click()
    await expect.poll(async () => (await read("payroll_preparation_reviews", { period_year: 2001, period_month: 2 })).attendance_reviewed).toBe(true)
    await page.getByLabel("Order review note (confirm zero if no orders)", { exact: true }).fill("Confirmed no daily orders in this synthetic period")
    await pacePayrollInteraction(); await page.getByRole("button", { name: "Confirm recorded order totals", exact: true }).click()
    await expect.poll(async () => (await read("payroll_preparation_reviews", { period_year: 2001, period_month: 2 })).orders_reviewed).toBe(true)

    stage = "advance create edit approve"
    const advances = page.locator("section").filter({ has: page.getByRole("heading", { name: "Payroll advances", exact: true }) })
    await advances.getByLabel("Amount (SAR)", { exact: true }).fill("12")
    await advances.getByLabel("Advance date", { exact: true }).fill("2001-02-01")
    await advances.getByLabel("Reason", { exact: true }).fill("Synthetic driver request")
    await pacePayrollInteraction(); await advances.getByRole("button", { name: "Request advance", exact: true }).click()
    await expect(advances.getByRole("button", { name: "Edit advance", exact: true })).toBeVisible()
    await pacePayrollInteraction(); await advances.getByRole("button", { name: "Edit advance", exact: true }).click()
    await advances.getByLabel("Amount (SAR)", { exact: true }).fill("12.34")
    await pacePayrollInteraction(); await advances.getByRole("button", { name: "Save pending advance", exact: true }).click()
    await expect.poll(async () => Number((await read("payroll_advances")).amount)).toBe(12.34)
    page.once("dialog", dialog => dialog.accept("Owner approved synthetic advance"))
    await pacePayrollInteraction(); await advances.getByRole("button", { name: "Approve", exact: true }).click()
    await expect.poll(async () => (await read("payroll_advances")).status).toBe("approved")

    stage = "responsive preparation and immutable source lock"
    await page.setViewportSize({ width: 375, height: 812 })
    await expect.poll(() => page.locator("main").evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2)
    await page.screenshot({ path: "supabase/.temp/payroll-preparation-mobile.png" })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByLabel("Final review note", { exact: true }).fill("Owner verified calendar, rule and zero orders")
    await pacePayrollInteraction(); await page.getByRole("button", { name: "Lock attendance and order inputs", exact: true }).click()
    await expect(page.getByText("Period status:", { exact: false })).toContainText("Locked")
    expect(Number((await read("driver_attendance_summary", { period_year: 2001, period_month: 2 })).working_days_actual)).toBe(20.5)
    await expect(ruleSection.getByRole("button", { name: "Edit rule", exact: true })).toHaveCount(0)

    stage = "calculate review approve cancel and replace from payroll list"
    await page.goto(`${appUrl}/payroll?lang=en`)
    await page.getByLabel("Payroll year", { exact: true }).fill("2001")
    await page.getByLabel("Payroll month", { exact: true }).selectOption("2")
    await pacePayrollInteraction(); await page.getByRole("button", { name: "Calculate period", exact: true }).click()
    const row = page.getByRole("row").filter({ hasText: "سائق اختبار تحضير الرواتب" }).filter({ hasText: "Calculated" })
    await expect(row).toBeVisible()
    let payroll = await read("driver_payroll_periods", { status: "calculated" })
    expect(Number(payroll.net_payroll)).toBe(2181.61)
    await pacePayrollInteraction(); await row.getByRole("button", { name: "Review", exact: true }).click()
    let activeRow = page.getByRole("row").filter({ hasText: "سائق اختبار تحضير الرواتب" }).filter({ hasText: "In review" })
    await pacePayrollInteraction(); await activeRow.getByRole("button", { name: "Approve", exact: true }).click()
    await expect.poll(async () => (await read("payroll_advances")).payroll_period_id).toBe(payroll.id)
    activeRow = page.getByRole("row").filter({ hasText: "سائق اختبار تحضير الرواتب" }).filter({ hasText: "Approved" })
    page.once("dialog", dialog => dialog.accept("Reviewed replacement of synthetic payroll"))
    await pacePayrollInteraction(); await activeRow.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect.poll(async () => (await read("payroll_advances")).payroll_period_id).toBeNull()
    await pacePayrollInteraction(); await page.getByRole("button", { name: "Calculate period", exact: true }).click()
    await expect(row).toBeVisible()
    const replacement = await read("driver_payroll_periods", { status: "calculated" })
    expect(replacement.id).not.toBe(payroll.id)
    expect(replacement.supersedes_id).toBe(payroll.id)
    await pacePayrollInteraction(); await row.getByRole("button", { name: "Review", exact: true }).click()
    activeRow = page.getByRole("row").filter({ hasText: "سائق اختبار تحضير الرواتب" }).filter({ hasText: "In review" })
    await pacePayrollInteraction(); await activeRow.getByRole("button", { name: "Approve", exact: true }).click()
    activeRow = page.getByRole("row").filter({ hasText: "سائق اختبار تحضير الرواتب" }).filter({ hasText: "Approved" })
    await pacePayrollInteraction(); await activeRow.getByRole("button", { name: "Mark paid", exact: true }).click()
    await expect.poll(async () => (await read("payroll_advances")).status).toBe("repaid")
    payroll = await read("driver_payroll_periods", { status: "paid" })
    expect(payroll.id).toBe(replacement.id)
    await verifyPayrollPartialPreparation(page, admin, tenantId, appUrl, driverId)
    console.log("PASS: payroll explicit rules, complete calendar, zero orders, advance CRUD/approval, source lock, atomic calculation, cancellation replacement and payment settlement")
  } catch (error) {
    console.error(JSON.stringify({ check: "payroll-preparation", stage, errorType: error.name }))
    throw new Error(`Payroll preparation browser verification failed: ${stage}`)
  }
}

/** Continues in the same synthetic tenant after the full-month helper. */
export async function verifyPayrollPartialPreparation(page, admin, tenantId, appUrl, existingDriverId) {
  const host=new URL(admin.supabaseUrl).hostname
  if (!["localhost","127.0.0.1","viowrovartosrkqukjxy.supabase.co"].includes(host) || new URL(appUrl).hostname==="elite-dashboard-blush.vercel.app") throw new Error("Isolated payroll verification only")
  let stage="partial fixture"
  try {
    const existing=await admin.from("drivers").select("id").eq("tenant_id",tenantId).is("deleted_at",null)
    if(existing.error || existing.data.length!==1 || existing.data[0].id!==existingDriverId) throw new Error("Expected only the preceding synthetic payroll driver")
    const created=await admin.from("drivers").insert({tenant_id:tenantId,full_name_ar:"سائق اختبار أجر اليوم الواحد",full_name_en:"One-day payroll fixture",primary_mobile:"0500980001",category:"sponsored_type2",status:"terminated",hire_date:"2002-02-28",termination_date:"2002-02-28"}).select("id").single()
    if(created.error) throw new Error("Partial driver fixture failed")
    const driverId=created.data.id
    await page.goto(`${appUrl}/payroll/preparation?lang=en`)
    await page.getByLabel("Year",{exact:true}).fill("2002")
    await page.getByLabel("Month",{exact:true}).selectOption("2")
    await expect(page.getByLabel("Working days in this period",{exact:true})).toBeVisible()
    await page.getByLabel("Working days in this period",{exact:true}).fill("28")
    await pacePayrollInteraction(); await page.getByRole("button",{name:"Open preparation period",exact:true}).click()
    await expect(page.getByText("Period status:",{exact:false})).toContainText("Open")
    stage="existing full-month participant review"
    await page.getByLabel("Driver",{exact:true}).selectOption(existingDriverId)
    for(let day=1;day<=28;day++) await page.getByLabel(`2002-02-${String(day).padStart(2,"0")}`,{exact:true}).selectOption("day_off")
    await page.getByLabel("Attendance review note",{exact:true}).fill("Reviewed each synthetic full-month day off")
    await pacePayrollInteraction(); await page.getByRole("button",{name:"Save and review attendance",exact:true}).click()
    await expect.poll(async()=> (await admin.from("payroll_preparation_reviews").select("attendance_reviewed").eq("tenant_id",tenantId).eq("driver_id",existingDriverId).eq("period_year",2002).eq("period_month",2).single()).data?.attendance_reviewed).toBe(true)
    await page.getByLabel("Order review note (confirm zero if no orders)",{exact:true}).fill("No delivered orders in this synthetic period")
    await pacePayrollInteraction(); await page.getByRole("button",{name:"Confirm recorded order totals",exact:true}).click()
    await expect.poll(async()=> (await admin.from("payroll_preparation_reviews").select("orders_reviewed").eq("tenant_id",tenantId).eq("driver_id",existingDriverId).eq("period_year",2002).eq("period_month",2).single()).data?.orders_reviewed).toBe(true)
    stage="one-day rule and employment calendar"
    await page.getByLabel("Driver",{exact:true}).selectOption(driverId)
    const rule=page.locator("section").filter({has:page.getByRole("heading",{name:"Pay rules",exact:true})})
    await rule.getByLabel("Effective date",{exact:true}).fill("2002-02-28")
    for(const [name,value] of [["Target working days","28"],["Monthly order target","400"],["Package (SAR)","3200"],["Order threshold","400"],["Car rent deduction (SAR)","1700"],["Minimum net floor (SAR)","0"]]) await rule.getByLabel(name,{exact:true}).fill(value)
    await rule.getByLabel("Rule review note",{exact:true}).fill("Reviewed actual one-day driver package contract")
    await pacePayrollInteraction(); await rule.getByRole("button",{name:"Create pay rule",exact:true}).click()
    await expect(rule.getByRole("button",{name:"Edit rule",exact:true})).toBeVisible()
    await expect(page.getByText("Outside recorded employment",{exact:true})).toHaveCount(27)
    await page.getByLabel("2002-02-28",{exact:true}).selectOption("present")
    await page.getByLabel("Attendance review note",{exact:true}).fill("Only actual employed day reviewed")
    await pacePayrollInteraction(); await page.getByRole("button",{name:"Save and review attendance",exact:true}).click()
    await expect.poll(async()=> (await admin.from("driver_attendance").select("id",{count:"exact",head:true}).eq("tenant_id",tenantId).eq("driver_id",driverId)).count).toBe(1)
    await page.getByLabel("Order review note (confirm zero if no orders)",{exact:true}).fill("Explicitly confirmed zero orders on employed day")
    await pacePayrollInteraction(); await page.getByRole("button",{name:"Confirm recorded order totals",exact:true}).click()
    await expect.poll(async()=> (await admin.from("payroll_preparation_reviews").select("orders_reviewed").eq("tenant_id",tenantId).eq("driver_id",driverId).eq("period_year",2002).eq("period_month",2).single()).data?.orders_reviewed).toBe(true)
    stage="missing period basis blocks lock without inventing wages"
    await page.getByLabel("Final review note",{exact:true}).fill("Missing basis must prevent an incomplete approval")
    await pacePayrollInteraction(); await page.getByRole("button",{name:"Lock attendance and order inputs",exact:true}).click()
    await expect(page.getByRole("alert")).toContainText("PAY_PERIOD_BASIS_REVIEW_REQUIRED")
    const basis=page.locator("section").filter({has:page.getByRole("heading",{name:"Reviewed period pay basis",exact:true})})
    for(const [name,value] of [["Agreed period base amount (SAR)","100.25"],["Adjusted period order target","1"],["Reviewed period absence deduction (SAR)","0"],["Reviewed period net floor (SAR)","0"],["Reviewed period package threshold","1"],["Reviewed period rent deduction (SAR)","15.50"]]) await basis.getByLabel(name,{exact:true}).fill(value)
    await basis.getByLabel("Period basis review note",{exact:true}).fill("Owner approved explicit one-day base and package deduction")
    await basis.getByRole("checkbox").check()
    await pacePayrollInteraction(); await basis.getByRole("button",{name:"Approve period pay basis",exact:true}).click()
    await expect(basis.getByRole("status")).toContainText("Period basis approved")
    stage="partial review mobile layout and final lock"
    await page.setViewportSize({width:375,height:812})
    await expect.poll(()=>page.locator("main").evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(2)
    await page.screenshot({path:"supabase/.temp/payroll-partial-basis-mobile.png"})
    await page.setViewportSize({width:1280,height:900})
    await page.getByLabel("Final review note",{exact:true}).fill("Owner approved actual employment and explicit period amounts")
    await pacePayrollInteraction(); await page.getByRole("button",{name:"Lock attendance and order inputs",exact:true}).click()
    await expect(page.getByText("Period status:",{exact:false})).toContainText("Locked")
    stage="exact one-day calculation with no second proration"
    await page.goto(`${appUrl}/payroll?lang=en`)
    await page.getByLabel("Payroll year",{exact:true}).fill("2002")
    await page.getByLabel("Payroll month",{exact:true}).selectOption("2")
    await pacePayrollInteraction(); await page.getByRole("button",{name:"Calculate period",exact:true}).click()
    await expect(page.getByRole("row").filter({hasText:"سائق اختبار أجر اليوم الواحد"})).toContainText("84.75")
    const result=await admin.from("driver_payroll_periods").select("base_amount,net_payroll,period_basis_id").eq("tenant_id",tenantId).eq("driver_id",driverId).eq("period_year",2002).eq("period_month",2).single()
    expect(result.error).toBeNull();expect(Number(result.data.base_amount)).toBe(100.25);expect(Number(result.data.net_payroll)).toBe(84.75);expect(result.data.period_basis_id).toBeTruthy()
    console.log("PASS: one-day terminated-driver period participation, explicit owner pay basis, no fabricated attendance or second proration, missing-basis lock denial and responsive review")
  } catch(error) {
    console.error(JSON.stringify({check:"payroll-partial-preparation",stage,errorType:error.name}))
    throw new Error(`Partial payroll browser verification failed: ${stage}`)
  }
}
