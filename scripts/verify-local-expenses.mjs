import { expect as baseExpect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
const expect = baseExpect.configure({ timeout: 25_000 })

async function verifyTextContrast(locator) {
  const ratio=await locator.evaluate(element=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1
    const context=canvas.getContext('2d',{willReadFrequently:true})
    const rgba=value=>{context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data]}
    const blend=(top,bottom)=>top.slice(0,3).map((value,i)=>value*top[3]/255+bottom[i]*(1-top[3]/255))
    const ancestors=[];for(let node=element;node;node=node.parentElement)ancestors.unshift(node)
    let background=[255,255,255]
    for(const node of ancestors)background=blend(rgba(getComputedStyle(node).backgroundColor),background)
    const foreground=blend(rgba(getComputedStyle(element).color),background)
    const luminance=rgb=>rgb.map(value=>{const c=value/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4}).reduce((sum,value,i)=>sum+value*[0.2126,0.7152,0.0722][i],0)
    const a=luminance(foreground),b=luminance(background)
    return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)
  })
  if(ratio<4.5)throw Error('Decision text contrast is below 4.5:1')
}

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
  const managedVendors=[createdVendor]
  const ids = Array.from({length:106},()=>randomUUID()), drivers = [randomUUID(),randomUUID()]
  const pattern = '**/rest/v1/expenses?**'
  const actionPattern='**/expenses*'
  let responseLost=false,approvalResponseLost=false
  const retainedSeeds=[]
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
    const defaults=await admin.from('expense_category_mappings').select('expense_type,coa_account_code').eq('tenant_id',tenantId)
    if(defaults.error||defaults.data?.length!==6)throw Error('Provisioned company lacks complete expense accounting defaults')
    const chart=await admin.from('chart_of_accounts').select('id,account_code').eq('tenant_id',tenantId).is('deleted_at',null)
    if(chart.error||!defaults.data.every(mapping=>chart.data.some(account=>account.account_code===mapping.coa_account_code)))
      throw Error('Provisioned company expense mappings do not resolve to real accounts')
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
    await expect(page.locator('section[aria-live="polite"]')).toHaveAttribute('aria-label',/^Notifications /)
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
    const failSummary = route => new URL(route.request().url()).searchParams.get('select') === 'id,amount,vat_amount,currency,is_approved,rejected_at'
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
    stage = 'open approval for the created expense'
    await rows.getByRole('button',{name:'Approve expense',exact:true}).click()
    stage = 'approval preview VAT'
    await expect(dialog.getByTestId('expense-approval-preview')).toContainText('0.18')
    stage = 'approval preview total'
    await expect(dialog.getByTestId('expense-approval-preview')).toContainText('1.41')
    const loseApproval=async route=>{
      const request=route.request()
      if(!approvalResponseLost&&request.method()==='POST'&&new URL(request.url()).pathname==='/expenses'
        &&request.headers()['next-action']&&request.postData()?.includes(created.data.id)){
        approvalResponseLost=true
        const response=await route.fetch()
        if(!response.ok())throw Error('Approval failed before response-loss injection')
        await route.abort('failed')
      }else await route.continue()
    }
    await page.route(actionPattern,loseApproval)
    stage = 'submit approval with committed-response loss'
    await dialog.getByRole('button',{name:'Approve',exact:true}).click()
    stage = 'approval uncertainty alert'
    await expect(dialog.getByRole('alert')).toContainText('Unable to confirm')
    await page.unroute(actionPattern,loseApproval)
    if(!approvalResponseLost)throw Error('Approval response loss was not exercised')
    stage = 'approval retry resolves the existing decision'
    await dialog.getByRole('button',{name:'Approve',exact:true}).click()
    await expect(dialog).toBeHidden()
    await expect(rows.getByRole('button',{name:'Approve expense',exact:true})).toHaveCount(0)
    const verifyPosting=async(id,net,vat,total,surface,reason,classification='recoverable')=>{
      const expense=await admin.from('expenses').select('is_approved,amount,vat_rate,vat_amount,vat_recoverability,coa_account_code').eq('tenant_id',tenantId).eq('id',id).single()
      const ap=await admin.from('payables').select('amount,vat_amount,total_amount').eq('tenant_id',tenantId).eq('source_entity_type','expense').eq('source_entity_id',id).is('deleted_at',null)
      const events=await admin.from('financial_events').select('event_id,processing_status').eq('tenant_id',tenantId).eq('source_type','expense').eq('source_id',id)
      const audit=await admin.from('audit_log').select('new_values').eq('tenant_id',tenantId).eq('entity_id',id).eq('action','expense_approved')
      const entries=await admin.from('journal_entries').select('id,status').eq('tenant_id',tenantId).eq('source_entity_type','expense').eq('source_entity_id',id)
      const ledger=await admin.from('vat_input_ledger').select('vat_base_amount,vat_rate,vat_amount,vat_recoverability').eq('tenant_id',tenantId).eq('source_entity_type','expense').eq('source_entity_id',id)
      if([expense,ap,events,audit,entries,ledger].some(r=>r.error)||!expense.data?.is_approved
        ||Number(expense.data.amount)!==net||Number(expense.data.vat_amount)!==vat||expense.data.vat_recoverability!==classification
        ||ap.data?.length!==1||Number(ap.data[0].amount)!==net||Number(ap.data[0].vat_amount)!==vat||Number(ap.data[0].total_amount)!==total
        ||events.data?.length!==1||events.data[0].processing_status!=='processed'
        ||audit.data?.length!==1||audit.data[0].new_values.surface!==surface||audit.data[0].new_values.reason!==reason
        ||entries.data?.length!==1||entries.data[0].status!=='posted'
        ||ledger.data?.length!==1||Number(ledger.data[0].vat_base_amount)!==net||Number(ledger.data[0].vat_amount)!==vat||ledger.data[0].vat_recoverability!==classification)
        throw Error('Approval accounting evidence differs')
      const lines=await admin.from('journal_entry_lines').select('account_id,debit_amount,credit_amount').eq('tenant_id',tenantId).eq('journal_entry_id',entries.data[0].id)
      if(lines.error||lines.data?.length!==(classification==='recoverable'&&vat>0?3:2))throw Error('Approval journal lines missing')
      const debit=lines.data.reduce((sum,line)=>sum+Math.round(Number(line.debit_amount)*100),0)
      const credit=lines.data.reduce((sum,line)=>sum+Math.round(Number(line.credit_amount)*100),0)
      if(debit!==Math.round(total*100)||credit!==debit)throw Error('Approval journal does not balance')
      const debitFor=code=>lines.data.filter(line=>chart.data.find(account=>account.id===line.account_id)?.account_code===code)
        .reduce((sum,line)=>sum+Math.round(Number(line.debit_amount)*100),0)
      if(debitFor('2600')!==Math.round((classification==='recoverable'?vat:0)*100)
        ||debitFor(expense.data.coa_account_code)!==Math.round((classification==='recoverable'?net:total)*100)
        ||lines.data.some(line=>(Number(line.debit_amount)>0)===(Number(line.credit_amount)>0)))throw Error('Approval VAT classification or journal sides differ')
    }
    stage = 'approval persisted accounting evidence'
    await verifyPosting(created.data.id,1.23,0.18,1.41,'expenses',null)
    stage = 'approvals inbox shares atomic reason and verified posting'
    // The current inbox is oldest-first and capped. Put this owned synthetic
    // row first; this test does not claim the inbox's unfinished search works.
    const inbox=await admin.from('expenses').update({created_at:'2000-01-01T00:00:00Z'}).eq('tenant_id',tenantId).eq('id',ids[0]).select('expense_code').single()
    if(inbox.error||!inbox.data?.expense_code)throw Error('Inbox fixture unavailable')
    await page.goto(appUrl+'/approvals?lang=en')
    const inboxRow=page.locator('tbody tr').filter({hasText:inbox.data.expense_code})
    await inboxRow.getByRole('button',{name:'Approve',exact:true}).click()
    await dialog.locator('#decision-reason').fill('Receipts checked')
    // Retain this synthetic financial source even if the assertion after the
    // click fails; hard deletion must not orphan its accounting evidence.
    retainedSeeds.push(ids[0])
    await dialog.getByRole('button',{name:'Confirm approval',exact:true}).click()
    await expect(dialog).toBeHidden()
    await expect(inboxRow).toHaveCount(0)
    await expect(page.locator('tbody tr')).toHaveCount(50)
    await verifyPosting(ids[0],0.1,0.02,0.12,'approvals_inbox','Receipts checked')
    await page.goto(appUrl+'/expenses?lang=en')
    await expect(metrics.nth(0)).toHaveText('107')
    await expect(metrics.nth(1)).toHaveText('105')
    await expect(metrics.nth(3)).toHaveText('0.20')
    for(const test of [
      {name:'zero',type:'fuel',rate:0,vat:0,total:100,classification:'recoverable'},
      {name:'nonrecoverable',type:'advance',rate:15,vat:15,total:115,classification:'non_recoverable'},
      {name:'review',type:'other',rate:15,vat:15,total:115,classification:'pending_review'},
    ]){
      stage='create and approve '+test.name+' VAT expense'
      const vendor=`Posting-${test.name}-${tag}`;managedVendors.push(vendor)
      await page.getByRole('button',{name:'New expense',exact:true}).click()
      await dialog.locator('#exp-type').selectOption(test.type)
      await dialog.locator('#exp-amount').fill('100')
      await dialog.locator('#exp-vat').fill(String(test.rate))
      await dialog.locator('#exp-vendor').fill(vendor)
      await dialog.getByRole('button',{name:'Save expense',exact:true}).click()
      await expect(dialog).toBeHidden()
      await search.fill(vendor);await expect(rows).toHaveCount(1)
      await rows.getByRole('button',{name:'Approve expense',exact:true}).click()
      await expect(dialog.locator('#exp-vat-rate')).toHaveValue(String(test.rate))
      await expect(dialog.locator('#exp-recover')).toHaveValue(test.classification)
      await dialog.getByRole('button',{name:'Approve',exact:true}).click()
      await expect(dialog).toBeHidden()
      const persisted=await admin.from('expenses').select('id').eq('tenant_id',tenantId).eq('vendor',vendor).single()
      if(persisted.error)throw Error('VAT expense persistence unavailable')
      await verifyPosting(persisted.data.id,100,test.vat,test.total,'expenses',null,test.classification)
    }
    stage='rejection commit with lost response and safe retry'
    const rejection=await admin.from('expenses').update({created_at:'2000-01-01T00:00:01Z'}).eq('tenant_id',tenantId).eq('id',ids[1]).select('expense_code').single()
    if(rejection.error)throw Error('Rejection fixture unavailable')
    await page.goto(appUrl+'/approvals?lang=en')
    const rejectRow=page.locator('tbody tr').filter({hasText:rejection.data.expense_code})
    await rejectRow.getByRole('button',{name:'Reject',exact:true}).click()
    await dialog.locator('#decision-reason').fill('Duplicate receipt')
    retainedSeeds.push(ids[1])
    let rejectionResponseLost=false
    const rejectionPattern='**/approvals*'
    const loseRejection=async route=>{
      const request=route.request()
      if(!rejectionResponseLost&&request.method()==='POST'&&new URL(request.url()).pathname==='/approvals'
        &&request.headers()['next-action']&&request.postData()?.includes(ids[1])){
        rejectionResponseLost=true;const response=await route.fetch()
        if(!response.ok())throw Error('Rejection failed before response-loss injection')
        await route.abort('failed')
      }else await route.continue()
    }
    await page.route(rejectionPattern,loseRejection)
    await dialog.getByRole('button',{name:'Confirm rejection',exact:true}).click()
    stage='persistent rejection uncertainty alert'
    await expect(dialog.getByRole('alert')).toHaveText('Unable to confirm the decision. Reload and review before retrying.')
    await expect(dialog.getByRole('alert')).toBeVisible()
    await verifyTextContrast(dialog.getByRole('alert'))
    await verifyTextContrast(dialog.getByRole('button',{name:'Confirm rejection',exact:true}))
    await page.screenshot({path:'supabase/.temp/expense-rejection-uncertainty.png'})
    await page.unroute(rejectionPattern,loseRejection)
    if(!rejectionResponseLost)throw Error('Rejection response loss was not exercised')
    await dialog.getByRole('button',{name:'Confirm rejection',exact:true}).click()
    await expect(dialog).toBeHidden();await expect(rejectRow).toHaveCount(0)
    await expect(page.locator('[data-sonner-toast]').filter({hasText:'This decision was already made. Review the refreshed list.'})).toBeVisible()
    await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('dir','ltr')
    await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('data-x-position','right')
    await expect(page.locator('tbody tr')).toHaveCount(50)
    const decision=await admin.from('expenses').select('is_approved,rejected_at,rejected_by,rejection_reason').eq('tenant_id',tenantId).eq('id',ids[1]).single()
    const rejectAudit=await admin.from('audit_log').select('actor_id,new_values').eq('tenant_id',tenantId).eq('entity_id',ids[1]).eq('action','expense_rejected')
    if(decision.error||decision.data.is_approved||!decision.data.rejected_at||!decision.data.rejected_by||decision.data.rejection_reason!=='Duplicate receipt'
      ||rejectAudit.error||rejectAudit.data?.length!==1||rejectAudit.data[0].actor_id!==decision.data.rejected_by||rejectAudit.data[0].new_values.reason!=='Duplicate receipt')throw Error('Rejected decision/audit differs')
    const noFinancialEffects=async id=>{
      const ap=await admin.from('payables').select('id').eq('tenant_id',tenantId).eq('source_entity_type','expense').eq('source_entity_id',id)
      const events=await admin.from('financial_events').select('id').eq('tenant_id',tenantId).eq('source_type','expense').eq('source_id',id)
      const entries=await admin.from('journal_entries').select('id').eq('tenant_id',tenantId).eq('source_entity_type','expense').eq('source_entity_id',id)
      if([ap,events,entries].some(result=>result.error||result.data?.length!==0))throw Error('Rejection generated financial effects')
    }
    await noFinancialEffects(ids[1])
    await page.goto(appUrl+'/expenses?lang=en');await search.fill(rejection.data.expense_code)
    await expect(rows).toHaveCount(1)
    await expect(rows.getByText('Rejected',{exact:true})).toBeVisible()
    await verifyTextContrast(rows.getByText('Rejected',{exact:true}))
    await rows.locator('summary').click()
    await expect(rows.getByText('Duplicate receipt',{exact:true})).toBeVisible()
    await expect(rows.getByRole('button',{name:'Approve expense',exact:true})).toHaveCount(0)
    await page.screenshot({path:'supabase/.temp/expense-rejection-desktop.png',fullPage:true})
    stage='stale approval cannot overwrite a newer rejection'
    const stale=await admin.from('expenses').select('expense_code').eq('tenant_id',tenantId).eq('id',ids[2]).single()
    if(stale.error)throw Error('Stale approval fixture unavailable')
    await search.fill(stale.data.expense_code);await expect(rows).toHaveCount(1)
    await rows.getByRole('button',{name:'Approve expense',exact:true}).click()
    retainedSeeds.push(ids[2])
    const otherDecision=await admin.rpc('reject_expense_atomic',{p_tenant_id:tenantId,p_expense_id:ids[2],p_reason:'Reviewed elsewhere before approval',p_actor:decision.data.rejected_by})
    if(otherDecision.error)throw Error('Competing rejection failed')
    await dialog.getByRole('button',{name:'Approve',exact:true}).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('This expense was already rejected. Review the refreshed decision.',{exact:true})).toBeVisible()
    await expect(rows.getByText('Rejected',{exact:true})).toBeVisible()
    await noFinancialEffects(ids[2])
    await expect(metrics.nth(0)).toHaveText('110')
    await expect(metrics.nth(1)).toHaveText('103')
    await expect(metrics.nth(2)).toHaveText('311.93')
    await expect(metrics.nth(3)).toHaveText('30.20')
    await search.fill(createdVendor)
    await expect(rows).toHaveCount(1)
    stage = 'desktop and Arabic mobile rendering'
    await page.screenshot({path:'supabase/.temp/expenses-overview-desktop.png',fullPage:true})
    await page.setViewportSize({width:390,height:844})
    stage='Arabic mobile stale inbox decision and actual notification'
    const arabicStale=await admin.from('expenses').update({created_at:'2000-01-01T00:00:02Z'}).eq('tenant_id',tenantId).eq('id',ids[3]).select('expense_code').single()
    if(arabicStale.error)throw Error('Arabic stale-decision fixture unavailable')
    await page.goto(appUrl+'/approvals?lang=ar')
    const arabicQueueRow=page.locator('tbody tr').filter({hasText:arabicStale.data.expense_code})
    await arabicQueueRow.getByRole('button',{name:'موافقة',exact:true}).click()
    await dialog.locator('#decision-reason').fill('Reviewed before another decision')
    retainedSeeds.push(ids[3])
    const arabicDecision=await admin.rpc('reject_expense_atomic',{p_tenant_id:tenantId,p_expense_id:ids[3],p_reason:'Duplicate Arabic review fixture',p_actor:decision.data.rejected_by})
    if(arabicDecision.error)throw Error('Arabic competing rejection failed')
    await dialog.getByRole('button',{name:'تأكيد الموافقة',exact:true}).click()
    await expect(dialog).toBeHidden();await expect(arabicQueueRow).toHaveCount(0)
    await expect(page.locator('[data-sonner-toast]').filter({hasText:'تم اتخاذ القرار مسبقاً. راجع القائمة بعد تحديثها.'})).toBeVisible()
    await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('dir','rtl')
    await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('data-x-position','left')
    await expect(page.locator('section[aria-live="polite"]')).toHaveAttribute('aria-label',/^الإشعارات /)
    await noFinancialEffects(ids[3])
    stage='Arabic mobile expense rendering'
    await page.goto(appUrl + '/expenses?lang=ar')
    await expect(page.locator('html')).toHaveAttribute('lang','ar')
    await expect(page.locator('section[aria-live="polite"]')).toHaveAttribute('aria-label',/^الإشعارات /)
    await expect(rows).toHaveCount(25)
    await expect(metrics.nth(0)).toHaveText('110')
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
    await search.fill(rejection.data.expense_code);await expect(rows).toHaveCount(1)
    await rows.getByText('مرفوض',{exact:true}).scrollIntoViewIfNeeded()
    await verifyTextContrast(rows.getByText('مرفوض',{exact:true}))
    await rows.locator('summary').click()
    await expect(rows.getByText('Duplicate receipt',{exact:true})).toBeVisible()
    if(!(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)))throw Error('Rejected expense viewport overflows')
    await page.screenshot({path:'supabase/.temp/expense-rejection-mobile-ar.png',fullPage:true})
    console.log('PASS: expenses beyond 100 rows; exact summary/search/pagination/read recovery; creation/approval/rejection lost-response retries; one decision/audit and matching financial effects; rejected queue exit and stale approval protection; VAT classifications/balanced postings; Arabic mobile')
  } catch (error) {
    const operation=/expect\(locator\)\.[A-Za-z]+/.exec(error.message)?.[0]
      ??(/strict mode violation/.test(error.message)?'ambiguous-locator':undefined)
    console.error(JSON.stringify({check:'expenses overview',stage,errorType:error.name,operation}))
    await page.screenshot({path:'supabase/.temp/expenses-overview-failure.png',fullPage:true}).catch(()=>{})
    throw Error('Expense overview verification failed: ' + stage)
  } finally {
    await page.unrouteAll({behavior:'ignoreErrors'})
    const retired = await admin.from('expenses').update({deleted_at:new Date().toISOString()}).eq('tenant_id',tenantId).in('vendor',managedVendors)
    const retiredSeeds = retainedSeeds.length ? await admin.from('expenses').update({deleted_at:new Date().toISOString()}).eq('tenant_id',tenantId).in('id',retainedSeeds) : {error:null}
    const removed = await admin.from('expenses').delete().eq('tenant_id',tenantId).in('id',ids.filter(id=>!retainedSeeds.includes(id)))
    const removedDrivers = await admin.from('drivers').delete().eq('tenant_id',tenantId).in('id',drivers)
    if (retired.error || retiredSeeds.error || removed.error || removedDrivers.error) throw Error('Synthetic expense cleanup failed')
    if (viewport) await page.setViewportSize(viewport)
    await page.goto(appUrl + '/dashboard?lang=' + locale)
  }
}
