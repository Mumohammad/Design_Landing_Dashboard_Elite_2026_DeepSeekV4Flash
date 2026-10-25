import { expect as baseExpect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
const expect = baseExpect.configure({ timeout: 20_000 })

export async function verifyLedgerPagination(page, admin, tenantId, appUrl, accounts, periodId) {
  const database = new URL(admin.supabaseUrl)
  const target = new URL(appUrl)
  const policy = (await fetch(`${appUrl}/landing`)).headers.get('content-security-policy') ?? ''
  const local = ['http://localhost:3107', 'http://localhost:3108'].includes(target.origin)
    && ['localhost', '127.0.0.1'].includes(database.hostname) && database.port === '58321'
  const staging = database.origin === 'https://viowrovartosrkqukjxy.supabase.co' && policy.includes(database.origin)
  if ((!local && !staging) || policy.includes('https://wwfnsbilmyxeawgzicmv.supabase.co') || !tenantId || accounts.length !== 2 || !periodId) throw Error('Isolated ledger fixtures required')
  const tag = randomUUID().slice(0, 8)
  const needle = `قيد "${tag},50%_`
  const english = `EnglishOnly ${tag}`
  const createdReference = `Created-${tag}`
  const today = new Date().toISOString().slice(0, 10)
  const viewport = page.viewportSize()
  const ids = { journal_entries: [], receivables: [], payables: [] }
  const totals = {}
  let stage = 'ledger fixtures'
  try {
    for (const [table, size] of [['journal_entries', 106], ['receivables', 206], ['payables', 206]]) {
      stage = `create ${table} fixtures`
      const before = await admin.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).is('deleted_at', null)
      if (before.error || before.count === null) throw Error('Could not count isolated ledger')
      totals[table] = before.count + size
      const fixtures = Array.from({ length: size }, (_, i) => table === 'journal_entries' ? {
        id: randomUUID(),
        tenant_id: tenantId, entry_date: today, entry_type: 'manual', status: 'draft', period_id: periodId,
        description_ar: i === size - 1 ? needle : `Ledger ${tag} ${i}`, description_en: i === size - 1 ? english : `Ledger ${tag} ${i}`,
        created_at: i === size - 1 ? '2020-01-01T00:00:00Z' : new Date().toISOString(),
      } : {
        id: randomUUID(),
        tenant_id: tenantId, invoice_ref: i === size - 1 ? needle : `Ledger ${tag} ${i}`,
        invoice_date: today, due_date: i === size - 1 ? '2099-12-31' : today,
        amount: 4.10, vat_amount: 0.62, total_amount: 4.72, paid_amount: 0, status: 'open', source_entity_type: 'manual',
      })
      ids[table] = fixtures.map(row => row.id)
      const created = await admin.from(table).insert(fixtures).select('id')
      if (created.error || created.data?.length !== size) {
        console.error(JSON.stringify({ check: 'ledger fixtures', table, code: created.error?.code ?? 'count' }))
        throw Error('Could not create isolated ledger fixtures')
      }
    }
    const lines = ids.journal_entries.flatMap(journal_entry_id => [
      { tenant_id: tenantId, journal_entry_id, account_id: accounts[0], debit_amount: 12.34, credit_amount: 0 },
      { tenant_id: tenantId, journal_entry_id, account_id: accounts[1], debit_amount: 0, credit_amount: 12.34 },
    ])
    const savedLines = await admin.from('journal_entry_lines').insert(lines)
    if (savedLines.error) throw Error('Could not create balanced fixture lines')

    for (const [tab, table] of [['Journal', 'journal_entries'], ['Receivables', 'receivables'], ['Payables', 'payables']]) {
      console.log(`Checking ${tab} full ledger pagination`)
      stage = `${tab}: full database pages and literal search beyond old cap`
      await page.goto(`${appUrl}/accounting?lang=en`)
      await page.getByRole('tab', { name: tab, exact: true }).click()
      const toolbar = page.getByTestId('ledger-toolbar')
      const search = toolbar.getByRole('searchbox', { name: 'Search ledger', exact: true })
      const rows = page.getByRole('tabpanel', { name: tab, exact: true }).locator('tbody tr')
      await expect(rows).toHaveCount(25)
      await expect(toolbar).toContainText(`${totals[table]} records · Page 1 of ${Math.ceil(totals[table] / 25)}`)
      await expect(rows.filter({ hasText: needle })).toHaveCount(0)
      await toolbar.getByRole('button', { name: 'Next page', exact: true }).click()
      await expect(toolbar).toContainText('Page 2 of')
      await expect(rows).toHaveCount(25)
      await search.fill(needle)
      await expect(rows).toHaveCount(1)
      await expect(rows.first()).toContainText(needle)
      await expect(toolbar).toContainText('1 record · Page 1 of 1')
      if (tab === 'Journal') {
        await search.fill(english)
        await expect(rows).toHaveCount(1)
        await expect(rows.first()).toContainText(needle)
      }

      stage = `${tab}: empty-success page with a positive count must fail`
      const direct = table === 'journal_entries'
      const pattern = direct ? `**/rest/v1/${table}?**` : '**/rest/v1/rpc/read_my_accounting_page'
      let intercepted = 0
      const truncated = async route => {
        const request = direct ? null : route.request().postDataJSON()
        if (!direct && request?.p_kind !== table) return route.continue()
        intercepted++
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          ...(direct ? { headers: { 'content-range': `0-24/${totals[table]}` } } : {}),
          body: direct ? '[]' : JSON.stringify({ rows: [], total: totals[table], page: request.p_page, page_size: request.p_page_size, summary: null }),
        })
      }
      await page.route(pattern, truncated)
      await search.fill(`unavailable-${tag}`)
      const error = page.getByTestId('accounting-load-error')
      await expect(error).toBeVisible()
      expect(intercepted).toBeGreaterThan(0)
      await expect(page.getByRole('tabpanel')).toHaveCount(0)
      await page.unroute(pattern, truncated)
      await error.getByRole('button', { name: 'Try again', exact: true }).click()
      await expect(error).toHaveCount(0)
      await expect(page.getByRole('tabpanel', { name: tab, exact: true })).toBeVisible()
      await search.fill(needle)
      await expect(rows).toHaveCount(1)
      await expect(rows.first()).toContainText(needle)

      stage = `${tab}: Arabic mobile controls and viewport`
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`${appUrl}/accounting?lang=ar`)
      const arabicTab = tab === 'Journal' ? 'قيود اليومية' : tab === 'Receivables' ? 'الذمم المدينة' : 'الذمم الدائنة'
      await page.getByRole('tab', { name: arabicTab, exact: true }).click()
      await page.getByRole('searchbox', { name: 'بحث في السجل', exact: true }).fill(needle)
      await expect(page.getByRole('tabpanel', { name: arabicTab, exact: true }).locator('tbody tr')).toHaveCount(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const bounds = await toolbar.boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(391)
      await page.screenshot({ path: `supabase/.temp/${table}-pagination-mobile-ar.png`, fullPage: true })
      await page.setViewportSize({ width: 1440, height: 1000 })
    }

    stage = 'manual receivable: open list'
    await page.goto(`${appUrl}/accounting?lang=en`)
    await expect(page.getByRole('tabpanel', { name: 'Journal', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Receivables', exact: true }).click()
    await expect(page.getByRole('tabpanel', { name: 'Receivables', exact: true })).toBeVisible()
    stage = 'manual receivable: open form'
    await page.getByRole('button', { name: 'New receivable', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const reference = createdReference
    await dialog.locator('#rcvRef').fill(reference)
    await dialog.locator('#rcvAmount').fill('4.10')
    await dialog.locator('#rcvVat').fill('15')
    stage = 'manual receivable: exact preview'
    await expect(dialog.getByTestId('receivable-preview')).toContainText('0.62')
    await expect(dialog.getByTestId('receivable-preview')).toContainText('4.72')
    stage = 'manual receivable: save'
    await dialog.getByRole('button', { name: /Save|حفظ/ }).click()
    await expect(dialog).toBeHidden()
    stage = 'manual receivable: persisted VAT and refreshed list'
    const persisted = await admin.from('receivables').select('id,total_amount').eq('tenant_id', tenantId).eq('invoice_ref', reference).single()
    if (persisted.error || Number(persisted.data.total_amount) !== 4.72) throw Error('Receivable creation did not persist exact VAT')
    ids.receivables.push(persisted.data.id)
    await page.getByRole('searchbox', { name: 'Search ledger', exact: true }).fill(reference)
    await expect(page.getByRole('tabpanel', { name: 'Receivables', exact: true }).locator('tbody tr')).toHaveCount(1)
    await expect(page.getByTestId('ledger-toolbar')).toContainText('1 record · Page 1 of 1')
    console.log('PASS: journal/AR/AP database pages beyond old caps, literal Arabic/English search, malformed-page recovery, Arabic mobile controls and persisted manual receivable/VAT refresh')
  } catch (error) {
    console.error(JSON.stringify({ check: 'ledger pagination', stage, errorType: error.name }))
    await page.screenshot({ path: 'supabase/.temp/ledger-pagination-failure.png' })
    throw Error(`Ledger pagination verification failed: ${stage}`)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    const manual = await admin.from('receivables').select('id').eq('tenant_id', tenantId).eq('invoice_ref', createdReference).maybeSingle()
    if (manual.error) throw Error('Could not identify synthetic manual receivable for cleanup')
    if (manual.data && !ids.receivables.includes(manual.data.id)) ids.receivables.push(manual.data.id)
    // Only this run's non-posted/unpaid synthetic records are eligible.
    for (const [table, created] of Object.entries(ids)) {
      if (!created.length) continue
      for (let offset = 0; offset < created.length; offset += 50) {
        const cleanup = await admin.from(table).delete().eq('tenant_id', tenantId).in('id', created.slice(offset, offset + 50))
        if (cleanup.error) throw Error(`Could not clean up synthetic ${table} ledger fixtures`)
      }
    }
    if (viewport) await page.setViewportSize(viewport)
    await page.goto(`${appUrl}/accounting?lang=en`)
  }
}
