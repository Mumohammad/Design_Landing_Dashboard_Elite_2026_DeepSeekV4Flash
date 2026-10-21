import { expect as baseExpect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
const expect = baseExpect.configure({timeout:20_000})

// Read-only browser operations over exact owned synthetic fixtures, never production.
export async function verifyApprovalsInbox(page,admin,tenantId,appUrl){
  const target=new URL(appUrl),database=new URL(admin.supabaseUrl)
  const local=['localhost','127.0.0.1'].includes(target.hostname)&&['3107','3108'].includes(target.port)
  if(local&&(!['localhost','127.0.0.1'].includes(database.hostname)||database.port!=='58321'))throw Error('Disposable database required')
  if(!local){
    const policy=(await fetch(appUrl+'/landing')).headers.get('content-security-policy')??''
    if(database.origin!=='https://viowrovartosrkqukjxy.supabase.co'||!policy.includes(database.origin)||policy.includes('https://wwfnsbilmyxeawgzicmv.supabase.co'))throw Error('Isolated staging target required')
  }
  const initialViewport=page.viewportSize(),initialLocale=await page.locator('html').getAttribute('lang')
  const tag=randomUUID().slice(0,8),ids=Array.from({length:105},()=>randomUUID())
  const appId=randomUUID(),driverId=randomUUID(),leaveId=randomUUID()
  const hiddenName=`HiddenApplicant${tag} SecretSurname`,literal=`Literal %_أحمد ${tag}`
  const appReference=`DRV-Q-${tag}`,phone='0501112233',identity=`private-${tag}`
  let leaveTypeId,createdLeaveType=false,stage='fixtures',releaseStale,releaseFresh
  const patterns=[]
  let wireViolation=false
  const checks=[]
  const inspect=response=>{
    if(response.request().method()==='POST'&&new URL(response.url()).pathname==='/approvals'){
      checks.push(response.text().then(text=>{
        if(text.includes(hiddenName)||text.includes('SecretSurname')||text.includes(phone)||text.includes(identity))wireViolation=true
      }).catch(()=>{}))
    }
  }
  page.on('response',inspect)
  try{
    const initial=await admin.from('expenses').select('id',{count:'exact',head:true}).eq('tenant_id',tenantId).is('deleted_at',null).eq('is_approved',false).is('rejected_at',null)
    if(initial.error||initial.count!==0)throw Error('Fresh disposable queue required')
    let type=await admin.from('leave_types').select('id').eq('tenant_id',tenantId).eq('code','annual').is('deleted_at',null).maybeSingle()
    if(type.error)throw Error('Synthetic leave type lookup failed')
    if(!type.data){type=await admin.from('leave_types').insert({tenant_id:tenantId,code:'annual',name_ar:'سنوية',name_en:'Annual',days_per_year:30}).select('id').single();createdLeaveType=true}
    if(type.error||!type.data?.id)throw Error('Synthetic leave type failed')
    leaveTypeId=type.data.id
    if((await admin.from('drivers').insert({id:driverId,tenant_id:tenantId,full_name_ar:'سائق اختباري',primary_mobile:'+966500000000',category:'freelancer',status:'active',hire_date:new Date(Date.now()-400*86400000).toISOString().slice(0,10)})).error)throw Error('Synthetic driver failed')
    if((await admin.from('driver_leave_requests').insert({id:leaveId,tenant_id:tenantId,driver_id:driverId,leave_type_id:leaveTypeId,start_date:new Date(Date.now()+7*86400000).toISOString().slice(0,10),end_date:new Date(Date.now()+7*86400000).toISOString().slice(0,10),days_requested:1,status:'pending'})).error)throw Error('Synthetic leave failed')
    if((await admin.from('driver_applications').insert({id:appId,tenant_id:tenantId,application_number:appReference,first_name:`HiddenApplicant${tag}`,last_name:'SecretSurname',full_name:hiddenName,mobile:phone,identity_type:'iqama',identity_number:identity,work_type:'full_time',status:'submitted',city:'Riyadh'})).error)throw Error('Synthetic application failed')
    if((await admin.from('expenses').insert(ids.map((id,i)=>({id,tenant_id:tenantId,expense_type:'fuel',amount:0.1,currency:'SAR',expense_date:'2020-01-01',created_at:'2020-01-01T00:00:00Z',vendor:i===104?literal:`Queue vendor ${tag} ${i}`,is_approved:false})))).error)throw Error('Synthetic expenses failed')
    stage='all-source pages and exact totals'
    await page.goto(appUrl+'/approvals?lang=en')
    const rows=page.locator('tbody tr'),search=page.getByRole('textbox',{name:'Search references and visible details...',exact:true})
    const metrics=page.locator('main div.text-2xl.font-bold')
    await expect(rows).toHaveCount(50)
    await expect(page.getByText('107 records · Page 1 of 3',{exact:true})).toBeVisible()
    for(const [i,value] of ['107','105','1','1'].entries())await expect(metrics.nth(i)).toHaveText(value)
    const pageIds=[]
    for(let index=1;index<=3;index++){
      if(index>1)await page.getByRole('button',{name:'Next page',exact:true}).click()
      await expect(page.getByText(`107 records · Page ${index} of 3`,{exact:true})).toBeVisible()
      await expect(rows).toHaveCount(index===3?7:50)
      pageIds.push(...await rows.locator('td:nth-child(2)').allTextContents())
    }
    if(new Set(pageIds).size!==107)throw Error('Browser pages duplicated or missed references')
    stage='source and Saudi date filters'
    const typePicker=page.getByRole('combobox',{name:'Decision type',exact:true})
    await typePicker.click()
    await page.getByRole('option',{name:'Application',exact:true}).click()
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText(appReference)
    await expect(metrics.nth(0)).toHaveText('1')
    await typePicker.click()
    await page.getByRole('option',{name:'All types',exact:true}).click()
    await page.getByLabel('From date',{exact:true}).fill('2026-01-01')
    await expect(rows).toHaveCount(2)
    await expect(metrics.nth(0)).toHaveText('2')
    await page.getByLabel('From date',{exact:true}).fill('')
    await page.getByLabel('To date',{exact:true}).fill('2020-01-01')
    await expect(rows).toHaveCount(50)
    await expect(metrics.nth(0)).toHaveText('105')
    await page.getByLabel('To date',{exact:true}).fill('')
    await expect(metrics.nth(0)).toHaveText('107')
    stage='literal and hidden-field search; filtered KPIs'
    await search.fill(literal)
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText(literal)
    await expect(metrics.nth(0)).toHaveText('1')
    await expect(page.getByText('1 records · Page 1 of 1',{exact:true})).toBeVisible()
    await search.fill(`HiddenApplicant${tag}`)
    await expect(rows).toHaveCount(0)
    await expect(metrics.nth(0)).toHaveText('0')
    await search.fill(appReference)
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('H. S.')
    await expect(rows).not.toContainText('SecretSurname')
    stage='masked page export'
    const download=page.waitForEvent('download')
    await page.getByRole('button',{name:'Export this page',exact:true}).click()
    const file=await download,stream=await file.createReadStream(),chunks=[]
    for await(const chunk of stream)chunks.push(chunk)
    const csv=Buffer.concat(chunks).toString('utf8')
    if(!csv.includes(appReference)||!csv.includes('H. S.')||csv.includes(hiddenName)||csv.includes(phone)||!file.suggestedFilename().startsWith('approvals-page-1-'))throw Error('Page CSV privacy/scope incorrect')
    stage='read failure removes stale actions; explicit retry'
    const fail=async route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'text/plain',body:'Synthetic queue unavailable'}):route.continue()
    await page.route('**/approvals*',fail);patterns.push(fail)
    await page.getByRole('button',{name:'Refresh',exact:true}).click()
    const alert=page.getByRole('alert').filter({hasText:'Could not load the approvals queue'})
    await expect(alert).toBeVisible()
    await expect(rows).toHaveCount(0)
    await expect(metrics.nth(0)).toHaveText('—')
    await expect(page.getByRole('button',{name:'Export this page',exact:true})).toBeDisabled()
    await page.unroute('**/approvals*',fail)
    await alert.getByRole('button',{name:'Retry',exact:true}).click()
    await expect(rows).toHaveCount(1)
    stage='old successful response cannot replace a newer search'
    let held=false,freshHeld=false
    const stale=async route=>{
      const request=route.request(),body=request.postData()??''
      if(request.method()!=='POST'||(!body.includes(literal)&&!body.includes(appReference)))return route.continue()
      const response=await route.fetch()
      if(body.includes(literal)){
        held=true
        await new Promise(resolve=>{releaseStale=resolve})
      }else{
        freshHeld=true
        await new Promise(resolve=>{releaseFresh=resolve})
      }
      await route.fulfill({response})
    }
    await page.route('**/approvals*',stale);patterns.push(stale)
    await search.fill(literal)
    await expect.poll(()=>held).toBe(true)
    await search.fill(appReference)
    // Next.js dispatches Server Actions sequentially. Release the obsolete
    // result so the newer action starts, then hold that result independently.
    releaseStale()
    await expect.poll(()=>freshHeld).toBe(true)
    await expect(metrics.nth(0)).toHaveText('—')
    await expect(rows.filter({hasText:literal})).toHaveCount(0)
    releaseFresh()
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText(appReference)
    await page.unroute('**/approvals*',stale)
    stage='desktop and Arabic mobile'
    await page.screenshot({path:'supabase/.temp/approvals-inbox-desktop.png',fullPage:true})
    await page.setViewportSize({width:390,height:844})
    await page.goto(appUrl+'/approvals?lang=ar')
    await expect(page.locator('html')).toHaveAttribute('lang','ar')
    const mobileSearch=page.getByRole('textbox',{name:'بحث في المراجع والبيانات الظاهرة...',exact:true})
    await mobileSearch.fill(appReference)
    await expect(rows).toHaveCount(1)
    await expect(page.getByRole('button',{name:'موافقة',exact:true})).toBeVisible()
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Approvals mobile viewport overflow')
    const arDownload=page.waitForEvent('download')
    await page.getByRole('button',{name:'تصدير هذه الصفحة',exact:true}).click()
    const arStream=await (await arDownload).createReadStream(),arChunks=[]
    for await(const chunk of arStream)arChunks.push(chunk)
    if(!Buffer.concat(arChunks).toString('utf8').includes('عرض الاسم'))throw Error('Arabic export headers missing')
    await rows.first().scrollIntoViewIfNeeded()
    await expect.poll(()=>rows.first().evaluate(row=>{
      for(let element=row;element;element=element.parentElement)if(Number(getComputedStyle(element).opacity)<0.99)return false
      return true
    })).toBe(true)
    await page.screenshot({path:'supabase/.temp/approvals-inbox-mobile-ar.png',fullPage:true})
    await Promise.all(checks)
    if(wireViolation)throw Error('Application identity leaked in server-action response')
    console.log('PASS: approvals all-source pages beyond 100; exact filtered totals/literal search; applicant initials in wire/UI/CSV; read failure/retry; stale response ignored; Arabic mobile')
  }catch(error){
    console.error(JSON.stringify({check:'approvals boundary failure',stage,errorType:error.name,
      assertion:['toHaveCount','toBeVisible','toHaveText','toContainText','toBeDisabled','toBe'].find(kind=>error.message?.includes(kind)),
      callSite:error.stack?.split('\n').find(line=>line.includes('verify-local-approvals.mjs:'))?.trim()}))
    if(new URL(page.url()).pathname==='/approvals')await page.screenshot({path:'supabase/.temp/approvals-inbox-failure.png',fullPage:true}).catch(()=>{})
    const failure=Error(`Approvals verification failed at ${stage}`,{cause:error})
    failure.verificationStage=stage
    throw failure
  }
  finally{
    releaseStale?.();releaseFresh?.()
    for(const handler of patterns)await page.unroute('**/approvals*',handler).catch(()=>{})
    page.off('response',inspect)
    for(const [table,key,values] of [['expenses','id',ids],['driver_leave_requests','id',[leaveId]],['driver_applications','id',[appId]],['drivers','id',[driverId]]]){
      const removed=await admin.from(table).delete().eq('tenant_id',tenantId).in(key,values)
      if(removed.error){console.error(JSON.stringify({check:'approvals synthetic cleanup',table,code:removed.error.code}));throw Error('Owned approval fixture cleanup failed')}
    }
    if(createdLeaveType&&leaveTypeId){if((await admin.from('leave_types').delete().eq('tenant_id',tenantId).eq('id',leaveTypeId)).error)throw Error('Owned leave type cleanup failed')}
    await page.setViewportSize(initialViewport)
    await page.goto(appUrl+'/dashboard?lang='+(initialLocale==='ar'?'ar':'en'))
  }
}
