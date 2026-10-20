import { expect as baseExpect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
const expect = baseExpect.configure({ timeout: 20_000 })

// Only synthetic ledger fixtures in an isolated caller-owned test company.
export async function verifyVatPosition(page, admin, tenantId, appUrl) {
  const origin = new URL(appUrl).origin
  const policy = (await fetch(`${origin}/landing`)).headers.get('content-security-policy') ?? ''
  const local = ['http://localhost:3107', 'http://localhost:3108'].includes(origin) && policy.includes('http://127.0.0.1:58321')
  if ((!local && !policy.includes('https://viowrovartosrkqukjxy.supabase.co')) || policy.includes('https://wwfnsbilmyxeawgzicmv.supabase.co')) throw Error('Isolated VAT test target required')
  const initialViewport = page.viewportSize(), ids = { vat_output_ledger: [], vat_input_ledger: [], vat_adjustments: [] }
  const pattern = '**/rest/v1/rpc/read_my_vat_position'
  let stage = 'synthetic VAT fixture'
  try {
    for (const table of ['vat_output_ledger', 'vat_input_ledger']) {
      const rows = Array.from({ length: 205 }, (_, i) => ({ id: randomUUID(), tenant_id: tenantId, period_year: 2026, period_month: 9, invoice_ref: `VAT-VERIFY-${i}`, invoice_date: '2026-09-01', vat_base_amount: 1, vat_amount: table === 'vat_output_ledger' ? 0.30 : 0.10, ...(table === 'vat_input_ledger' ? { vat_recoverability: 'recoverable' } : {}) }))
      ids[table] = rows.map(row => row.id)
      if ((await admin.from(table).insert(rows)).error) throw Error('VAT fixture failed')
    }
    const adjustments = Array.from({ length: 105 }, () => ({ id: randomUUID(), tenant_id: tenantId, period_year: 2026, period_month: 9, adjustment_type: 'correction', direction: 'output', vat_amount: 0.10, status: 'finalized' }))
    for (const [direction, vat_amount, status] of [['input', 1.10, 'finalized'], ['output', 900, 'draft'], ['input', 800, 'voided']]) adjustments.push({ id: randomUUID(), tenant_id: tenantId, period_year: 2026, period_month: 9, adjustment_type: 'correction', direction, vat_amount, status })
    ids.vat_adjustments = adjustments.map(row => row.id)
    if ((await admin.from('vat_adjustments').insert(adjustments)).error) throw Error('Adjustment fixture failed')
    stage = 'complete VAT browser/API totals'
    await page.goto(`${origin}/accounting?lang=en`)
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/rest/v1/rpc/read_my_vat_position')
    await page.getByRole('tab', { name: 'VAT', exact: true }).click()
    const result = await (await response).json()
    expect(Number(result.output_vat)).toBe(61.50)
    expect(Number(result.recoverable_input_vat)).toBe(20.50)
    expect(Number(result.adjustments_output)).toBe(10.50)
    expect(Number(result.adjustments_input)).toBe(1.10)
    expect(Number(result.net_position)).toBe(50.40)
    const summary = page.getByTestId('vat-position')
    for (const value of ['61.50', '20.50', '9.40', '50.40']) await expect(summary.getByText(value, { exact: true })).toBeVisible()
    await expect(summary).toContainText('all recorded periods')
    await expect(summary).toContainText('Detail lists below are limited')
    await summary.screenshot({ path: 'supabase/.temp/vat-position-desktop.png' })

    for (const [name, status, body] of [['unavailable', 503, '{"message":"Synthetic unavailable read"}'], ['malformed', 200, '{"net_position":"0"}']]) {
      stage = `${name} VAT summary read/retry`
      const fail = route => route.fulfill({ status, contentType: 'application/json', body })
      await page.route(pattern, fail)
      await page.reload()
      await page.getByRole('tab', { name: 'VAT', exact: true }).click()
      await expect(page.getByTestId('accounting-load-error')).toBeVisible()
      await expect(summary).toHaveCount(0)
      await page.unroute(pattern, fail)
      await page.getByTestId('accounting-load-error').getByRole('button', { name: 'Try again', exact: true }).click()
      await expect(summary.getByText('50.40', { exact: true })).toBeVisible()
    }
    stage = 'Arabic mobile VAT summary'
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${origin}/accounting?lang=ar`)
    await page.getByRole('tab', { name: 'الضريبة (VAT)', exact: true }).click()
    await expect(summary).toContainText('جميع الفترات المسجلة')
    await expect(summary.getByText('50.40', { exact: true })).toBeVisible()
    const box = await summary.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(391)
    await summary.screenshot({ path: 'supabase/.temp/vat-position-mobile-ar.png' })
    console.log('PASS: complete VAT browser/API totals beyond 200/100 caps, finalized-only adjustments, exact net, unavailable/malformed reads with retry and Arabic mobile scope')
  } catch (error) {
    console.error(JSON.stringify({ check: 'complete VAT position', stage, errorType: error.name }))
    throw Error(`VAT position verification failed: ${stage}`)
  } finally {
    await page.unroute(pattern)
    if (initialViewport) await page.setViewportSize(initialViewport)
    for (const table of ['vat_adjustments', 'vat_input_ledger', 'vat_output_ledger']) {
      for (let offset = 0; offset < ids[table].length; offset += 100) {
        if ((await admin.from(table).delete().eq('tenant_id', tenantId).in('id', ids[table].slice(offset, offset + 100))).error) throw Error('Synthetic VAT cleanup failed')
      }
    }
    await page.goto(`${origin}/accounting?lang=en`)
  }
}
