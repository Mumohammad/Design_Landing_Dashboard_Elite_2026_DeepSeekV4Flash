import { expect as baseExpect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'

const expect=baseExpect.configure({timeout:25000})

// Uses public forms and disposable Auth users only. Recovery tokens and
// passwords stay in memory; never capture them in logs or failure screenshots.
export async function verifyNewPasswordFlows(browser,admin,appUrl,anonKey){
  const app=new URL(appUrl),db=new URL(admin.supabaseUrl)
  const local=['localhost','127.0.0.1'].includes(app.hostname)&&['3107','3108'].includes(app.port)
    &&['localhost','127.0.0.1'].includes(db.hostname)&&db.port==='58321'
  if(!local){
    if(db.origin!=='https://viowrovartosrkqukjxy.supabase.co'||app.hostname==='elite-dashboard-blush.vercel.app')throw Error('Isolated staging required')
    const policy=(await fetch(appUrl+'/landing')).headers.get('content-security-policy')??''
    if(!policy.includes(db.origin)||policy.includes('wwfnsbilmyxeawgzicmv'))throw Error('Isolated app/database required')
  }
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'})
  const page=await context.newPage()
  const user=createClient(db.href,anonKey,{auth:{persistSession:false,autoRefreshToken:false}})
  let fixtureId,recoveryStarted=false,revoked=false,stage='public forms'
  try{
    for(const locale of ['en','ar']){
      const hint=locale==='ar'?'استخدم من 10 إلى 128 حرفاً، مع حرف إنجليزي ورقم على الأقل.':'Use 10–128 characters, including at least one English letter and one number.'
      let mutations=0
      const record=request=>{if(request.method()==='POST'||request.method()==='PUT')mutations++}
      page.on('request',record)
      stage=`${locale} reset validation`
      await page.goto(appUrl+'/auth/reset-password?lang='+locale)
      await expect(page.locator('html')).toHaveAttribute('lang',locale)
      await expect(page.locator('#password')).toHaveAttribute('minlength','10')
      await expect(page.locator('#password')).toHaveAttribute('maxlength','128')
      await expect(page.locator('#password-policy')).toHaveText(hint)
      await page.locator('#password').fill('x'.repeat(12))
      await page.locator('#confirm').fill('x'.repeat(12))
      mutations=0
      await page.locator('button[type="submit"]').click()
      await expect(page.getByRole('alert')).toHaveText(hint)
      expect(mutations).toBe(0)
      await page.screenshot({path:`supabase/.temp/password-reset-${locale}-mobile.png`,fullPage:true})

      stage=`${locale} invite validation`
      // Nonexistent identifiers expose only the public form. Weak passwords
      // must stop client-side, before any server action/token consumption.
      await page.goto(appUrl+`/auth/accept-invite?lang=${locale}&tid=${randomUUID()}&token=synthetic-unused-token`)
      await page.locator('#fullName').fill('Synthetic invite')
      await page.locator('#password').fill('x'.repeat(12))
      await page.locator('#confirm').fill('x'.repeat(12))
      mutations=0
      await page.locator('button[type="submit"]').click()
      await expect(page.getByRole('alert')).toHaveText(hint)
      expect(mutations).toBe(0)

      stage=`${locale} registration validation`
      await page.goto(appUrl+'/platform/register?lang='+locale)
      await page.locator('#registration-company').fill('Synthetic company')
      await page.locator('#registration-domain').fill('password-policy.example.test')
      await page.locator('#registration-email').fill(`unused-${randomUUID()}@example.test`)
      await page.locator('#registration-password').fill('x'.repeat(12))
      await expect(page.locator('#registration-password-policy')).toHaveText(hint)
      const submit=page.getByRole('button',{name:locale==='ar'?'أنشئ المساحة':'Create workspace',exact:true})
      mutations=0
      await submit.click()
      await expect(page.getByRole('alert')).toHaveText(hint)
      expect(mutations).toBe(0)
      if(!(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)))throw Error('Registration viewport overflows')
      await page.screenshot({path:`supabase/.temp/password-registration-${locale}-mobile.png`,fullPage:true})
      page.off('request',record)
    }

    stage='real recovery fixture'
    const email=`password-recovery-${randomUUID()}@example.test`
    const initial=randomBytes(20).toString('base64url')+'a1'
    const replacement=randomBytes(20).toString('base64url')+'a1'
    const fixture=await admin.auth.admin.createUser({email,password:initial,email_confirm:true,app_metadata:{_invite_provisioned:true}})
    if(fixture.error||!fixture.data.user)throw Error('Recovery fixture failed')
    fixtureId=fixture.data.user.id
    const link=await admin.auth.admin.generateLink({type:'recovery',email})
    const tokenHash=link.data.properties?.hashed_token
    if(link.error||!tokenHash)throw Error('Recovery link generation failed')
    stage='recovery session and strong password update'
    recoveryStarted=true
    await page.goto(appUrl+'/auth/confirm?type=recovery&token_hash='+encodeURIComponent(tokenHash))
    await page.waitForURL(url=>url.pathname==='/auth/reset-password')
    await page.locator('#password').fill(replacement)
    await page.locator('#confirm').fill(replacement)
    const updated=page.waitForResponse(response=>new URL(response.url()).pathname==='/auth/v1/user'&&response.request().method()==='PUT')
    await page.locator('button[type="submit"]').click()
    expect((await updated).status()).toBe(200)
    await expect(page.locator('button[type="submit"]')).toBeDisabled()
    const signed=await user.auth.signInWithPassword({email,password:replacement})
    if(signed.error||signed.data.user?.id!==fixtureId)throw Error('Updated password sign-in failed')
    if((await user.auth.signOut({scope:'global'})).error)throw Error('Recovery fixture sign-out failed')
    revoked=true
    const old=await user.auth.signInWithPassword({email,password:initial})
    if(!old.error||old.data.session)throw Error('Replaced password still accepted')
    console.log('PASS: English/Arabic mobile password hints; weak reset/invite/registration blocked before requests; localized registration control; real recovery session updates password and rejects old credential')
  }catch(error){
    console.error(JSON.stringify({check:'new password flows',stage,errorType:error.name}))
    throw Error('New password verification failed: '+stage)
  }finally{
    if(recoveryStarted){
      try{
        await page.goto(appUrl+'/auth/sign-out')
        await page.waitForURL(url=>url.pathname==='/landing')
        revoked=true
      }catch{
        // Preserve an unreconciled fixture if session revocation could not be
        // confirmed. Deleting Auth users alone does not revoke existing JWTs.
        if(!revoked)console.error('FAIL: recovery fixture session revocation requires review')
      }
    }
    await context.close()
    if(recoveryStarted&&!revoked)throw Error('Recovery session cleanup failed')
    if(fixtureId&&(await admin.auth.admin.deleteUser(fixtureId,true)).error)throw Error('Recovery fixture retirement failed')
  }
}
