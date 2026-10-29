import {expect as baseExpect} from "@playwright/test"
import {randomUUID} from "node:crypto"
import {assertModuleTestTarget} from "./assert-module-test-target.mjs"
const expect=baseExpect.configure({timeout:30_000})

/** Actual audit page, filtered safe metadata, CSV, transport failure and retry. */
export async function verifyAuditPrivacy(page,admin,tenantId,appUrl,actorId){
 await assertModuleTestTarget(page,admin.supabaseUrl,appUrl)
 if(!tenantId||!actorId)throw Error("Owned synthetic tenant and actor required")
 const id=randomUUID(),entity=randomUUID(),marker="PRIVATE-AUDIT-"+randomUUID()
 const inserted=await admin.from("audit_log").insert({id,tenant_id:tenantId,actor_id:actorId,module:"drivers",entity_type:"driver",entity_id:entity,action:"updated",ip_address:"192.0.2.143",new_values:{status:"active",profile_version:2,bank_details_changed:true,compensation_changed:true,full_name_en:marker,iban:marker,base_salary:9876.54,notes:marker,reason:marker,unknown:{secret:marker}}})
 if(inserted.error)throw Error("Synthetic audit fixture failed")
 const actionBodies=[]
 const capture=async response=>{if(new URL(response.url()).pathname==="/audit-log"&&response.request().method()==="POST"){const body=await response.text().catch(()=>"");actionBodies.push(body)}}
 page.on("response",capture)
 const route=new URL("/audit-log",appUrl);route.searchParams.set("entityType","driver");route.searchParams.set("entityId",entity);route.searchParams.set("lang","en")
 const exportButton=()=>page.getByRole("button",{name:"Export page CSV",exact:true})
 const refresh=()=>page.getByRole("button",{name:"Refresh",exact:true})
 const blockAction=async request=>request.request().method()==="POST"?request.abort("failed"):request.continue()
 try{
  await page.goto(route.href)
  await expect(page.getByText("1 events on this page (limit 50)",{exact:true})).toBeVisible()
  await page.getByRole("button",{name:/^Metadata/}).click()
  const metadata=page.locator("main pre")
  await expect(metadata).toContainText('"status": "active"')
  await expect(metadata).toContainText('"compensation_changed": true')
  expect(await metadata.innerText()).not.toContain(marker)
  expect(await metadata.innerText()).not.toContain("9876.54")
  await expect(page.getByRole("button",{name:/^Metadata/})).toHaveAttribute("aria-expanded","true")
  await expect(exportButton()).toBeEnabled()
  // Failed reads must display an error, not zero events or an enabled export.
  await page.route("**/audit-log*",blockAction)
  await refresh().click()
  await expect(page.getByRole("alert").filter({hasText:"Could not load the audit trail"})).toBeVisible()
  await expect(page.getByText("Event count unavailable",{exact:true})).toBeVisible()
  await expect(exportButton()).toBeDisabled()
  await page.unroute("**/audit-log*",blockAction)
  await refresh().click()
  await expect(page.getByText("1 events on this page (limit 50)",{exact:true})).toBeVisible()
  await expect(exportButton()).toBeEnabled()
  // Export authorization/data are rechecked through a separate server action.
  await page.route("**/audit-log*",blockAction)
  await exportButton().click()
  await expect(page.getByRole("alert").filter({hasText:"Could not export this page"})).toBeVisible()
  await expect(exportButton()).toBeEnabled()
  await page.unroute("**/audit-log*",blockAction)
  const downloaded=page.waitForEvent("download")
  await exportButton().click()
  const download=await downloaded,stream=await download.createReadStream()
  if(!stream)throw Error("Audit export stream unavailable")
  const chunks=[];for await(const chunk of stream)chunks.push(chunk)
  const csv=Buffer.concat(chunks).toString("utf8")
  expect(csv).toContain(entity)
  expect(csv).toContain("compensation_changed")
  expect(csv).not.toContain(marker)
  expect(csv).not.toContain("9876.54")
  expect(csv).not.toContain("192.0.2.143")
  for(const body of actionBodies){expect(body).not.toContain(marker);expect(body).not.toContain("9876.54")}
  await page.setViewportSize({width:390,height:844})
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  await page.setViewportSize({width:1440,height:1000})
  // Storage is append-only; leave the synthetic event in its isolated tenant.
  const original=await admin.from("audit_log").select("new_values").eq("tenant_id",tenantId).eq("id",id).single()
  if(original.error||original.data.new_values.full_name_en!==marker)throw Error("Audit history changed unexpectedly")
  console.log(JSON.stringify({check:"audit safe UI, filtered CSV, transport recovery and retained history",result:"PASS"}))
 }finally{
  page.off("response",capture)
  await page.unroute("**/audit-log*",blockAction).catch(()=>{})
 }
}
