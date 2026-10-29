import { assertModuleTestTarget } from "./assert-module-test-target.mjs"
import { expect as baseExpect } from "@playwright/test"
const expect=baseExpect.configure({timeout:20_000})
/** Mutating acceptance gate for a synthetic tenant; production is excluded. */
export async function verifyUserRoleManagement(page,admin,tenantId,appUrl){
 await assertModuleTestTarget(page,admin.supabaseUrl,appUrl)
 const app=new URL(appUrl),backend=new URL(admin.supabaseUrl)
 const local=["localhost","127.0.0.1"].includes(app.hostname)&&["localhost","127.0.0.1"].includes(backend.hostname)
 const stage=app.protocol==="https:"&&app.hostname.endsWith(".vercel.app")&&app.hostname!=="elite-dashboard-blush.vercel.app"&&backend.hostname==="viowrovartosrkqukjxy.supabase.co"
 if(!local&&!stage)throw new Error("Management acceptance requires loopback or approved isolated staging")
 let step="synthetic member fixture"
 let authId
 try{
  const suffix=crypto.randomUUID().slice(0,8),email="managed-browser-"+suffix+"@example.test"
  const identity=await admin.auth.admin.createUser({email,password:"Fixture!"+crypto.randomUUID()+"aA1",email_confirm:true,app_metadata:{_invite_provisioned:true}})
  if(identity.error||!identity.data.user)throw new Error("Synthetic identity creation failed")
  authId=identity.data.user.id
  const member=await admin.from("users").insert({auth_user_id:authId,tenant_id:tenantId,email,full_name_en:"Managed browser "+suffix,role:"readonly_auditor",status:"active",must_change_password:false}).select("id").single()
  if(member.error)throw new Error("Synthetic member creation failed")
  const id=member.data.id
  const read=async()=>{const result=await admin.from("users").select("*").eq("id",id).eq("tenant_id",tenantId).single();if(result.error)throw new Error("Persisted management fixture missing");return result.data}
  const dialog=page.getByRole("dialog")
  await page.goto(appUrl+"/users/"+id+"?lang=en")
  step="profile edit and server-side phone masking"
  await page.getByRole("button",{name:"Edit profile",exact:true}).click()
  await dialog.locator("#managed-user-en").fill("Managed edited "+suffix)
  await dialog.locator("#managed-user-code").fill("BROWSER-"+suffix.toUpperCase())
  await dialog.locator("#managed-user-phone").fill("0501380001")
  await page.setViewportSize({width:375,height:812})
  await expect.poll(()=>dialog.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(2)
  await page.screenshot({path:"supabase/.temp/user-management-mobile.png"})
  await dialog.getByRole("button",{name:"Save user",exact:true}).click()
  await expect(dialog).toBeHidden()
  expect(await read()).toMatchObject({full_name_en:"Managed edited "+suffix,employee_code:"BROWSER-"+suffix.toUpperCase(),phone:"0501380001"})
  await expect(page.getByText("0501380001",{exact:true})).toHaveCount(0)
  await page.setViewportSize({width:1280,height:900})
  step="owner role reassignment and synchronized history"
  await page.getByRole("button",{name:"Change role",exact:true}).click()
  await dialog.locator("#managed-user-role").selectOption("supervisor")
  await dialog.locator("#managed-user-reason").fill("Synthetic operational responsibility")
  await dialog.getByRole("button",{name:"Save user",exact:true}).click()
  await expect(dialog).toBeHidden()
  expect((await read()).role).toBe("supervisor")
  const assignments=await admin.from("user_role_assignments").select("role_id").eq("tenant_id",tenantId).eq("user_id",id).is("revoked_at",null).is("deleted_at",null)
  expect(assignments.error).toBeNull();expect(assignments.data).toHaveLength(1)
  step="user lifecycle and archive history"
  await page.getByRole("button",{name:"Actions",exact:true}).click()
  await page.getByRole("menuitem",{name:"Set to: Inactive",exact:true}).click()
  await dialog.locator("#status-reason").fill("Deactivate synthetic member")
  await dialog.getByRole("button",{name:"Confirm change",exact:true}).click()
  await expect(dialog).toBeHidden()
  expect((await read()).status).toBe("inactive")
  await page.getByRole("button",{name:"Archive user",exact:true}).click()
  await dialog.locator("#managed-user-reason").fill("Retire synthetic member record")
  await dialog.getByRole("button",{name:"Save user",exact:true}).click()
  await expect(page).toHaveURL(/\/users(?:\?[^/]*)?$/)
  expect((await read()).deleted_at).toBeTruthy()
  const ended=await admin.from("user_role_assignments").select("id").eq("tenant_id",tenantId).eq("user_id",id).is("revoked_at",null)
  expect(ended.data).toHaveLength(0)
  step="owner role labels and existing-catalog grants"
  const role=await admin.from("roles").select("*").eq("tenant_id",tenantId).eq("name","accountant").is("deleted_at",null).single()
  if(role.error)throw new Error("Synthetic tenant preset unavailable")
  await page.goto(appUrl+"/roles?lang=en")
  const roleRow=page.getByRole("row").filter({hasText:role.data.name_en})
  await roleRow.getByRole("button",{name:"Edit permissions",exact:true}).click()
  await dialog.locator("#managed-role-en").fill("Browser accountant "+suffix)
  const check=dialog.getByRole("checkbox").first(),wasChecked=await check.isChecked()
  await check.setChecked(!wasChecked)
  await dialog.getByRole("button",{name:"Save role",exact:true}).click()
  await expect(dialog).toBeHidden()
  const changed=await admin.from("roles").select("name_en,version").eq("id",role.data.id).eq("tenant_id",tenantId).single()
  expect(changed.data.name_en).toBe("Browser accountant "+suffix)
  expect(changed.data.version).toBeGreaterThan(role.data.version)
  await page.getByRole("row").filter({hasText:"Browser accountant "+suffix}).getByRole("button",{name:"Edit permissions",exact:true}).click()
  await dialog.locator("#managed-role-en").fill(role.data.name_en)
  await dialog.getByRole("checkbox").first().setChecked(wasChecked)
  await dialog.getByRole("button",{name:"Save role",exact:true}).click()
  await expect(dialog).toBeHidden()
  const gm=await admin.from("roles").select("name_en").eq("tenant_id",tenantId).eq("name","general_manager").single()
  await expect(page.getByRole("row").filter({hasText:gm.data.name_en}).getByRole("button",{name:"Edit permissions",exact:true})).toHaveCount(0)
  step="roster and security read errors recover visibly"
  for(const path of ["/users","/security"]){
   const target=url=>new URL(url).origin===app.origin&&new URL(url).pathname===path
   const handler=route=>route.request().method()==="POST"&&route.request().headers()["next-action"]?route.fulfill({status:503,contentType:"text/plain",body:"Synthetic read unavailable"}):route.continue()
   await page.route(target,handler)
   await page.goto(appUrl+path+"?lang=en")
   await expect(page.locator("main").getByRole("alert").filter({hasText:path==="/users"?"Could not load users":"Could not load security overview"})).toContainText(path==="/users"?"Could not load users":"Could not load security overview")
   await page.unroute(target,handler)
   await page.getByRole("button",{name:"Retry",exact:true}).click()
   await expect(page.locator("main").getByRole("alert")).toHaveCount(0)
   await expect(page.getByRole("heading",{name:path==="/users"?"Users":"Security",exact:true})).toBeVisible()
  }
  console.log("PASS: authenticated user profile/code/phone masking, role assignment/history, status/archive, catalog-grant edit, protected GM role and responsive forms")
 }catch(error){console.error(JSON.stringify({check:"user-role-management",stage:step,errorType:error.name}));throw new Error("Management browser verification failed: "+step)}
 finally{
  // This helper alone owns the returned synthetic Auth ID, including failures
  // before the profile is archived. Keep its business history; retire access.
  if(authId){
   const inactive=await admin.from("users").update({status:"inactive"}).eq("auth_user_id",authId).eq("tenant_id",tenantId)
   const retired=await admin.auth.admin.deleteUser(authId,true)
   if(inactive.error||retired.error)throw new Error("Synthetic managed-member access retirement failed")
  }
 }
}
