import { expect as baseExpect } from '@playwright/test'
import { assertModuleTestTarget } from './assert-module-test-target.mjs'
const expect = baseExpect.configure({ timeout: 30_000 })
/** Requires the paired forward migration permitting reopened -> closed.
 * Reuses only the period created by verifyJournalReviewLifecycle. */
export async function verifyPeriodReopen(page, admin, tenantId, appUrl, { periodId, date }) {
  await assertModuleTestTarget(page, admin.supabaseUrl, appUrl)
  if (!periodId || date !== '2003-02-14') throw Error('Owned journal period required')
  let stage = 'owned open period'
  const read = async () => {
    const result = await admin.from('accounting_periods').select('id,status,period_year,period_month,reopen_reason,closed_at,closed_by')
      .eq('tenant_id', tenantId).eq('id', periodId).single()
    if (result.error) throw Error('Owned accounting period read failed')
    return result.data
  }
  try {
    const original = await read()
    expect(original.period_year).toBe(2003); expect(original.period_month).toBe(2); expect(original.status).toBe('open')
    await page.goto(appUrl + '/accounting?lang=en'); await page.getByRole('tab', { name: 'Periods', exact: true }).click()
    const panel = page.getByRole('tabpanel', { name: 'Periods', exact: true })
    await panel.getByRole('searchbox', { name: 'Search records', exact: true }).fill('2003')
    const row = panel.locator('tbody tr').filter({ hasText: 'Feb 2003' })
    await expect(row).toHaveCount(1)
    await row.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(row.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible()
    const closed = await read(); expect(closed.status).toBe('closed'); expect(closed.closed_at).toBeTruthy(); expect(closed.closed_by).toBeTruthy()
    stage = 'reopen reason and retained history'
    await row.getByRole('button', { name: 'Reopen', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Reopen period', exact: true })
    const confirm = dialog.getByRole('button', { name: 'Reopen period', exact: true })
    await expect(confirm).toBeDisabled(); await dialog.getByLabel('Reopen reason (required)', { exact: true }).fill('   '); await expect(confirm).toBeDisabled()
    const reason = 'Review correction for owned release period ' + periodId
    await dialog.getByLabel('Reopen reason (required)', { exact: true }).fill(reason)
    await confirm.click(); await expect(dialog).toBeHidden()
    await expect(row.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
    const reopened = await read(); expect(reopened.status).toBe('reopened'); expect(reopened.reopen_reason).toBe(reason)
    expect(reopened.closed_at).toBe(closed.closed_at)
    stage = 'close reopened period through same protected contract'
    await row.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(row.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible()
    const reclosed = await read(); expect(reclosed.status).toBe('closed'); expect(reclosed.reopen_reason).toBe(reason)
    const audits = await admin.from('audit_log').select('action,new_values').eq('tenant_id', tenantId).eq('entity_id', periodId)
    if (audits.error) throw Error('Period audit unavailable')
    expect(audits.data.filter(entry => entry.action === 'accounting_period_closed')).toHaveLength(2)
    const reopenAudit = audits.data.filter(entry => entry.action === 'accounting_period_reopened')
    expect(reopenAudit).toHaveLength(1); expect(reopenAudit[0].new_values.reason).toBe(reason)
    console.log(JSON.stringify({ check: 'period close/reopen reason/re-close with retained audit', result: 'PASS' }))
  } catch (error) {
    console.error(JSON.stringify({ check: 'period reopen lifecycle', stage, errorType: error.name }))
    throw Error('Period reopen acceptance failed: ' + stage)
  }
}
