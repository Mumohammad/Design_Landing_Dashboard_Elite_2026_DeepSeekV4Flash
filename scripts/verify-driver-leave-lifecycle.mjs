import {expect as baseExpect} from "@playwright/test"
import {randomUUID} from "node:crypto"
import {assertModuleTestTarget} from "./assert-module-test-target.mjs"
const expect=baseExpect.configure({timeout:25_000})

/** Creates only synthetic records in the caller-owned test tenant; keeps audit evidence. */
export async function verifyDriverLeaveLifecycle(page,admin,tenantId,appUrl){
 await assertModuleTestTarget(page,admin.supabaseUrl,appUrl)
 if(!/^[0-9a-f-]{36}$/i.test(tenantId??""))throw Error("Synthetic leave tenant required")
 const driverId=randomUUID(),typeId=randomUUID(),tag=randomUUID().slice(0,8),viewport=page.viewportSize(),locale=await page.locator("html").getAttribute("lang")
 let stage="synthetic fixtures",stale=null,lastWrite=0,failedRead=null
 const pattern="**/rest/v1/driver_leave_requests?**"
 const write=async button=>{const wait=2100-(Date.now()-lastWrite);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));lastWrite=Date.now();await button.click()}
 const card=(target,id)=>target.locator('[data-testid="driver-leave-record"][data-leave-id="'+id+'"]')
 const open=async target=>{await target.goto(appUrl+"/drivers/"+driverId+"?lang=en");await target.getByRole("tab",{name:"Leave",exact:true}).click();return target.getByRole("tabpanel",{name:"Leave",exact:true})}
 const read=async id=>{const r=await admin.from("driver_leave_requests").select("id,workflow_version,start_date,end_date,days_requested,reason,status,reviewed_at,reviewed_by,cancelled_at,cancelled_by,cancellation_reason,deleted_at").eq("tenant_id",tenantId).eq("driver_id",driverId).eq("id",id).single();if(r.error)throw Error("Synthetic leave read failed");return r.data}
 const driverStatus=async()=>{const r=await admin.from("drivers").select("status").eq("tenant_id",tenantId).eq("id",driverId).single();if(r.error)throw Error("Synthetic driver read failed");return r.data.status}
 const create=async(start,end,reason)=>{
  await page.getByRole("button",{name:"Request Leave",exact:true}).click();const dialog=page.getByRole("dialog")
  await expect(dialog.getByRole("button",{name:"Submit Request",exact:true})).toBeDisabled()
  await dialog.locator("#leave-type").click();await page.getByRole("option",{name:"Browser leave "+tag,exact:true}).click()
  await dialog.locator("#leave-start").fill(start);await dialog.locator("#leave-end").fill(end);await dialog.locator("#leave-reason").fill(reason)
  await write(dialog.getByRole("button",{name:"Submit Request",exact:true}));await expect(dialog).toBeHidden()
  const r=await admin.from("driver_leave_requests").select("id").eq("tenant_id",tenantId).eq("driver_id",driverId).eq("reason",reason).single();if(r.error)throw Error("Created synthetic leave missing");return r.data.id
 }
 try{
  const driver=await admin.from("drivers").insert({id:driverId,tenant_id:tenantId,full_name_ar:"سائق اختبار الإجازات "+tag,full_name_en:"Leave browser fixture "+tag,primary_mobile:"0501410001",category:"freelancer",status:"active",hire_date:"2020-01-01"})
  if(driver.error)throw Error("Synthetic leave driver fixture failed")
  const type=await admin.from("leave_types").insert({id:typeId,tenant_id:tenantId,code:"browser_leave_"+tag,name_ar:"إجازة اختبار "+tag,name_en:"Browser leave "+tag,days_per_year:0})
  if(type.error)throw Error("Synthetic leave catalog fixture failed")
  let panel=await open(page);await expect(panel.getByText("No leave requests",{exact:true})).toBeVisible()
  stage="required reason and caller create"
  const futureId=await create("2098-09-01","2098-09-02","Browser pending leave "+tag)
  expect(await read(futureId)).toMatchObject({status:"pending",workflow_version:1,days_requested:2})
  stage="pending edit and stale second tab"
  await card(page,futureId).getByRole("button",{name:"Edit",exact:true}).click();const dialog=page.getByRole("dialog")
  await expect(dialog.locator("#leave-edit-reason")).toHaveValue("Browser pending leave "+tag)
  stale=await page.context().newPage();await open(stale);await card(stale,futureId).getByRole("button",{name:"Edit",exact:true}).click();const second=stale.getByRole("dialog")
  await second.locator("#leave-edit-start").fill("2098-09-03");await second.locator("#leave-edit-end").fill("2098-09-05");await second.locator("#leave-edit-reason").fill("Current browser dates "+tag)
  await write(second.getByRole("button",{name:"Save changes",exact:true}));await expect(second).toBeHidden()
  await dialog.locator("#leave-edit-start").fill("2098-09-06");await dialog.locator("#leave-edit-end").fill("2098-09-07");await dialog.locator("#leave-edit-reason").fill("Stale browser dates "+tag)
  await write(dialog.getByRole("button",{name:"Save changes",exact:true}))
  await expect(page.getByText("This request changed. Reload and review it before saving.",{exact:true})).toBeVisible();await expect(dialog).toBeVisible();await expect(dialog.locator("#leave-edit-reason")).toHaveValue("Stale browser dates "+tag)
  expect(await read(futureId)).toMatchObject({status:"pending",workflow_version:2,start_date:"2098-09-03",end_date:"2098-09-05",days_requested:3,reason:"Current browser dates "+tag})
  await dialog.getByRole("button",{name:"Cancel",exact:true}).click();await stale.close();stale=null;panel=await open(page)
  stage="cancel and restore retained pending source"
  await card(page,futureId).getByRole("button",{name:"Cancel",exact:true}).click();await expect(dialog.getByRole("button",{name:"Cancel request",exact:true})).toBeDisabled()
  await dialog.locator("#leave-cancel-reason").fill("Browser withdrawal reason "+tag);await write(dialog.getByRole("button",{name:"Cancel request",exact:true}));await expect(dialog).toBeHidden()
  const cancelled=await read(futureId);expect(cancelled).toMatchObject({status:"cancelled",workflow_version:3,deleted_at:null,cancellation_reason:"Browser withdrawal reason "+tag});expect(cancelled.cancelled_by).toBeTruthy();expect(cancelled.cancelled_at).toBeTruthy()
  await card(page,futureId).getByRole("button",{name:"Restore",exact:true}).click();await dialog.locator("#leave-restore-reason").fill("Browser restoration reason "+tag);await write(dialog.getByRole("button",{name:"Restore",exact:true}));await expect(dialog).toBeHidden()
  expect(await read(futureId)).toMatchObject({status:"pending",workflow_version:4,cancelled_at:null,cancelled_by:null,cancellation_reason:null,reason:"Current browser dates "+tag})
  stage="future approval preserves current operations and final history"
  await expect(card(page,futureId).getByRole("button",{name:"Approve",exact:true})).toBeDisabled();await card(page,futureId).getByRole("textbox",{name:"Review reason",exact:true}).fill("Approve future browser evidence "+tag);await write(card(page,futureId).getByRole("button",{name:"Approve",exact:true}))
  await expect(card(page,futureId).getByRole("button",{name:"Edit",exact:true})).toHaveCount(0)
  const approved=await read(futureId);expect(approved).toMatchObject({status:"approved",workflow_version:5,start_date:"2098-09-03",end_date:"2098-09-05"});expect(approved.reviewed_by).toBeTruthy();expect(approved.reviewed_at).toBeTruthy();expect(await driverStatus()).toBe("active")
  stage="rejection retains reviewed evidence"
  const rejectedId=await create("2098-10-01","2098-10-02","Browser rejection fixture "+tag)
  await card(page,rejectedId).getByRole("textbox",{name:"Review reason",exact:true}).fill("Rejected synthetic evidence "+tag);await write(card(page,rejectedId).getByRole("button",{name:"Reject",exact:true}))
  await expect(card(page,rejectedId).getByText("Rejected",{exact:true})).toBeVisible()
  await expect(card(page,rejectedId).getByRole("button",{name:"Restore",exact:true})).toHaveCount(0);expect(await read(rejectedId)).toMatchObject({status:"rejected",workflow_version:2})
  stage="current leave changes driver status atomically"
  const parts=new Intl.DateTimeFormat("en",{timeZone:"Asia/Riyadh",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()),part=key=>parts.find(p=>p.type===key).value,today=part("year")+"-"+part("month")+"-"+part("day")
  const currentId=await create(today,today,"Browser current leave "+tag)
  await card(page,currentId).getByRole("textbox",{name:"Review reason",exact:true}).fill("Approve current browser leave "+tag);await write(card(page,currentId).getByRole("button",{name:"Approve",exact:true}))
  await expect.poll(driverStatus).toBe("on_leave");expect(await read(currentId)).toMatchObject({status:"approved",workflow_version:2})
  stage="complete history paging and focused literal search"
  const needle="Leave history 00 "+tag+",50%_"
  const fixtures=Array.from({length:31},(_,i)=>({id:randomUUID(),tenant_id:tenantId,driver_id:driverId,leave_type_id:typeId,start_date:new Date(Date.UTC(2097,0,1+i*2)).toISOString().slice(0,10),end_date:new Date(Date.UTC(2097,0,1+i*2)).toISOString().slice(0,10),days_requested:1,reason:i===0?needle:"Leave history "+String(i).padStart(2,"0")+" "+tag,status:"rejected",created_at:new Date(Date.UTC(2025,0,1,0,0,i)).toISOString()}))
  if((await admin.from("driver_leave_requests").insert(fixtures)).error)throw Error("Synthetic paged leave fixtures failed")
  panel=await open(page);await expect(panel.getByTestId("driver-leave-record")).toHaveCount(25);await expect(panel.getByText("34 records · Page 1 of 2",{exact:true})).toBeVisible()
  await panel.getByRole("button",{name:"Next page",exact:true}).click();await expect(card(page,fixtures[0].id)).toBeVisible();await expect(panel.getByTestId("driver-leave-record")).toHaveCount(9)
  const search=panel.getByRole("searchbox",{name:"Search history",exact:true});await search.pressSequentially(needle,{delay:40});await expect(search).toBeFocused();await expect(panel.getByTestId("driver-leave-record")).toHaveCount(1);await expect(card(page,fixtures[0].id)).toBeVisible()
  stage="history read failure and retry"
  failedRead=route=>route.request().method()==="GET"?route.fulfill({status:503,contentType:"application/json",body:'{"message":"Synthetic leave history unavailable"}'}):route.continue()
  await page.route(pattern,failedRead);await panel.getByRole("button",{name:"Refresh",exact:true}).click();await expect(panel.getByRole("alert")).toContainText("Could not load leave history. Try again.");await expect(panel.getByText("No leave requests",{exact:true})).toHaveCount(0)
  await page.unroute(pattern,failedRead);failedRead=null;await panel.getByRole("button",{name:"Try again",exact:true}).click();await expect(card(page,fixtures[0].id)).toBeVisible()
  stage="decision and status audit evidence"
  const audits=await admin.from("audit_log").select("entity_id,action").eq("tenant_id",tenantId).in("entity_id",[futureId,rejectedId,currentId,driverId]);if(audits.error)throw Error("Synthetic leave audit read failed")
  for(const[id,action,count]of[[futureId,"leave_create",1],[futureId,"leave_edit",1],[futureId,"leave_cancel",1],[futureId,"leave_restore",1],[futureId,"leave_approved",1],[rejectedId,"leave_rejected",1],[currentId,"leave_approved",1],[driverId,"status_changed",1]])expect(audits.data.filter(row=>row.entity_id===id&&row.action===action)).toHaveLength(count)
  stage="Arabic mobile leave history"
  await page.goto(appUrl+"/drivers/"+driverId+"?lang=ar");await page.getByRole("tab",{name:"الإجازات",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("lang","ar");await page.setViewportSize({width:390,height:844})
  const ar=page.getByRole("tabpanel",{name:"الإجازات",exact:true});await expect(ar.getByRole("searchbox",{name:"بحث في السجل",exact:true})).toBeVisible();await expect(ar.getByTestId("driver-leave-record")).toHaveCount(25);await expect.poll(()=>ar.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(2)
  await page.screenshot({path:"supabase/.temp/driver-leave-mobile-ar.png",fullPage:true})
  console.log(JSON.stringify({check:"driver leave lifecycle, stale edits, current status, audit, complete paging/search/retry and Arabic mobile",result:"PASS"}))
 }catch(error){console.error(JSON.stringify({check:"driver leave lifecycle",stage,errorType:error.name}));await page.screenshot({path:"supabase/.temp/driver-leave-failure.png",fullPage:true}).catch(()=>{});throw Error("Driver leave lifecycle verification failed: "+stage)}
 finally{if(stale)await stale.close();if(failedRead)await page.unroute(pattern,failedRead);if(viewport)await page.setViewportSize(viewport);await page.goto(appUrl+"/dashboard?lang="+(locale??"en"))}
}
