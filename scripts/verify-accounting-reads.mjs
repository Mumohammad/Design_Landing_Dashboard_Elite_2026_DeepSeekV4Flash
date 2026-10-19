import { expect as baseExpect } from '@playwright/test'
const expect = baseExpect.configure({ timeout: 20_000 })

// Read-only fault injection. The caller supplies an authenticated disposable
// tenant; neither failures nor recovery mutate financial documents.
export async function verifyAccountingReads(page, appUrl) {
  const origin = new URL(appUrl).origin
  const policy = (await fetch(`${origin}/landing`)).headers.get('content-security-policy') ?? ''
  const isolated = policy.includes('https://viowrovartosrkqukjxy.supabase.co') ||
    (['http://localhost:3107', 'http://localhost:3108'].includes(origin) && ['http://127.0.0.1:58321', 'http://localhost:58321'].some(url => policy.includes(url)))
  if (!isolated || policy.includes('https://wwfnsbilmyxeawgzicmv.supabase.co')) throw Error('Isolated accounting test target required')
  const initialViewport = page.viewportSize()
  let stage = 'accounting read failure recovery'
  try {
    for (const [tab, table] of [
      ['Journal', 'journal_entries'], ['Trial balance', 'trial_balance'],
      ['Receivables', 'receivables'], ['Payables', 'payables'], ['VAT', 'vat_output_ledger'],
      ['Payments', 'finance_payments'], ['Periods', 'accounting_periods'],
      ['Events', 'financial_events'], ['ZATCA', 'zatca_transmissions'],
      ['Journal', 'chart_of_accounts'], ['VAT', 'vat_reconciliation'], ['Payments', 'bank_accounts'],
    ]) {
      stage = `${tab}: failed read and retry`
      const pattern = `**/rest/v1/${table}?**`
      const fail = route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Synthetic unavailable read"}' })
      await page.route(pattern, fail)
      await page.goto(`${origin}/accounting?lang=en`)
      if (tab !== 'Journal') await page.getByRole('tab', { name: tab, exact: true }).click()
      const error = page.getByTestId('accounting-load-error')
      await expect(error).toContainText('Could not load accounting data')
      await expect(page.getByRole('tabpanel')).toHaveCount(0)
      await page.unroute(pattern, fail)
      await error.getByRole('button', { name: 'Try again', exact: true }).click()
      await expect(error).toHaveCount(0)
      await expect(page.getByRole('tabpanel', { name: tab, exact: true })).toBeVisible()
    }

    stage = 'malformed successful response is not an empty ledger'
    const pattern = '**/rest/v1/journal_entries?**'
    const malformed = route => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
    await page.route(pattern, malformed)
    await page.goto(`${origin}/accounting?lang=en`)
    await expect(page.getByTestId('accounting-load-error')).toBeVisible()
    await page.unroute(pattern, malformed)
    await page.getByTestId('accounting-load-error').getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(page.getByRole('tabpanel', { name: 'Journal', exact: true })).toBeVisible()

    stage = 'late request cannot replace a newly selected tab with an error'
    let release
    let started
    let finished
    const blocked = new Promise(resolve => { release = resolve })
    const intercepted = new Promise(resolve => { started = resolve })
    const completed = new Promise(resolve => { finished = resolve })
    const late = async route => {
      started()
      await blocked
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Synthetic late failure"}' }).catch(() => {})
      finished()
    }
    await page.route(pattern, late)
    try {
      await page.goto(`${origin}/accounting?lang=en`)
      let timeout
      try {
        await Promise.race([intercepted, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Missing intercepted read')), 20_000) })])
      } finally { clearTimeout(timeout) }
      await page.getByRole('tab', { name: 'Payables', exact: true }).click()
      await expect(page.getByRole('tabpanel', { name: 'Payables', exact: true })).toBeVisible()
      release()
      await completed
      await page.unroute(pattern, late)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await expect(page.getByTestId('accounting-load-error')).toHaveCount(0)
      await expect(page.getByRole('tabpanel', { name: 'Payables', exact: true })).toBeVisible()
    } finally { release() }

    stage = 'Arabic mobile failure and recovery'
    await page.setViewportSize({ width: 390, height: 844 })
    const fail = route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Synthetic unavailable read"}' })
    await page.route(pattern, fail)
    await page.goto(`${origin}/accounting?lang=ar`)
    const error = page.getByTestId('accounting-load-error')
    await expect(error).toContainText('تعذر تحميل البيانات المحاسبية')
    const bounds = await error.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(391)
    await page.screenshot({ path: 'supabase/.temp/accounting-read-error-mobile-ar.png' })
    await page.unroute(pattern, fail)
    await error.getByRole('button', { name: 'أعد المحاولة', exact: true }).click()
    await expect(page.getByRole('tabpanel', { name: 'قيود اليومية', exact: true })).toBeVisible()
    console.log('PASS: twelve accounting primary/dependency read failures/retries, malformed response rejection, stale-tab cancellation, Arabic mobile recovery; no financial mutations')
  } catch (error) {
    console.error(JSON.stringify({ check: 'accounting read recovery', stage, errorType: error.name }))
    throw Error(`Accounting read recovery failed: ${stage}`)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    if (initialViewport) await page.setViewportSize(initialViewport)
    await page.goto(`${origin}/accounting?lang=en`)
  }
}
