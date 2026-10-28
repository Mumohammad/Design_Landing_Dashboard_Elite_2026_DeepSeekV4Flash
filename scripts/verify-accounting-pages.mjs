import {expect as baseExpect} from "@playwright/test"
import {assertModuleTestTarget} from "./assert-module-test-target.mjs"
const expect=baseExpect.configure({timeout:30_000})
/** Caller owns cleanup of this synthetic tenant after coordinated acceptance. */
export async function verifyAccountingPages(page,admin,tenantId,appUrl){
 await assertModuleTestTarget(page,admin.supabaseUrl,appUrl)
 const prefix="PAGE136-"+crypto.randomUUID().slice(0,8)
 let phase="synthetic fixtures"
 const insert=async(table,rows)=>{const out=[];for(let n=0;n<rows.length;n+=250){const result=await admin.from(table).insert(rows.slice(n,n+250)).select();if(result.error)throw Error("Synthetic "+table+" fixture failed");out.push(...result.data)}return out}
 try{
  const parties=await insert("customers",Array.from({length:30},(_,i)=>({tenant_id:tenantId,name_ar:prefix+" عميل "+String(i).padStart(2,"0"),name_en:prefix+" customer "+String(i).padStart(2,"0")})))
  const customer=parties[29]
  await insert("finance_payments",Array.from({length:1005},(_,i)=>({tenant_id:tenantId,payment_ref:prefix+"-"+String(i).padStart(4,"0"),direction:"in",customer_id:customer.id,amount:"0.10",method:"cash",payment_date:"2026-10-01"})))
  const documents=await insert("receivables",Array.from({length:30},(_,i)=>({tenant_id:tenantId,customer_id:customer.id,invoice_ref:prefix+"-AR-"+String(i).padStart(2,"0"),invoice_date:"2026-10-01",due_date:"2026-10-01",amount:"1.00",vat_amount:"0.00",total_amount:"1.00"})))
  await insert("vat_input_ledger",Array.from({length:225},(_,i)=>({tenant_id:tenantId,period_year:1901,period_month:1,invoice_ref:prefix+"-VAT-"+String(i).padStart(3,"0"),invoice_date:"1901-01-01",vat_base_amount:"0.10",vat_amount:"0.02",vat_rate:"15.00",vat_recoverability:"pending_review"})))
  phase="all payments and database search"
  await page.goto(appUrl+"/payments?lang=en")
  await page.getByRole("textbox").first().fill(prefix)
  await expect(page.getByRole("row").filter({hasText:prefix})).toHaveCount(25)
  const paymentsCount=await admin.from("finance_payments").select("id",{count:"exact",head:true}).eq("tenant_id",tenantId).is("deleted_at",null)
  if(paymentsCount.error)throw Error("Synthetic aggregate expectation unavailable")
  await expect(page.getByText(String(paymentsCount.count),{exact:true}).first()).toBeVisible()
  await page.getByRole("button",{name:"Next page",exact:true}).click()
  await expect(page.getByRole("row").filter({hasText:prefix})).toHaveCount(25)
  phase="complete filtered payment CSV"
  const pendingDownload=page.waitForEvent("download")
  await page.getByRole("button",{name:"Export CSV",exact:true}).click()
  const download=await pendingDownload,stream=await download.createReadStream(),chunks=[]
  for await(const chunk of stream)chunks.push(chunk)
  const csv=Buffer.concat(chunks).toString("utf8")
  expect(csv.match(new RegExp(prefix+"-","g"))).toHaveLength(1005)
  expect(csv).toContain(prefix+"-0000");expect(csv).toContain(prefix+"-1004")
  phase="truthful read failure and recovery"
  let fail=true
  const unavailable=async route=>{if(fail&&route.request().method()==="POST"){fail=false;await route.fulfill({status:503,contentType:"application/json",body:'{"message":"Synthetic unavailable"}'})}else await route.continue()}
  await page.route("**/rest/v1/rpc/read_my_accounting_page",unavailable)
  await page.reload()
  const alert=page.getByRole("alert").filter({hasText:"Could not load payments"})
  await expect(alert).toBeVisible()
  await page.unroute("**/rest/v1/rpc/read_my_accounting_page",unavailable)
  await alert.getByRole("button",{name:"Retry",exact:true}).click()
  await expect(alert).toBeHidden()
  await expect(page.getByRole("row")).not.toHaveCount(1)
  phase="paged party and allocation selection; real posting"
  await page.goto(appUrl+"/accounting?lang=en")
  await page.getByRole("tab",{name:"Payments",exact:true}).click()
  await page.getByRole("button",{name:"New payment",exact:true}).click()
  const dialog=page.getByRole("dialog",{name:"Record payment"})
  await dialog.locator("#payMethod").selectOption("cash")
  const partyPicker=dialog.getByTestId("payCustomer-picker")
  await partyPicker.getByRole("searchbox").fill(prefix)
  await expect(partyPicker).toContainText("30 records")
  await partyPicker.getByRole("button",{name:"Next records",exact:true}).click()
  await expect(partyPicker.locator('option[value="'+customer.id+'"]')).toHaveCount(1)
  await partyPicker.locator("#payCustomer").selectOption(customer.id)
  const picker=dialog.getByTestId("payment-allocation-picker")
  await expect(picker).toContainText("30 records")
  await picker.getByRole("button",{name:"Next records",exact:true}).click()
  await expect(picker).toContainText("Page 2 of 2")
  const chosen=documents[29]
  await picker.getByRole("searchbox").fill(chosen.invoice_ref)
  await expect(picker).toContainText("1 record")
  await picker.getByRole("checkbox").check()
  await picker.locator('[id="allocation-'+chosen.id+'"]').fill("1.00")
  await picker.getByRole("searchbox").fill(prefix+"-AR-")
  await expect(picker).toContainText("Selected documents stay selected")
  await expect(picker.locator('[id="allocation-'+chosen.id+'"]').first()).toHaveValue("1.00")
  await dialog.locator("#payAmount").fill("1.00")
  await dialog.locator("#payReference").fill(prefix+" posted receipt")
  await dialog.getByRole("button",{name:"Record & post",exact:true}).click()
  await expect(dialog).toBeHidden()
  const saved=await admin.from("finance_payments").select("id,status,amount").eq("tenant_id",tenantId).eq("reference",prefix+" posted receipt").single()
  if(saved.error)throw Error("Committed payment missing")
  expect(saved.data.status).toBe("allocated");expect(Number(saved.data.amount)).toBe(1)
  const ar=await admin.from("receivables").select("paid_amount,status").eq("tenant_id",tenantId).eq("id",chosen.id).single()
  if(ar.error)throw Error("Committed allocation missing")
  expect(Number(ar.data.paid_amount)).toBe(1);expect(ar.data.status).toBe("paid")
  phase="payment void, reversal, restored receivable and stale replay"
  const {verifyPaymentVoidLifecycle}=await import("./verify-payment-void-lifecycle.mjs")
  await verifyPaymentVoidLifecycle(page,admin,tenantId,appUrl,{paymentId:saved.data.id,receivableId:chosen.id})
  phase="VAT review beyond 200, independent return month and mobile"
  await page.getByRole("tab",{name:"VAT",exact:true}).click()
  const reviewCard=page.locator('[data-slot="card"]').filter({has:page.getByText("Items awaiting review",{exact:true})})
  await reviewCard.getByRole("searchbox").fill(prefix+"-VAT-224")
  await expect(reviewCard.getByRole("row").filter({hasText:prefix+"-VAT-224"})).toHaveCount(1)
  await page.getByLabel("VAT return month",{exact:true}).fill("1901-01")
  await expect(page.getByText(/4[.]50 \(225\)/).first()).toBeVisible()
  await page.setViewportSize({width:390,height:844})
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  await page.screenshot({path:"supabase/.temp/accounting-pages-mobile.png",fullPage:true})
  console.log(JSON.stringify({check:"accounting pages, full payment CSV, read recovery, paged choices, allocation posting and older VAT",result:"PASS"}))
 }catch(error){console.error(JSON.stringify({check:"accounting pages",phase,errorType:error.name}));throw Error("Accounting acceptance failed: "+phase)}
 finally{await page.unrouteAll({behavior:"ignoreErrors"});await page.setViewportSize({width:1440,height:1000})}
}
