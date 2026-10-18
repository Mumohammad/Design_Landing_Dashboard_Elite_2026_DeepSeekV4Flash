import { expect as baseExpect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

const expect = baseExpect.configure({ timeout: 20_000 })

// The caller must authenticate into its disposable tenant. Synthetic records
// are removed by exact IDs; this helper never modifies existing business rows.
export async function verifyOverviews(page, admin, tenantId, actorId, appUrl) {
  const target = new URL(appUrl)
  const database = new URL(admin.supabaseUrl)
  const local = ['localhost', '127.0.0.1'].includes(target.hostname) && ['3107', '3108'].includes(target.port)
  if (local && (!['localhost', '127.0.0.1'].includes(database.hostname) || database.port !== '58321')) throw Error('Disposable database required')
  if (!local) {
    if (database.origin !== 'https://viowrovartosrkqukjxy.supabase.co') throw Error('Isolated staging database required')
    const policy = (await fetch(`${appUrl}/landing`)).headers.get('content-security-policy') ?? ''
    if (!policy.includes('https://viowrovartosrkqukjxy.supabase.co') || policy.includes('https://wwfnsbilmyxeawgzicmv.supabase.co')) throw Error('Isolated verification target required')
  }
  if (!tenantId || !actorId) throw Error('Disposable identity required')
  const initialLocale = await page.locator('html').getAttribute('lang') === 'ar' ? 'ar' : 'en'
  const initialViewport = page.viewportSize()
  const tag = randomUUID().slice(0, 8)
  const needle = `Needle "${tag},50%_`
  const ids = { drivers: [], vehicles: [], report_generation_log: [] }
  let stage = 'fixtures'
  try {
    const fixtures = {
      drivers: Array.from({ length: 106 }, (_, i) => ({
        tenant_id: tenantId, full_name_ar: i === 105 ? needle : `Overview ${tag} driver ${i}`,
        full_name_en: i === 105 ? needle : `Overview ${tag} driver ${i}`,
        primary_mobile: '+966500000000', category: 'freelancer', status: 'active',
        created_at: i === 105 ? '2020-01-01T00:00:00Z' : new Date().toISOString(),
      })),
      vehicles: Array.from({ length: 106 }, (_, i) => ({
        tenant_id: tenantId, plate_number: `OV-${tag}-${i}`, make: i === 105 ? needle : 'Overview',
        model: `Fixture ${i}`, status: 'available',
        created_at: i === 105 ? '2020-01-01T00:00:00Z' : new Date().toISOString(),
      })),
      report_generation_log: Array.from({ length: 106 }, (_, i) => ({
        tenant_id: tenantId, generated_by: actorId, report_type: 'driver_performance',
        status: 'failed', output_format: 'csv', file_name: i === 105 ? `${needle}.csv` : `overview-${tag}-${i}.csv`,
        error_message: 'Synthetic pagination fixture',
        created_at: i === 105 ? '2020-01-01T00:00:00Z' : new Date().toISOString(),
      })),
    }
    for (const [table, rows] of Object.entries(fixtures)) {
      const inserted = await admin.from(table).insert(rows).select('id')
      if (inserted.error || inserted.data.length !== rows.length) throw Error(`Could not create ${table} fixtures`)
      ids[table] = inserted.data.map(row => row.id)
    }

    for (const [route, table] of [['drivers', 'drivers'], ['vehicles', 'vehicles'], ['reports', 'report_generation_log']]) {
      stage = `${route}: pagination and literal search`
      await page.goto(`${appUrl}/${route}?lang=en`)
      const bodyRows = page.locator('tbody tr')
      const search = page.locator('main input').filter({ hasNot: page.locator('[type="hidden"]') }).first()
      await expect(bodyRows).toHaveCount(25)
      await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeEnabled()
      await expect(page.getByText(needle, { exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: 'Next page', exact: true }).click()
      await expect(page.getByText(/records · Page.*2/)).toBeVisible()
      await expect(bodyRows).toHaveCount(25)
      await search.fill(needle)
      await expect(bodyRows).toHaveCount(1)
      await expect(bodyRows.first()).toContainText(needle)

      if (route === 'drivers') {
        stage = 'driver export includes all 106 matching rows'
        await search.fill(`Overview ${tag}`)
        await expect(bodyRows).toHaveCount(25)
        const download = page.waitForEvent('download')
        await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
        const stream = await (await download).createReadStream()
        const chunks = []
        for await (const chunk of stream) chunks.push(chunk)
        const csv = Buffer.concat(chunks).toString('utf8')
        // 105 regular fixtures match this prefix; the last fixture is the needle.
        expect(csv.split('\n').length).toBe(106)
        expect(csv).toContain(`Overview ${tag} driver 0`)
        expect(csv).toContain(`Overview ${tag} driver 104`)
      }

      stage = `${route}: failed read and retry`
      const pattern = `**/rest/v1/${table}?**`
      const fail = async intercepted => {
        if (intercepted.request().method() === 'GET') await intercepted.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Synthetic unavailable read"}' })
        else await intercepted.continue()
      }
      await page.route(pattern, fail)
      await search.fill(`unavailable-${tag}`)
      await expect(page.getByRole('alert').filter({ hasText: /Could not load/ })).toBeVisible()
      await page.unroute(pattern, fail)
      await page.getByRole('button', { name: /Retry|Try again/, exact: true }).click()
      await expect(page.getByRole('alert').filter({ hasText: /Could not load/ })).toHaveCount(0)
      await search.fill(needle)
      await expect(bodyRows.first()).toContainText(needle)

      stage = `${route}: maximum-length search remains usable`
      await search.fill('x'.repeat(200))
      await expect(page.locator('tbody .animate-pulse')).toHaveCount(0)
      await search.press('End')
      await search.pressSequentially('z')
      await expect(search).toHaveValue('x'.repeat(200))
      await expect(page.locator('tbody .animate-pulse')).toHaveCount(0)
      await page.setViewportSize({ width: 390, height: 844 })
      const empty = page.getByTestId('module-empty-state')
      await expect(empty).toBeVisible()
      const emptyBounds = await empty.boundingBox()
      expect(emptyBounds.x).toBeGreaterThanOrEqual(0)
      expect(emptyBounds.x + emptyBounds.width).toBeLessThanOrEqual(391)
      for (const button of await empty.getByRole('button').all()) {
        const bounds = await button.boundingBox()
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(391)
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
      await search.fill(needle)
      await expect(bodyRows.first()).toContainText(needle)

      stage = `${route}: Arabic mobile rendering`
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`${appUrl}/${route}?lang=ar`)
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
      await expect(page.getByRole('button', { name: 'الصفحة التالية', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    console.log('PASS: drivers, vehicles, and reports beyond 100 rows; paginated reads, literal wildcard/quote search, complete driver CSV, failed-read retry, and Arabic mobile controls')
  } catch (error) {
    console.error(JSON.stringify({ check: 'overviews', stage, errorType: error.name }))
    throw new Error(`Overview verification failed: ${stage}`)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    for (const [table, created] of Object.entries(ids)) {
      if (created.length) {
        const result = await admin.from(table).delete().eq('tenant_id', tenantId).in('id', created)
        if (result.error) throw new Error(`Could not clean up synthetic ${table} fixtures`)
      }
    }
    // This helper exercises Arabic mobile screens, then returns the caller's
    // browser state so later authentication checks test their intended locale.
    if (initialViewport) await page.setViewportSize(initialViewport)
    await page.goto(`${appUrl}/dashboard?lang=${initialLocale}`)
    await expect(page.locator('html')).toHaveAttribute('lang', initialLocale)
  }
}
