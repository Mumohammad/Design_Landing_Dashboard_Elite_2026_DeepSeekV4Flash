import { expect as baseExpect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { assertModuleTestTarget } from './assert-module-test-target.mjs'
const expect=baseExpect.configure({timeout:25_000})
export async function verifyExpenseCorrections(page,admin,tenantId,appUrl){
 await assertModuleTestTarget(page,admin.supabaseUrl,appUrl)
 if(!tenantId)throw Error('Synthetic tenant required')
 const vendor='Correction-'+randomUUID().slice(0,8),attachment='synthetic-private-receipt-reference'
 const dialog=page.getByRole('dialog'),rows=page.locator('tbody tr')
 let lastWrite=0
 const write=async button=>{const wait=6200-(Date.now()-lastWrite);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));lastWrite=Date.now();await button.click()}
 await page.goto(appUrl+'/expenses?lang=en')
 await page.getByRole('button',{name:'New expense',exact:true}).click()
 await dialog.locator('#exp-amount').fill('10');await dialog.locator('#exp-vendor').fill(vendor)
 await write(dialog.getByRole('button',{name:'Save expense',exact:true}));await expect(dialog).toBeHidden()
 const seeded=await admin.from('expenses').select('id,created_by,correction_version').eq('tenant_id',tenantId).eq('vendor',vendor).single()
 if(seeded.error||!seeded.data?.created_by)throw Error('Caller-created correction fixture unavailable')
 const id=seeded.data.id
 const attached=await admin.from('expenses').update({receipt_url:attachment}).eq('tenant_id',tenantId).eq('id',id)
 if(attached.error)throw Error('Synthetic receipt fixture failed')
 await page.reload();await page.getByRole('textbox').first().fill(vendor);await expect(rows).toHaveCount(1)
 const stale=await page.context().newPage()
 try{
  await stale.goto(appUrl+'/expenses?lang=en');await stale.getByRole('textbox').first().fill(vendor)
  await stale.locator('tbody tr').getByRole('button',{name:'Approve expense',exact:true}).click()
  await rows.getByRole('button',{name:'Edit expense',exact:true}).click()
  await expect(dialog.locator('#exp-amount')).toHaveValue('10');await dialog.locator('#exp-amount').fill('12.34')
  await dialog.locator('#exp-vat').fill('0');await dialog.locator('#exp-change-reason').fill('Corrected the synthetic receipt amount')
  let lost=false
  const lose=async route=>{const req=route.request();if(!lost&&req.method()==='POST'&&req.headers()['next-action']&&req.postData()?.includes(id)){lost=true;const res=await route.fetch();if(!res.ok())throw Error('Correction action failed before simulated response loss');await route.abort('failed')}else await route.continue()}
  await page.route('**/expenses*',lose)
  await write(dialog.getByRole('button',{name:'Save expense',exact:true}));await expect(dialog.getByRole('alert')).toContainText('Retry with unchanged details')
  await page.unroute('**/expenses*',lose);if(!lost)throw Error('Correction response loss was not exercised')
  await write(dialog.getByRole('button',{name:'Save expense',exact:true}));await expect(dialog).toBeHidden()
  const edited=await admin.from('expenses').select('amount,vat_rate,receipt_url,correction_version').eq('tenant_id',tenantId).eq('id',id).single()
  if(edited.error||Number(edited.data.amount)!==12.34||Number(edited.data.vat_rate)!==0||edited.data.receipt_url!==attachment||edited.data.correction_version!==seeded.data.correction_version+2)throw Error('Correction/replay/receipt persistence differs')
  await write(stale.getByRole('dialog').getByRole('button',{name:'Approve',exact:true}))
  await expect(stale.getByRole('dialog').getByRole('alert')).toContainText('changed')
  await rows.getByRole('button',{name:'Cancel expense',exact:true}).click()
  await dialog.locator('#exp-cancel-reason').fill('Withdrew a duplicate synthetic receipt')
  await write(dialog.getByRole('button',{name:'Confirm expense cancellation',exact:true}));await expect(dialog).toBeHidden()
  await expect(rows.getByText('Cancelled',{exact:true})).toBeVisible();await expect(rows.getByRole('button')).toHaveCount(0)
  const saved=await admin.from('expenses').select('is_approved,rejected_at,cancelled_at,cancelled_by,cancellation_reason,receipt_url').eq('tenant_id',tenantId).eq('id',id).single()
  const ap=await admin.from('payables').select('id').eq('tenant_id',tenantId).eq('source_entity_id',id)
  const events=await admin.from('financial_events').select('id').eq('tenant_id',tenantId).eq('source_id',id)
  const audit=await admin.from('audit_log').select('action').eq('tenant_id',tenantId).eq('entity_id',id).in('action',['expense_pending_updated','expense_cancelled'])
  if([saved,ap,events,audit].some(r=>r.error)||saved.data.is_approved||saved.data.rejected_at||!saved.data.cancelled_at||saved.data.cancelled_by!==seeded.data.created_by||saved.data.receipt_url!==attachment||ap.data.length||events.data.length||audit.data.length!==2)throw Error('Cancellation generated financial effects or lost durable history')
  await page.goto(appUrl+'/approvals?lang=en');await page.getByRole('textbox').first().fill(vendor);await expect(page.locator('tbody tr').filter({hasText:vendor})).toHaveCount(0)
  await page.goto(appUrl+'/expenses?lang=ar');await page.getByRole('textbox').first().fill(vendor);await expect(rows.getByText('ملغى',{exact:true})).toBeVisible()
  await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  console.log(JSON.stringify({check:'expense maker correction, response-loss replay, stale approval, cancellation, receipt/audit preservation, Arabic mobile',result:'PASS'}))
 }finally{await stale.close();await page.unrouteAll({behavior:'ignoreErrors'})}
 // Keep final source/audit evidence in the isolated synthetic tenant.
}
