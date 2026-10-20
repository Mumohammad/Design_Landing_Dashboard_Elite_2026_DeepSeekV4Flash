import { expect as baseExpect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'

const expect=baseExpect.configure({timeout:25000})

export async function verifyRequiredPasswordChange(page,admin,actorId,appUrl,{responseLoss=false,locale='en',nextPath='/dashboard'}={}){
  const db=new URL(admin.supabaseUrl),app=new URL(appUrl)
  const local=['localhost','127.0.0.1'].includes(db.hostname)&&db.port==='58321'&&['http://localhost:3107','http://localhost:3108'].includes(app.origin)
  if(!local){
    if(db.origin!=='https://viowrovartosrkqukjxy.supabase.co'||app.hostname==='elite-dashboard-blush.vercel.app')throw Error('Isolated staging required')
    const policy=(await fetch(appUrl+'/landing')).headers.get('content-security-policy')??''
    if(!policy.includes(db.origin)||policy.includes('wwfnsbilmyxeawgzicmv'))throw Error('Isolated app/database required')
  }
  if(!['en','ar'].includes(locale)||!['/dashboard','/settings/mfa'].includes(nextPath))throw Error('Bounded password verification options required')
  const viewport=page.viewportSize(),replacement=randomBytes(20).toString('base64url')+'a1'
  const pattern='**/auth/change-password*'
  let stage='required password routing',lost=false
  try{
    await page.waitForURL(url=>url.pathname==='/auth/change-password')
    if(locale==='ar')await page.setViewportSize({width:390,height:844})
    await page.goto(appUrl+'/auth/change-password?lang='+locale)
    await expect(page.locator('html')).toHaveAttribute('lang',locale)
    await expect(page.getByRole('heading',{name:locale==='ar'?'تغيير كلمة المرور':'Change Password',exact:true})).toBeVisible()
    const before=await admin.from('users').select('id,must_change_password,credential_revision,password_requirement_version').eq('auth_user_id',actorId).single()
    if(before.error||!before.data.must_change_password)throw Error('Explicit disposable requirement needed')
    const count=async action=>{
      const result=await admin.from('audit_log').select('id',{count:'exact',head:true}).eq('entity_id',before.data.id).eq('action',action)
      if(result.error||result.count===null)throw Error('Password audit count unavailable')
      return result.count
    }
    const observations=await count('auth_password_changed'),completions=await count('required_password_change_completed')
    if(!(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)))throw Error('Password viewport overflows')
    // Capture only the untouched form, never entered passwords or factor codes.
    await page.screenshot({path:`supabase/.temp/password-required-${locale}-${locale==='ar'?'mobile':'desktop'}.png`,fullPage:true})
    stage='required password authenticated update'
    await page.locator('#password').fill(replacement);await page.locator('#confirm').fill(replacement)
    if(responseLoss)await page.route(pattern,async route=>{
      const request=route.request()
      if(!lost&&request.method()==='POST'&&request.headers()['next-action']&&request.postData()?.includes(replacement)){
        lost=true;const response=await route.fetch()
        if(!response.ok())throw Error('Password action failed before response-loss injection')
        await route.abort('failed')
      }else await route.continue()
    })
    await page.locator('button[type="submit"]').click()
    if(responseLoss){
      await expect(page.locator('form').getByRole('alert')).toContainText('Unable to confirm the change')
      await page.unroute(pattern)
      if(!lost)throw Error('Password response loss was not exercised')
    }else{
      await expect(page.getByRole('status').filter({hasText:/Password updated|تم تحديث كلمة المرور/})).toBeVisible()
      await expect(page.locator('#password')).toHaveCount(0)
    }
    stage='password completion and audit evidence'
    const after=await admin.from('users').select('must_change_password,credential_revision,credential_requirement_version,password_requirement_version').eq('auth_user_id',actorId).single()
    if(after.error||after.data.must_change_password||after.data.credential_revision!==before.data.credential_revision+1
      ||after.data.password_requirement_version!==before.data.password_requirement_version||after.data.credential_requirement_version!==before.data.password_requirement_version
      ||await count('auth_password_changed')!==observations+1||await count('required_password_change_completed')!==completions+1)throw Error('Password completion evidence differs')
    stage='same-session continuation without another sign-in'
    if(responseLoss)await page.getByRole('link',{name:'Check account access',exact:true}).click()
    else await page.getByRole('button',{name:locale==='ar'?'متابعة إلى حسابي':'Continue to my account',exact:true}).click()
    await page.waitForURL(url=>url.pathname===nextPath)
    if(viewport)await page.setViewportSize(viewport)
    if(locale!=='en')await page.goto(appUrl+nextPath+'?lang=en')
    console.log('PASS: required password → trusted completion/audits → same-session continuation; '+(responseLoss?'committed-response loss recovery':'Arabic mobile and existing MFA retained'))
    return replacement
  }catch(error){
    const alerts=await page.getByRole('alert').allTextContents().catch(()=>[])
    const patterns=[['transport-uncertainty',/Unable to confirm the change/],['server-uncertainty',/password change could not be confirmed/],['same-password',/different from your current password/],['verification-unavailable',/Password verification is unavailable/],['session-required',/Sign in again/],['factor-required',/Verify your authenticator/],['rate-limited',/Too many attempts/],['reauthentication-required',/Request a verification code/]]
    console.error(JSON.stringify({check:'required password',stage,errorType:error.name,lost,
      operation:/expect\(locator\)\.[A-Za-z]+/.exec(error.message)?.[0],
      alertKinds:alerts.map(text=>patterns.find(([,pattern])=>pattern.test(text))?.[0]??'other'),
      submitCount:await page.locator('button[type="submit"]').count().catch(()=>null),
      reviewLinkCount:await page.getByRole('link',{name:'Check account access',exact:true}).count().catch(()=>null)}))
    throw Error('Required password verification failed: '+stage)
  }finally{await page.unroute(pattern).catch(()=>{});if(viewport)await page.setViewportSize(viewport)}
}

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
      const record=request=>{
        const path=new URL(request.url()).pathname
        if((request.method()==='POST'||request.method()==='PUT')
          &&(path==='/auth/v1/user'||path==='/api/platform/register'||request.headers()['next-action']))mutations++
      }
      page.on('request',record)
      stage=`${locale} reset validation`
      await page.goto(appUrl+'/auth/reset-password?lang='+locale)
      await expect(page.locator('html')).toHaveAttribute('lang',locale)
      await expect(page.locator('#password')).toHaveAttribute('minlength','10')
      await expect(page.locator('#password')).toHaveAttribute('maxlength','128')
      await expect(page.locator('#password-policy')).toHaveText(hint)
      await page.locator('#password').fill('x'.repeat(12))
      await page.locator('#confirm').fill('x'.repeat(12))
      stage=`${locale} reset weak-input error`
      mutations=0
      await page.locator('button[type="submit"]').click()
      await expect(page.getByRole('alert').filter({hasText:hint})).toHaveText(hint)
      stage=`${locale} reset no Auth mutation`
      expect(mutations).toBe(0)
      stage=`${locale} reset mobile capture`
      await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}))
      await page.screenshot({path:`supabase/.temp/password-reset-${locale}-mobile.png`,fullPage:true,animations:'disabled'})
      stage=`${locale} validation follows live language switch`
      const other=locale==='en'?'ar':'en'
      await page.getByRole('button',{name:locale==='ar'?'Switch language to English':'تغيير اللغة إلى العربية',exact:true}).click()
      await expect(page.locator('html')).toHaveAttribute('lang',other)
      await expect(page.locator('form').getByRole('alert')).toHaveText(other==='ar'?'استخدم من 10 إلى 128 حرفاً، مع حرف إنجليزي ورقم على الأقل.':'Use 10–128 characters, including at least one English letter and one number.')
      await page.getByRole('button',{name:other==='ar'?'Switch language to English':'تغيير اللغة إلى العربية',exact:true}).click()
      await expect(page.locator('html')).toHaveAttribute('lang',locale)
      stage=`${locale} confirmation mismatch stays local and accessible`
      await page.locator('#password').fill('ExampleMismatch123')
      await page.locator('#confirm').fill('DifferentMismatch123')
      await page.locator('button[type="submit"]').click()
      await expect(page.locator('form').getByRole('alert')).toHaveText(locale==='ar'?'كلمتا المرور غير متطابقتين.':'Passwords do not match.')
      await expect(page.locator('#confirm')).toHaveAttribute('aria-invalid','true')
      await expect(page.locator('#confirm')).toHaveAttribute('aria-describedby','password-form-error')
      expect(mutations).toBe(0)
      if(!(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)))throw Error('Password validation viewport overflows')

      stage=`${locale} invite validation`
      // Nonexistent identifiers expose only the public form. Weak passwords
      // must stop client-side, before any server action/token consumption.
      await page.goto(appUrl+`/auth/accept-invite?lang=${locale}&tid=${randomUUID()}&token=synthetic-unused-token`)
      await page.locator('#fullName').fill('Synthetic invite')
      await page.locator('#password').fill('x'.repeat(12))
      await page.locator('#confirm').fill('x'.repeat(12))
      mutations=0
      await page.locator('button[type="submit"]').click()
      await expect(page.getByRole('alert').filter({hasText:hint})).toHaveText(hint)
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
      await expect(page.getByRole('alert').filter({hasText:hint})).toHaveText(hint)
      expect(mutations).toBe(0)
      if(!(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)))throw Error('Registration viewport overflows')
      await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}))
      await page.screenshot({path:`supabase/.temp/password-registration-${locale}-mobile.png`,fullPage:true,animations:'disabled'})
      page.off('request',record)
    }

    stage='real recovery fixture'
    const email=`password-recovery-${randomUUID()}@example.test`
    const initial=randomBytes(20).toString('base64url')+'a1'
    const replacement=randomBytes(20).toString('base64url')+'a1'
    const fixture=await admin.auth.admin.createUser({email,password:initial,email_confirm:true,app_metadata:{_invite_provisioned:true}})
    if(fixture.error||!fixture.data.user)throw Error('Recovery fixture failed')
    fixtureId=fixture.data.user.id
    const company=await admin.rpc('provision_company_atomic',{p_auth_user_id:fixtureId,p_company:{name:'Recovery fixture',slug:fixtureId,domain:fixtureId+'.test'}})
    if(company.error)throw Error('Recovery application fixture failed')
    if((await admin.from('users').update({must_change_password:true}).eq('auth_user_id',fixtureId)).error)throw Error('Recovery requirement fixture failed')
    const link=await admin.auth.admin.generateLink({type:'recovery',email})
    const tokenHash=link.data.properties?.hashed_token
    if(link.error||!tokenHash)throw Error('Recovery link generation failed')
    stage='recovery session and strong password update'
    recoveryStarted=true
    await page.goto(appUrl+'/auth/confirm?type=recovery&token_hash='+encodeURIComponent(tokenHash))
    await page.waitForURL(url=>url.pathname==='/auth/reset-password')
    await page.locator('#password').fill(replacement)
    await page.locator('#confirm').fill(replacement)
    const updated=page.waitForResponse(response=>new URL(response.url()).pathname==='/auth/reset-password'&&response.request().method()==='POST'&&Boolean(response.request().headers()['next-action']))
    await page.locator('button[type="submit"]').click()
    expect((await updated).status()).toBe(200)
    await expect(page.getByRole('status').filter({hasText:/password.*updated|تحديث كلمة المرور/i})).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toHaveCount(0)
    const completed=await admin.from('users').select('must_change_password,credential_revision,credential_requirement_version,password_requirement_version').eq('auth_user_id',fixtureId).single()
    if(completed.error||completed.data.must_change_password||completed.data.credential_revision!==1||completed.data.credential_requirement_version!==completed.data.password_requirement_version)throw Error('Recovery completion was not recorded')
    await page.getByRole('button',{name:/Continue to my account|متابعة إلى حسابي/}).click()
    await page.waitForURL(url=>url.pathname==='/settings/mfa')
    const signed=await user.auth.signInWithPassword({email,password:replacement})
    if(signed.error||signed.data.user?.id!==fixtureId)throw Error('Updated password sign-in failed')
    if((await user.auth.signOut({scope:'global'})).error)throw Error('Recovery fixture sign-out failed')
    revoked=true
    const old=await user.auth.signInWithPassword({email,password:initial})
    if(!old.error||old.data.session)throw Error('Replaced password still accepted')
    console.log('PASS: English/Arabic mobile password hints; weak reset/invite/registration blocked before requests; localized registration control; real recovery session updates password and rejects old credential')
  }catch(error){
    console.error(JSON.stringify({check:'new password flows',stage,errorType:error.name,
      failureKind:/strict mode violation/.test(error.message)?'ambiguous-locator':/Timeout/.test(error.name)?'timeout':/expect\(/.test(error.message)?'assertion':'other',
      submitCount:await page.locator('button[type="submit"]').count().catch(()=>null),alertCount:await page.getByRole('alert').count().catch(()=>null)}))
    if(stage.includes('reset weak-input'))await page.screenshot({path:'supabase/.temp/password-public-reset-failure.png',fullPage:true}).catch(()=>{})
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
    if(fixtureId){
      if((await admin.from('users').update({status:'inactive'}).eq('auth_user_id',fixtureId)).error)throw Error('Recovery fixture app access retirement failed')
      if((await admin.auth.admin.deleteUser(fixtureId,true)).error)throw Error('Recovery fixture retirement failed')
    }
  }
}
