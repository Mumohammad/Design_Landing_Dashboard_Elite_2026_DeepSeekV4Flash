import {assertModuleTestTarget} from "./assert-module-test-target.mjs"
import {expect as baseExpect} from "@playwright/test"
const expect=baseExpect.configure({timeout:20_000})
/** Runs only against an owned loopback test tenant, never hosted production. */
export async function verifyOrdersPlatforms(page,admin,tenantId,appUrl){
 await assertModuleTestTarget(page,admin.supabaseUrl,appUrl)
 let stage="driver fixture"
 try{
  const driverResult=await admin.from("drivers").insert({tenant_id:tenantId,full_name_ar:"سائق اختبار طلبات الواجهة",full_name_en:"Order UI driver fixture",primary_mobile:"0501350001",category:"freelancer",status:"active"}).select("id").single()
  if(driverResult.error)throw Error("Order driver fixture failed")
  const driverId=driverResult.data.id
  const read=async(table,where)=>{let query=admin.from(table).select("*").eq("tenant_id",tenantId);for(const[key,value]of Object.entries(where))query=query.eq(key,value);const result=await query.single();if(result.error)throw Error("Persisted "+table+" row not found");return result.data}
  await page.evaluate(()=>localStorage.setItem("elite-locale","en"))
  stage="platform creation"
  await page.goto(appUrl+"/platforms")
  await page.getByRole("button",{name:"Add platform",exact:true}).click()
  let dialog=page.getByRole("dialog")
  await dialog.getByLabel("Code",{exact:true}).fill("UI_ORDERS_135")
  await dialog.getByLabel("Name (Arabic)",{exact:true}).fill("منصة اختبار طلبات الواجهة")
  await dialog.getByLabel("Name (English)",{exact:true}).fill("Order UI platform fixture")
  await dialog.getByRole("button",{name:"Save",exact:true}).click()
  await expect(dialog).toBeHidden()
  let platform=await read("delivery_platforms",{code:"UI_ORDERS_135"})
  let platformRow=page.getByRole("row").filter({hasText:"UI_ORDERS_135"})
  stage="platform edit"
  await platformRow.getByTitle("Edit",{exact:true}).click()
  await dialog.getByLabel("Name (English)",{exact:true}).fill("Order UI platform edited")
  await dialog.getByRole("button",{name:"Save",exact:true}).click()
  await expect(dialog).toBeHidden()
  expect((await read("delivery_platforms",{id:platform.id})).name_en).toBe("Order UI platform edited")
  stage="order create"
  await page.goto(appUrl+"/orders")
  await page.locator('input[type="month"]').fill("2098-12")
  await page.getByRole("button",{name:"Add Orders",exact:true}).first().click()
  await dialog.locator("#driver_id").click();await page.getByRole("option",{name:"Order UI driver fixture",exact:true}).click()
  await dialog.locator("#platform_id").click();await page.getByRole("option",{name:"Order UI platform edited",exact:true}).click()
  await expect(dialog.getByRole("combobox",{name:/^Platform/})).toHaveAttribute("id","platform_id")
  await expect(dialog.getByRole("combobox",{name:"Shift",exact:true})).toHaveAttribute("id","shift_label")
  await dialog.locator("#shift_label").click();await page.getByRole("option",{name:"Morning",exact:true}).click()
  await dialog.locator("#entry_date").fill("2098-12-15")
  await dialog.locator("#orders_delivered").fill("17")
  await dialog.locator("#gross_revenue").fill("42.50")
  await dialog.getByRole("button",{name:"Save orders",exact:true}).click()
  await expect(dialog).toBeHidden()
  let order=await read("daily_order_entries",{driver_id:driverId,entry_date:"2098-12-15"})
  expect(order.orders_delivered).toBe(17);expect(order.shift_label).toBe("morning")
  let orderRow=page.getByRole("row").filter({hasText:"2098-12-15"})
  stage="order edit and mobile dialog"
  await orderRow.getByRole("button",{name:"Edit",exact:true}).click()
  await dialog.locator("#orders_delivered").fill("19")
  await dialog.locator("#notes").fill("Browser corrected order")
  await page.setViewportSize({width:375,height:812})
  await expect.poll(()=>dialog.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(2)
  await page.screenshot({path:"supabase/.temp/orders-edit-mobile.png"})
  await dialog.getByRole("button",{name:"Save orders",exact:true}).click()
  await expect(dialog).toBeHidden()
  await page.setViewportSize({width:1280,height:900})
  expect((await read("daily_order_entries",{id:order.id})).orders_delivered).toBe(19)
  stage="order archive preserves history"
  page.once("dialog",event=>event.accept())
  await orderRow.getByRole("button",{name:"Archive",exact:true}).click()
  await expect(orderRow).toHaveCount(0)
  expect((await read("daily_order_entries",{id:order.id})).deleted_at).toBeTruthy()
  stage="paging reaches beyond50"
  const bulk=await admin.from("daily_order_entries").insert(Array.from({length:55},(_,index)=>({tenant_id:tenantId,driver_id:driverId,platform_id:platform.id,entry_date:"2098-12-01",shift_label:"UI paging "+index,orders_delivered:2,gross_revenue:3.25})))
  if(bulk.error)throw Error("Order paging fixture failed")
  await page.reload()
  await page.locator('input[type="month"]').fill("2098-12")
  await expect(page.getByText(/55 records/)).toBeVisible()
  await page.getByRole("button",{name:/Next/}).click()
  await expect(page.getByRole("row").filter({hasText:"2098-12-01"})).toHaveCount(5)
  stage="platform deactivation retains master and references"
  await page.goto(appUrl+"/platforms")
  platformRow=page.getByRole("row").filter({hasText:"UI_ORDERS_135"})
  page.once("dialog",event=>event.accept())
  await platformRow.getByTitle("Deactivate platform",{exact:true}).click()
  await expect(platformRow).toContainText("Inactive")
  platform=await read("delivery_platforms",{id:platform.id})
  expect(platform.is_active).toBe(false);expect(platform.deleted_at).toBeNull()
  stage="inactive platform detail and payment create"
  await page.goto(appUrl+"/platforms/"+platform.id)
  await page.getByRole("button",{name:"Record payment",exact:true}).click()
  await dialog.getByLabel("Invoiced (SAR)",{exact:true}).fill("150")
  await dialog.getByLabel("Received (SAR)",{exact:true}).fill("25")
  await dialog.getByLabel("Payment date",{exact:true}).fill("2026-10-22")
  await dialog.getByRole("button",{name:"Save",exact:true}).click()
  await expect(dialog).toBeHidden()
  let payment=await read("platform_payments",{platform_id:platform.id})
  expect(Number(payment.outstanding_amount)).toBe(125)
  stage="payment correction"
  await page.getByRole("button",{name:"Payments ledger",exact:true}).click()
  await page.getByRole("button",{name:"Edit payment period",exact:true}).click()
  await dialog.getByLabel("Received (SAR)",{exact:true}).fill("150")
  await dialog.getByRole("button",{name:"Save",exact:true}).click()
  await expect(dialog).toBeHidden()
  payment=await read("platform_payments",{id:payment.id})
  expect(payment.payment_status).toBe("paid");expect(Number(payment.outstanding_amount)).toBe(0)
  return{orderCrud:true,paged55:true,platformHistory:true,paymentCorrection:true,mobileDialog:true}
 }catch(error){await page.screenshot({path:"supabase/.temp/orders-platforms-acceptance-failure.png"}).catch(()=>{});throw Error("Orders/Platforms acceptance failed at "+stage+": "+(error instanceof Error?error.message:String(error)))}
}
