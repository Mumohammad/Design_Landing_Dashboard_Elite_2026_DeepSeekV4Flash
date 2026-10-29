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
    const rpcPattern = '**/rest/v1/rpc/read_my_accounting_page'
    for (const [tab, read, mode] of [
      ['Journal', 'journal_entries', 'top'], ['Trial balance', 'trial', 'card'],
      ['Receivables', 'receivables', 'top'], ['Payables', 'payables', 'top'],
      ...['vat_output', 'vat_input', 'vat_adjustments', 'vat_periods', 'vat_recon', 'vat_review'].map(kind => ['VAT', kind, 'card']),
      ['Payments', 'payments', 'card'], ['Periods', 'periods', 'card'],
      ['Events', 'events', 'card'], ['E-invoicing (ZATCA)', 'zatca', 'card'],
      ['Payments', 'bank_accounts', 'top'], ['VAT', 'read_my_vat_position', 'top'],
    ]) {
      stage = `${tab}: ${read} failed read and retry`
      const direct = ['journal_entries', 'bank_accounts'].includes(read)
      const pattern = direct ? `**/rest/v1/${read}?**` : read === 'read_my_vat_position' ? '**/rest/v1/rpc/read_my_vat_position' : rpcPattern
      let intercepted = 0
      const fail = async route => {
        if (!direct && read !== 'read_my_vat_position' && route.request().postDataJSON()?.p_kind !== read) return route.continue()
        intercepted++
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Synthetic unavailable read"}' })
      }
      await page.route(pattern, fail)
      await page.goto(`${origin}/accounting?lang=en`)
      if (tab !== 'Journal') await page.getByRole('tab', { name: tab, exact: true }).click()
      const error = mode === 'top' ? page.getByTestId('accounting-load-error') : page.getByRole('main').getByRole('alert').filter({ hasText: 'Could not load records. Retry before relying on them.' })
      await expect(error).toHaveCount(1)
      await expect(error).toContainText(mode === 'top' ? 'Could not load accounting data' : 'Could not load records')
      expect(intercepted).toBeGreaterThan(0)
      const panel = page.getByRole('tabpanel', { name: tab, exact: true })
      const controlIndex = mode === 'card' ? await error.evaluate(element => {
        const control = element.closest('[data-testid="accounting-page-controls"]')
        return Array.from(element.closest('[role="tabpanel"]').querySelectorAll('[data-testid="accounting-page-controls"]')).indexOf(control)
      }) : -1
      if (mode === 'card') expect(controlIndex).toBeGreaterThanOrEqual(0)
      const controls = mode === 'card' ? panel.getByTestId('accounting-page-controls').nth(controlIndex) : null
      const tableShell = controls?.locator('..')
      if (mode === 'top') await expect(page.getByRole('tabpanel')).toHaveCount(0)
      else await expect(tableShell.locator('table')).toHaveCount(0)
      await page.unroute(pattern, fail)
      await error.getByRole('button', { name: mode === 'top' ? 'Try again' : 'Retry', exact: true }).click()
      await expect(error).toHaveCount(0)
      await expect(panel).toBeVisible()
      // The failed card's controls no longer contain an alert after recovery.
      if (mode === 'card') {
        await expect(tableShell.getByRole('status')).toHaveCount(0)
        await expect(panel.getByRole('alert')).toHaveCount(0)
        await expect(controls).toContainText(/\d+ records? · Page \d+ of \d+/)
        await expect(tableShell.locator('table')).toHaveCount(1)
      }
      console.log(JSON.stringify({ check: 'accounting unavailable read/retry', read, result: 'PASS' }))
    }

    stage = 'journal account picker failed read and retry'
    let accountsIntercepted = 0
    const accountFail = async route => {
      if (route.request().postDataJSON()?.p_kind !== 'accounts') return route.continue()
      accountsIntercepted++
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Synthetic unavailable read"}' })
    }
    await page.route(rpcPattern, accountFail)
    await page.goto(`${origin}/accounting?lang=en`)
    await page.getByRole('button', { name: 'New entry', exact: true }).click()
    const dialog = page.getByRole('dialog')
    for (const number of [1, 2]) {
      const picker = dialog.getByTestId(`journal-account-${number}-picker`)
      await expect(picker.getByRole('alert')).toContainText('Could not load records')
      await expect(picker.getByRole('combobox')).toBeDisabled()
    }
    expect(accountsIntercepted).toBeGreaterThanOrEqual(2)
    await page.unroute(rpcPattern, accountFail)
    for (const number of [1, 2]) {
      const picker = dialog.getByTestId(`journal-account-${number}-picker`)
      await picker.getByRole('button', { name: 'Retry', exact: true }).click()
      await expect(picker.getByRole('alert')).toHaveCount(0)
      await expect(picker.getByRole('combobox')).toBeEnabled()
      await expect(picker).toContainText(/\d+ records? · Page \d+ of \d+/)
    }
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()

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
      await Promise.race([completed, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Late request did not settle')), 20_000); timer.unref() })])
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
    console.log('PASS: sixteen accounting primary/dependency failures/retries and both account pickers including all VAT cards and complete VAT position, malformed response rejection, stale-tab cancellation, Arabic mobile recovery; no financial mutations')
  } catch (error) {
    console.error(JSON.stringify({ check: 'accounting read recovery', stage, errorType: error.name, operation: /expect\(locator\)\.[A-Za-z]+/.exec(error.message)?.[0], callsite: /verify-accounting-reads\.mjs:(\d+):(\d+)/.exec(error.stack)?.slice(1) }))
    throw Error(`Accounting read recovery failed: ${stage}`)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    if (initialViewport) await page.setViewportSize(initialViewport)
    await page.goto(`${origin}/accounting?lang=en`)
  }
}
