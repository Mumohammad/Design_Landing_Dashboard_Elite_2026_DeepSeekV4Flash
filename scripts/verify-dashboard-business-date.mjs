import { expect as baseExpect } from '@playwright/test'
const expect = baseExpect.configure({ timeout: 20_000 })

export async function verifyDashboardBusinessDate(page, appUrl) {
  const origin = new URL(appUrl).origin
  const policy = (await fetch(origin + '/landing')).headers.get('content-security-policy') ?? ''
  const local = ['http://localhost:3107', 'http://localhost:3108'].includes(origin) && policy.includes('http://127.0.0.1:58321')
  if ((!local && !policy.includes('https://viowrovartosrkqukjxy.supabase.co')) || policy.includes('https://wwfnsbilmyxeawgzicmv.supabase.co')) throw Error('Isolated date verification required')
  // Never write authenticated storage state or page bodies to disk/logs.
  const state = await page.context().storageState()
  const response = await page.request.get(origin + '/dashboard')
  if (!response.ok()) throw Error('Dashboard SSR unavailable')
  const html = await response.text()
  const initial = await page.evaluate(html => {
    const node = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-testid="dashboard-business-date"]')
    return node ? { text: node.textContent, date: node.getAttribute('datetime') } : null
  }, html)
  expect(initial).toEqual({ text: '—', date: null })
  for (const timeZone of ['UTC', 'Asia/Riyadh', 'America/Los_Angeles']) {
    const context = await page.context().browser().newContext({ storageState: state, timezoneId: timeZone })
    try {
      const probe = await context.newPage(), errors = []
      probe.on('pageerror', error => errors.push({ name: error.name, code: /Minified React error #(\d+)/.exec(error.message)?.[1] }))
      for (const locale of ['en', 'ar']) {
        await probe.goto(`${origin}/dashboard?lang=${locale}`)
        await expect(probe.locator('html')).toHaveAttribute('lang', locale)
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
        const get = type => parts.find(part => part.type === type).value
        const expected = `${get('year')}-${get('month')}-${get('day')}`
        await expect(probe.getByTestId('dashboard-business-date')).toHaveAttribute('datetime', expected)
        await expect(probe.getByTestId('dashboard-business-date')).not.toHaveText('—')
        await expect(probe.getByRole('region', { name: locale === 'en' ? 'Executive KPIs' : 'مؤشرات الأداء الرئيسية', exact: true })).toBeVisible()
        if (timeZone === 'Asia/Riyadh') await probe.getByTestId('dashboard-business-date').screenshot({ path: `supabase/.temp/dashboard-business-date-${locale}.png` })
      }
      if (errors.length) throw Error('Dashboard timezone hydration failed')
    } finally { await context.close() }
  }
  console.log('PASS: stable dashboard SSR placeholder; English/Arabic Saudi business date in UTC, Riyadh and Los Angeles browsers without hydration errors')
}
