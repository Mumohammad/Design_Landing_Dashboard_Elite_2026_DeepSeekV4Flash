import { expect as baseExpect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { assertModuleTestTarget } from './assert-module-test-target.mjs'
import { minorUnits, parseVatCsv } from './lib/finance-verification-contracts.mjs'
const expect = baseExpect.configure({ timeout: 30_000 })
const period = '1902-02', year = 1902, month = 2
const amounts = { output_vat: '150.00', recoverable_input_vat: '30.00', non_recoverable_vat: '7.50', pending_review_vat: '15.00', adjustments_output: '5.00', adjustments_input: '2.50', net_position: '122.50' }
const csvFields = ['output_vat','recoverable_input_vat','non_recoverable_vat','pending_review_vat','adjustments_output','adjustments_input','net_position']

/** Synthetic imported ledger fixtures exercise preparation documents only.
 * No authority submission or stored-PDF guarantee is inferred from a snapshot. */
export async function verifyVatReportOutputs(page, admin, tenantId, appUrl) {
  await assertModuleTestTarget(page, admin.supabaseUrl, appUrl)
  const tag = randomUUID(), popups = new Set()
  const evidence = path.resolve(process.env.VERIFY_EVIDENCE_DIR ?? 'supabase/.temp/finance-report-output-' + tenantId)
  let stage = 'owned VAT output fixtures', route, company
  const readDocuments = async () => {
    const result = await admin.from('generated_documents').select('id,tenant_id,doc_number,generated_data,generated_at,verify_url,verify_token_hash,status', { count: 'exact' })
      .eq('tenant_id', tenantId).eq('generated_data->>kind', 'vat_return').eq('generated_data->>period_year', String(year)).eq('generated_data->>period_month', String(month)).limit(101)
    if (result.error || result.count !== result.data?.length || result.count > 100) throw Error('Complete owned VAT snapshot set unavailable')
    return result.data
  }
  const download = async (button, expectedName) => {
    const waiting = page.waitForEvent('download'); await button.click(); const result = await waiting
    expect(result.suggestedFilename()).toMatch(expectedName)
    const stream = await result.createReadStream(); if (!stream) throw Error('VAT CSV stream unavailable')
    const chunks = []; let size = 0
    for await (const chunk of stream) { size += chunk.length; if (size > 2 * 1024 * 1024) throw Error('VAT CSV unexpectedly large'); chunks.push(chunk) }
    return Buffer.concat(chunks).toString('utf8')
  }
  const print = async (button, title, filename) => {
    const waiting = page.waitForEvent('popup'); await button.click(); const popup = await waiting; popups.add(popup)
    await expect(popup.locator('body')).toContainText(title)
    for (const name of [company?.name_ar, company?.name_en].filter(Boolean)) await expect(popup.locator('body')).toContainText(name)
    await popup.evaluate(() => document.fonts.ready)
    const bytes = await popup.pdf({ format: 'A4', printBackground: true, displayHeaderFooter: false })
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    fs.mkdirSync(evidence, { recursive: true }); fs.writeFileSync(path.join(evidence, filename), bytes)
    return popup
  }
  const verifyAmounts = row => {
    for (const field of csvFields) expect(minorUnits(row[field])).toBe(minorUnits(amounts[field]))
    expect(Number(row.pending_review_rows)).toBe(1)
  }
  try {
    const companyResult = await admin.from('tenants').select('name_ar,name_en').eq('id', tenantId).single()
    if (companyResult.error || !companyResult.data?.name_ar) throw Error('Owned company report header required')
    company = companyResult.data
    for (const table of ['vat_output_ledger', 'vat_input_ledger', 'vat_adjustments']) {
      const current = await admin.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('period_year', year).eq('period_month', month)
      if (current.error || current.count !== 0) throw Error('Untouched owned VAT fixture period required')
    }
    const base = { tenant_id: tenantId, period_year: year, period_month: month, invoice_date: period + '-15' }
    const output = await admin.from('vat_output_ledger').insert({ ...base, id: randomUUID(), invoice_ref: 'VAT-OUTPUT-' + tag, vat_base_amount: '1000.00', vat_amount: '150.00' })
    const input = await admin.from('vat_input_ledger').insert([
      { ...base, id: randomUUID(), invoice_ref: 'VAT-REC-' + tag, vat_base_amount: '200.00', vat_amount: '30.00', vat_recoverability: 'recoverable' },
      { ...base, id: randomUUID(), invoice_ref: 'VAT-NONREC-' + tag, vat_base_amount: '50.00', vat_amount: '7.50', vat_recoverability: 'non_recoverable' },
      { ...base, id: randomUUID(), invoice_ref: 'VAT-PENDING-' + tag, vat_base_amount: '100.00', vat_amount: '15.00', vat_recoverability: 'pending_review' },
    ])
    const adjustment = await admin.from('vat_adjustments').insert([
      { tenant_id: tenantId, id: randomUUID(), period_year: year, period_month: month, adjustment_type: 'correction', direction: 'output', vat_amount: '5.00', status: 'finalized' },
      { tenant_id: tenantId, id: randomUUID(), period_year: year, period_month: month, adjustment_type: 'correction', direction: 'input', vat_amount: '2.50', status: 'finalized' },
    ])
    if ([output, input, adjustment].some(result => result.error)) throw Error('Owned VAT report fixtures failed')
    const expected = await admin.from('vat_reconciliation').select('*', { count: 'exact' }).eq('tenant_id', tenantId).limit(1001)
    if (expected.error || expected.count !== expected.data?.length || expected.count > 1000) throw Error('Complete owned reconciliation baseline required')
    const ownRow = expected.data.find(row => row.period_year === year && row.period_month === month)
    if (!ownRow) throw Error('Owned report period missing'); verifyAmounts(ownRow)
    const baselineDocs = await readDocuments(); expect(baselineDocs).toHaveLength(0)
    await page.goto(appUrl + '/accounting?lang=en'); await page.getByRole('tab', { name: 'VAT', exact: true }).click()
    const recon = page.locator('[data-slot="card"]').filter({ has: page.getByText('Reconciliation by period', { exact: true }) })
    const vatReturn = page.locator('[data-slot="card"]').filter({ has: page.getByText('VAT Return', { exact: true }) })
    await page.getByLabel('VAT return month', { exact: true }).fill(period)
    await expect(vatReturn).toContainText('122.50')
    stage = 'blocked popups cannot issue a report or claim success'
    for (const [card, feedback] of [[recon, 'Allow pop-ups for this site, then try printing the report again.'], [vatReturn, 'Allow pop-ups for this site, then try printing the return again.']]) {
      let writes = 0
      const watch = request => { if (request.method() === 'POST' && request.headers()['next-action']) writes++ }
      page.on('request', watch)
      await page.evaluate(() => { globalThis.__vatSavedWindowOpen = window.open; window.open = () => null })
      try {
        await card.getByRole('button', { name: 'Print', exact: true }).click()
        await expect(page.getByText(feedback, { exact: true })).toBeVisible()
        await expect(card.getByRole('button', { name: 'Print', exact: true })).toBeEnabled()
        expect(writes).toBe(0)
      } finally {
        await page.evaluate(() => { window.open = globalThis.__vatSavedWindowOpen; delete globalThis.__vatSavedWindowOpen })
        page.off('request', watch)
      }
    }
    expect(await readDocuments()).toEqual(baselineDocs)
    stage = 'failed report request closes its reserved blank preview and permits retry'
    let intercepted = false
    route = async interceptedRoute => {
      const request = interceptedRoute.request()
      if (!intercepted && request.method() === 'POST' && request.headers()['next-action']) { intercepted = true; await interceptedRoute.abort('failed') }
      else await interceptedRoute.continue()
    }
    await page.route('**/accounting*', route)
    const blankWaiting = page.waitForEvent('popup'); await recon.getByRole('button', { name: 'Print', exact: true }).click()
    const blank = await blankWaiting; popups.add(blank)
    await expect.poll(() => blank.isClosed()).toBe(true)
    await expect(page.getByText('Could not open the reconciliation report. Check your connection and try again.', { exact: true })).toBeVisible()
    await expect(recon.getByRole('button', { name: 'Print', exact: true })).toBeEnabled()
    expect(intercepted).toBe(true); await page.unroute('**/accounting*', route); route = undefined
    stage = 'complete reconciliation CSV exactly matches all owned periods'
    const reconCsv = await download(recon.getByRole('button', { name: 'CSV', exact: true }), /^vat-reconciliation-\d{4}-\d{2}-\d{2}\.csv$/)
    const rows = parseVatCsv(reconCsv)
    expect(rows).toHaveLength(expected.data.length)
    expect(new Set(rows.map(row => row.period)).size).toBe(rows.length)
    expect(rows.map(row => row.period).sort()).toEqual(expected.data.map(row => row.period_year + '-' + String(row.period_month).padStart(2, '0')).sort())
    for (const row of expected.data) {
      const actual = rows.find(value => value.period === row.period_year + '-' + String(row.period_month).padStart(2, '0'))
      for (const field of csvFields) expect(minorUnits(actual[field])).toBe(minorUnits(row[field]))
      expect(Number(actual.pending_review_rows)).toBe(Number(row.pending_review_rows))
    }
    verifyAmounts(rows.find(row => row.period === period))
    stage = 'reconciliation print/PDF contains exact period values'
    const reconPopup = await print(recon.getByRole('button', { name: 'Print', exact: true }), 'VAT Reconciliation Report', 'vat-reconciliation-report.pdf')
    const reportRow = reconPopup.locator('tbody tr').filter({ has: reconPopup.getByRole('cell', { name: period, exact: true }) })
    await expect(reportRow).toHaveCount(1)
    for (const [index, value] of [[2,'150.00'],[3,'30.00'],[4,'7.50'],[5,'15.00'],[6,'5.00'],[7,'2.50'],[8,'122.50']]) await expect(reportRow.locator('td').nth(index)).toContainText(value + ' SAR')
    await reconPopup.close(); popups.delete(reconPopup)
    stage = 'selected-period return CSV and preparation PDF'
    const returnCsv = parseVatCsv(await download(vatReturn.getByRole('button', { name: 'CSV', exact: true }), /^vat-return-1902-02\.csv$/))
    expect(returnCsv).toHaveLength(1); expect(returnCsv[0].period).toBe(period); expect(returnCsv[0].net_nature).toBe('payable'); verifyAmounts(returnCsv[0])
    const returnPopup = await print(vatReturn.getByRole('button', { name: 'Print', exact: true }), 'VAT return — period ' + period, 'vat-return-report.pdf')
    await expect(returnPopup.locator('body')).toContainText('Preparation document only — no electronic submission in this release.')
    for (const [label, amount] of [['Output VAT (sales)','150.00'],['Recoverable input VAT (purchases)','30.00'],['Non-recoverable input VAT (expensed)','7.50'],['Pending review (awaiting classification)','15.00'],['Output adjustments','5.00'],['Input adjustments','2.50'],['Net VAT payable','122.50']]) {
      await expect(returnPopup.locator('tbody tr').filter({ hasText: label }).locator('td').last()).toContainText(amount + ' SAR')
    }
    const first = await readDocuments(); expect(first).toHaveLength(1)
    expect(first[0].tenant_id).toBe(tenantId); expect(first[0].status).toBe('generated'); expect(first[0].generated_data.period_year).toBe(year); expect(first[0].generated_data.period_month).toBe(month)
    expect(first[0].doc_number).toMatch(/^VAT-RET-1902-02-[0-9a-f]{32}$/); expect(first[0].verify_url).toMatch(/^\/verify-document\/[0-9a-f]{64}$/); expect(first[0].verify_token_hash).toMatch(/^[0-9a-f]{64}$/)
    verifyAmounts(first[0].generated_data)
    await returnPopup.close(); popups.delete(returnPopup)
    stage = 'repeated print retains original immutable snapshot'
    const secondPopup = await print(vatReturn.getByRole('button', { name: 'Print', exact: true }), 'VAT return — period ' + period, 'vat-return-repeat-report.pdf')
    const retained = await readDocuments(); expect(retained).toHaveLength(2)
    expect(retained.find(row => row.id === first[0].id)).toEqual(first[0])
    const second = retained.find(row => row.id !== first[0].id); expect(second.doc_number).not.toBe(first[0].doc_number); expect(second.verify_url).not.toBe(first[0].verify_url); verifyAmounts(second.generated_data)
    await secondPopup.close(); popups.delete(secondPopup)
    const audit = await admin.from('audit_log').select('entity_id,action').eq('tenant_id', tenantId).in('action', ['vat_reconciliation_exported','vat_reconciliation_report_generated','vat_return_exported','vat_return_report_generated'])
    if (audit.error) throw Error('VAT output audit read failed')
    for (const action of ['vat_reconciliation_exported','vat_reconciliation_report_generated','vat_return_exported']) expect(audit.data.filter(row => row.action === action)).toHaveLength(1)
    for (const document of retained) expect(audit.data.filter(row => row.action === 'vat_return_report_generated' && row.entity_id === document.id)).toHaveLength(1)
    stage = 'Arabic print failure feedback'
    await page.goto(appUrl + '/accounting?lang=ar'); await page.getByRole('tab', { name: 'الضريبة (VAT)', exact: true }).click()
    const arabic = page.locator('[data-slot="card"]').filter({ has: page.getByText('التسوية حسب الفترة', { exact: true }) })
    await page.evaluate(() => { globalThis.__vatSavedWindowOpen = window.open; window.open = () => null })
    try {
      await arabic.getByRole('button', { name: 'طباعة التقرير', exact: true }).click()
      await expect(page.getByText('اسمح بالنوافذ المنبثقة لهذا الموقع، ثم حاول طباعة التقرير مجدداً.', { exact: true })).toBeVisible()
      await expect(arabic.getByRole('button', { name: 'طباعة التقرير', exact: true })).toBeEnabled()
    } finally { await page.evaluate(() => { window.open = globalThis.__vatSavedWindowOpen; delete globalThis.__vatSavedWindowOpen }) }
    console.log(JSON.stringify({ check: 'VAT CSV completeness, popup failure/retry, exact print/PDF values and retained preparation snapshots/audits', result: 'PASS', authoritySubmissionVerified: false, storedPdfVerified: false }))
  } catch (error) {
    console.error(JSON.stringify({ check: 'VAT report outputs', stage, errorType: error.name }))
    throw Error('VAT report output acceptance failed: ' + stage)
  } finally {
    if (route) await page.unroute('**/accounting*', route).catch(() => {})
    for (const popup of popups) if (!popup.isClosed()) await popup.close().catch(() => {})
    await page.goto(appUrl + '/accounting?lang=en')
  }
}
