import {expect as baseExpect} from "@playwright/test"
import {translations} from "../src/lib/i18n/translations.ts"
import {assertModuleTestTarget} from "./assert-module-test-target.mjs"
const expect=baseExpect.configure({timeout:30_000})

/** Reuse the release owner's real MFA session; never a demo account or fixture login bypass. */
export async function verifyModuleLocales(page,backendUrl,appUrl){
 await assertModuleTestTarget(page,backendUrl,appUrl)
 const readFailures=[],runtimeErrors=[]
 let signIns=0
 const onRequest=request=>{if(request.method()==="POST"&&new URL(request.url()).pathname==="/api/auth/sign-in")signIns++}
 const onError=error=>runtimeErrors.push(error.name)
 const onResponse=response=>{const url=new URL(response.url());if(response.status()>=400&&response.request().method()==="GET"&&(url.pathname.startsWith("/rest/v1/")||url.pathname.startsWith("/api/")))readFailures.push({path:url.pathname,status:response.status()})}
 page.on("request",onRequest);page.on("pageerror",onError);page.on("response",onResponse)
 const modules=[
  ["/dashboard","dashboard"],["/drivers","drivers"],["/vehicles","vehicles"],
  ["/attendance","attendance"],["/orders","orders"],["/platforms","platforms"],
  ["/payroll","payroll"],["/expenses","expenses"],["/invoices","invoices"],
  ["/accounting","accounting"],["/payments","payments"],["/maintenance","maintenance"],
  ["/violations","violations"],["/hr","hrManagement"],["/applications","applications"],
  ["/reports","reports"],["/users","users"],["/roles","roles"],
  ["/approvals","approvals"],["/audit-log","auditLog"],["/security","security"],["/settings","settings"],
 ]
 try{
  for(const path of ["/landing?lang=en","/platform/login","/auth/sign-in?returnTo=%2Finvoices"]){
   await page.goto(appUrl+path)
   if(path.startsWith("/landing"))await page.getByRole("navigation").getByRole("link",{name:"Sign in",exact:true}).first().click()
   await page.waitForURL(url=>["/dashboard","/invoices"].includes(url.pathname))
   await expect(page.locator("main")).toBeVisible()
  }
  expect(signIns).toBe(0)
  for(const locale of ["en","ar"]){
   for(const[path,label]of modules){
    const response=await page.goto(appUrl+path+"?lang="+locale)
    expect(response?.ok()).toBe(true)
    expect(new URL(page.url()).pathname).toBe(path)
    await expect(page.locator("html")).toHaveAttribute("lang",locale)
    await expect(page.locator("html")).toHaveAttribute("dir",locale==="ar"?"rtl":"ltr")
    const heading=path==="/dashboard"?translations[locale].app.dashboardTitle:path==="/approvals"?(locale==="ar"?"صندوق القرارات":"Approvals Inbox"):translations[locale].nav[label]
    await expect(page.getByRole("heading",{level:1}).first()).toContainText(heading)
    await page.waitForLoadState("networkidle",{timeout:20_000})
    await expect(page.getByText("Unable to load this module",{exact:true})).toHaveCount(0)
    await expect(page.getByText("تعذّر تحميل هذه الوحدة",{exact:true})).toHaveCount(0)
   }
  }
  await page.goto(appUrl+"/dashboard?lang=en")
  const other=await page.context().newPage()
  try{
   await other.goto(appUrl+"/landing")
   await expect(other.locator("html")).toHaveAttribute("lang","en")
   await page.getByRole("button",{name:"تغيير اللغة إلى العربية",exact:true}).first().click()
   await expect(page.locator("html")).toHaveAttribute("lang","ar")
   await expect(other.locator("html")).toHaveAttribute("lang","ar")
   await expect(other.getByRole("heading",{name:"خطط بسيطة لأي حجم أسطول"})).toBeVisible()
   await page.getByRole("button",{name:"Switch language to English",exact:true}).first().click()
   await expect(other.locator("html")).toHaveAttribute("lang","en")
  }finally{await other.close()}
  expect(readFailures).toEqual([])
  expect(runtimeErrors).toEqual([])
  expect(signIns).toBe(0)
  console.log(JSON.stringify({check:"all22business modules English/Arabic, cross-tab language and existing session entry points",result:"PASS",moduleRoutes:modules.length,localeVisits:modules.length*2}))
 }finally{page.off("request",onRequest);page.off("pageerror",onError);page.off("response",onResponse)}
}
