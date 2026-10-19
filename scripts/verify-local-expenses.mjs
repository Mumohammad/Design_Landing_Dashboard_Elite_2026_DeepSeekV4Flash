import { expect as baseExpect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
const expect = baseExpect.configure({ timeout: 25_000 })

export async function verifyExpensesOverview(page, admin, tenantId, appUrl) {
  const app = new URL(appUrl), db = new URL(admin.supabaseUrl)
  const local = ['localhost','127.0.0.1'].includes(app.hostname) && ['3107','3108'].includes(app.port)
    && ['localhost','127.0.0.1'].includes(db.hostname) && db.port === '58321'
  if (!local) {
    if (db.origin !== 'https://viowrovartosrkqukjxy.supabase.co' || app.hostname === 'elite-dashboard-blush.vercel.app') throw Error('Isolated staging required')
    const policy = (await fetch(appUrl + '/landing')).headers.get('content-security-policy') ?? ''
    if (!policy.includes(db.origin) || policy.includes('wwfnsbilmyxeawgzicmv')) throw Error('Isolated app/database required')
  }
  if (!tenantId) throw Error('Synthetic tenant required')
  const locale = await page.locator('html').getAttribute('lang')
  const viewport = page.viewportSize(), tag = randomUUID().slice(0,8)
  const needle = `Needle "${tag},50%_`, createdVendor = 'Created-expense-' + tag
  const ids = Array.from({length:106},()=>randomUUID()), drivers = [randomUUID(),randomUUID()]
  const pattern = '**/rest/v1/expenses?**'
  const actionPattern='**/expenses*'
  let responseLost=false
  const loseResponse=async route=>{
    const request=route.request()
    if(!responseLost&&request.method()==='POST'&&new URL(request.url()).pathname==='/expenses'
      &&request.headers()['next-action']&&request.postData()?.includes(createdVendor)){
      responseLost=true
      const response=await route.fetch()
      if(!response.ok())throw Error('Expense action failed before response-loss injection')
      await route.abort('failed')
    }else await route.continue()
  }
  let stage = 'fixtures'
  try {
    const driverRows = drivers.map((id,i)=>({id,tenant_id:tenantId,full_name_ar:i===0?`Normal ${tag}`:`Driver ${needle}`,full_name_en:i===0?`Normal ${tag}`:`Driver ${needle}`,primary_mobile:'+966500000000',category:'freelancer',status:'active'}))
    if ((await admin.from('drivers').insert(driverRows)).error) throw Error('Synthetic drivers failed')
    const seeded = await admin.from('expenses').insert(ids.map((id,i)=>({
      id,tenant_id:tenantId,expense_type:'fuel',amount:i===105?0.2:0.1,currency:'SAR',is_approved:false,vat_rate:15,vat_amount:0,
      expense_date:i>=100?'2020-01-01':'2026-10-19',vendor:i===105?needle:i===103?`Unassigned ${needle}`:`Expense ${tag} ${i}`,
      driver_id:i===104?drivers[1]:i===105?drivers[0]:null,
    })))
    if (seeded.error) throw Error('Synthetic expenses failed')
    stage = 'pages and global exact totals'
    await page.goto(appUrl + '/expenses?lang=en')
    const rows = page.locator('tbody tr'), search = page.getByRole('textbox').first()
    const metrics = page.locator('main div.text-2xl.font-bold')
    await expect(rows).toHaveCount(25)
    await expect(page.getByText('106 records · Page 1 of 5',{exact:true})).toBeVisible()
    await expect(metrics.nth(0)).toHaveText('106')
    await expect(metrics.nth(1)).toHaveText('106')
    await expect(metrics.nth(2)).toHaveText('10.70')
    await expect(metrics.nth(3)).toHaveText('0.00')
    await page.getByRole('button',{name:'Next page',exact:true}).click()
    await expect(page.getByText('106 records · Page 2 of 5',{exact:true})).toBeVisible()
    stage = 'full literal OR search beyond old cap'
    await search.fill(needle)
    await expect(rows).toHaveCount(3)
    await expect(page.getByText('3 records · Page 1 of 1',{exact:true})).toBeVisible()
    await expect(rows.filter({hasText:`Normal ${tag}`})).toContainText(needle)
    await expect(rows.filter({hasText:`Driver ${needle}`})).toHaveCount(1)
    await expect(rows.filter({hasText:`Unassigned ${needle}`})).toHaveCount(1)
    await expect(metrics.nth(0)).toHaveText('106')
    await expect(metrics.nth(2)).toHaveText('10.70')
    stage = 'table failure and retry'
    const failList = route => new URL(route.request().url()).searchParams.get('select')?.includes('driver:')
      ? route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic read unavailable"}'}) : route.continue()
    await page.route(pattern,failList)
    await search.fill('changed-' + tag)
    await expect(page.getByText('Could not load expenses, their totals or account mappings. Try again.',{exact:true})).toBeVisible()
    await expect(page.getByTestId('module-empty-state')).toHaveCount(0)
    await page.unroute(pattern,failList)
    await page.getByRole('button',{name:/^(Retry|Try again)$/}).click()
    await expect(page.getByTestId('module-empty-state')).toBeVisible()
    stage = 'failed summary stays unknown and recovers'
    const failSummary = route => new URL(route.request().url()).searchParams.get('select') === 'id,amount,vat_amount,currency,is_approved'
      ? route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic summary unavailable"}'}) : route.continue()
    await page.route(pattern,failSummary)
    await page.reload()
    await expect(page.getByText('Could not load expenses, their totals or account mappings. Try again.',{exact:true})).toBeVisible()
    await expect(metrics.nth(2)).toHaveText('—')
    await page.unroute(pattern,failSummary)
    await page.getByRole('button',{name:/^(Retry|Try again)$/}).click()
    await expect(metrics.nth(2)).toHaveText('10.70')
    stage = 'dependency failure and recovery'
    const dependencyPattern = '**/rest/v1/expense_category_mappings?**'
    const failDependency = route => route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic mapping unavailable"}'})
    await page.route(dependencyPattern,failDependency)
    await page.reload()
    await expect(page.getByText('Could not load expenses, their totals or account mappings. Try again.',{exact:true})).toBeVisible()
    await page.unroute(dependencyPattern,failDependency)
    await page.getByRole('button',{name:/^(Retry|Try again)$/}).click()
    await expect(rows).toHaveCount(25)
    stage = 'expense commit with lost successful response'
    await page.getByRole('button',{name:'New expense',exact:true}).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('#exp-amount').fill('1.23')
    await dialog.locator('#exp-vendor').fill(createdVendor)
    await page.route(actionPattern,loseResponse)
    await dialog.getByRole('button',{name:'Save expense',exact:true}).click()
    await expect(dialog.getByRole('alert')).toContainText('Retry with unchanged details')
    await page.unroute(actionPattern,loseResponse)
    if(!responseLost)throw Error('Expense response loss was not exercised')
    const first=await admin.from('expenses').select('id,amount,request_id').eq('tenant_id',tenantId).eq('vendor',createdVendor).single()
    if(first.error||!first.data?.request_id||Number(first.data.amount)!==1.23)throw Error('Expense did not commit before transport fault')
    stage = 'same-form retry refreshes once'
    await dialog.getByRole('button',{name:'Save expense',exact:true}).click()
    await expect(dialog).toBeHidden()
    await expect(metrics.nth(0)).toHaveText('107')
    await expect(metrics.nth(2)).toHaveText('11.93')
    await search.fill(createdVendor)
    await expect(rows).toHaveCount(1)
    const created = await admin.from('expenses').select('id,is_approved,amount').eq('tenant_id',tenantId).eq('vendor',createdVendor).single()
    if (created.error || created.data.id!==first.data.id || created.data.is_approved || Number(created.data.amount)!==1.23) throw Error('Created expense persistence differs')
    const audit=await admin.from('audit_log').select('id').eq('tenant_id',tenantId).eq('entity_id',created.data.id).eq('action','expense_created')
    if(audit.error||audit.data?.length!==1)throw Error('Expense retry duplicated or omitted audit')
    await page.getByRole('button',{name:'New expense',exact:true}).click()
    await expect(dialog.locator('#exp-amount')).toHaveValue('')
    await expect(dialog.locator('#exp-vendor')).toHaveValue('')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(dialog.locator('fieldset')).toBeEnabled()
    await page.keyboard.press('Escape')
    stage = 'desktop and Arabic mobile rendering'
    await page.screenshot({path:'supabase/.temp/expenses-overview-desktop.png',fullPage:true})
    await page.setViewportSize({width:390,height:844})
    await page.goto(appUrl + '/expenses?lang=ar')
    await expect(page.locator('html')).toHaveAttribute('lang','ar')
    await expect(rows).toHaveCount(25)
    await expect(metrics.nth(0)).toHaveText('107')
    await expect(page.getByRole('button',{name:'الصفحة التالية',exact:true})).toBeVisible()
    // Playwright visibility includes opacity:0. Wait for the reveal ancestors,
    // including the table below the mobile fold, before accepting a capture.
    const revealed = locator => expect.poll(() => locator.evaluate(element => {
      for (let node=element;node;node=node.parentElement) {
        if (Number(getComputedStyle(node).opacity)<0.99) return false
      }
      return true
    })).toBe(true)
    await rows.first().scrollIntoViewIfNeeded()
    await revealed(rows.first())
    const heading = page.getByRole('heading',{name:'المصروفات',exact:true})
    await heading.scrollIntoViewIfNeeded()
    await revealed(heading)
    if (!(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))) throw Error('Expense viewport overflows')
    await page.screenshot({path:'supabase/.temp/expenses-overview-mobile-ar.png',fullPage:true})
    console.log('PASS: expenses beyond 100 rows; exact full summary, literal document/driver/unassigned search, pagination, read failure recovery, lost-response retry with one record/audit, fresh form and Arabic mobile')
  } catch (error) {
    console.error(JSON.stringify({check:'expenses overview',stage,errorType:error.name}))
    await page.screenshot({path:'supabase/.temp/expenses-overview-failure.png',fullPage:true}).catch(()=>{})
    throw Error('Expense overview verification failed: ' + stage)
  } finally {
    await page.unrouteAll({behavior:'ignoreErrors'})
    const retired = await admin.from('expenses').update({deleted_at:new Date().toISOString()}).eq('tenant_id',tenantId).eq('vendor',createdVendor)
    const removed = await admin.from('expenses').delete().eq('tenant_id',tenantId).in('id',ids)
    const removedDrivers = await admin.from('drivers').delete().eq('tenant_id',tenantId).in('id',drivers)
    if (retired.error || removed.error || removedDrivers.error) throw Error('Synthetic expense cleanup failed')
    if (viewport) await page.setViewportSize(viewport)
    await page.goto(appUrl + '/dashboard?lang=' + locale)
  }
}
