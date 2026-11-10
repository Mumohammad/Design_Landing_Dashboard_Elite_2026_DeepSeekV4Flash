import { expect as baseExpect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
const expect = baseExpect.configure({ timeout: 30_000 })

// Called only after MFA sign-in to a freshly provisioned synthetic tenant.
export async function verifyReceivableCrud(page, admin, tenantId, appUrl) {
  const app = new URL(appUrl), db = new URL(admin.supabaseUrl)
  const local = ['localhost','127.0.0.1'].includes(app.hostname) && ['3107','3108'].includes(app.port)
    && ['localhost','127.0.0.1'].includes(db.hostname) && db.port === '58321'
  if (!local) {
    if (db.origin !== 'https://viowrovartosrkqukjxy.supabase.co' || app.hostname === 'elite-dashboard-blush.vercel.app') throw Error('Isolated staging required')
    const policy = (await fetch(appUrl + '/landing')).headers.get('content-security-policy') ?? ''
    if (!policy.includes(db.origin) || policy.includes('wwfnsbilmyxeawgzicmv')) throw Error('Staging app/database isolation required')
  }
  if (!tenantId) throw Error('Synthetic tenant required')
  const reference = 'AR-RETRY-' + randomUUID().slice(0, 8)
  const locale = await page.locator('html').getAttribute('lang')
  const viewport = page.viewportSize()
  let id, intercepted = false, stage = 'open form'
  const pattern = '**/accounting'
  const loseResponse = async route => {
    if (!intercepted && route.request().method() === 'POST' && route.request().headers()['next-action'] && route.request().postData()?.includes(reference)) {
      intercepted = true
      const response = await route.fetch()
      if (!response.ok()) throw Error('Synthetic receivable action failed before transport fault')
      await route.abort('failed')
    } else await route.continue()
  }
  try {
    await page.goto(appUrl + '/accounting')
    await page.getByRole('tab', { name: /^(Receivables|الذمم المدينة)$/ }).click()
    await page.getByRole('button', { name: /^(New receivable|ذمة مدينة جديدة)$/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('#rcvRef').fill(reference)
    await dialog.locator('#rcvAmount').fill('4.10')
    await dialog.locator('#rcvVat').fill('15')
    await expect(dialog.getByTestId('receivable-preview')).toContainText('0.62')
    await expect(dialog.getByTestId('receivable-preview')).toContainText('4.72')
    stage = 'lost successful action response'
    await page.route(pattern, loseResponse)
    await dialog.getByRole('button', { name: /^(Save|حفظ)$/ }).click()
    await expect(dialog.getByRole('alert')).toContainText(/Retry with unchanged details|أعد المحاولة بالتفاصيل نفسها/)
    await page.unroute(pattern, loseResponse)
    if (!intercepted) throw Error('Transport fault was not exercised')
    const first = await admin.from('receivables').select('id,amount,vat_amount,total_amount,request_id').eq('tenant_id',tenantId).eq('invoice_ref',reference).single()
    if (first.error || !first.data || Number(first.data.amount)!==4.1 || Number(first.data.vat_amount)!==0.62 || Number(first.data.total_amount)!==4.72 || !first.data.request_id) throw Error('Committed synthetic receivable amounts/identity differ')
    id = first.data.id
    stage = 'retry with same form request identity'
    await dialog.getByRole('button', { name: /^(Save|حفظ)$/ }).click()
    await expect(dialog).not.toBeVisible()
    const persisted = await admin.from('receivables').select('id').eq('tenant_id',tenantId).eq('invoice_ref',reference)
    if (persisted.error || persisted.data?.length!==1 || persisted.data[0].id!==id) throw Error('Retry duplicated or replaced the receivable')
    const audit = await admin.from('audit_log').select('id').eq('tenant_id',tenantId).eq('entity_id',id).eq('action','receivable_created')
    if (audit.error || audit.data?.length!==1) throw Error('Retry duplicated or omitted audit evidence')
    stage = 'created receivable found through paged ledger search'
    await page.getByTestId('ledger-toolbar').getByRole('searchbox', { name: /^(Search ledger|بحث في السجل)$/, exact: true }).fill(reference)
    const row = page.getByRole('row').filter({ hasText: reference })
    await expect(row).toBeVisible()
    await expect(row).toContainText('4.72')
    stage = 'new intent and mobile'
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: /^(New receivable|ذمة مدينة جديدة)$/ }).click()
    await expect(dialog.locator('#rcvRef')).toHaveValue('')
    await expect(dialog.locator('#rcvAmount')).toHaveValue('')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(dialog.locator('fieldset')).toBeEnabled()
    await page.keyboard.press('Escape')
    await page.reload()
    await page.getByRole('tab', { name: /^(Receivables|الذمم المدينة)$/ }).click()
    await page.getByTestId('ledger-toolbar').getByRole('searchbox', { name: /^(Search ledger|بحث في السجل)$/, exact: true }).fill(reference)
    await expect(page.getByRole('row').filter({ hasText: reference })).toContainText('4.72')
    await expect(page.locator('html')).toHaveAttribute('lang',locale)
    console.log('PASS: manual receivable → exact VAT preview → committed response loss → unchanged-form retry → one record/audit → fresh form/mobile → persisted reload')
  } catch (error) { error.verificationStage = stage; throw error }
  finally {
    await page.unroute(pattern,loseResponse).catch(()=>{})
    if (viewport) await page.setViewportSize(viewport)
    if (id) {
      const retired = await admin.from('receivables').update({ deleted_at:new Date().toISOString() }).eq('tenant_id',tenantId).eq('id',id)
      if (retired.error) throw Error('Synthetic receivable retirement failed')
    }
  }
}
