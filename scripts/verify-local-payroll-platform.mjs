import { expect as baseExpect } from '@playwright/test'
import path from 'node:path'

const expect = baseExpect.configure({ timeout: 30_000 })

// Only called by the loopback-only MFA harness, in its synthetic tenant.
// Uploads the anonymized September 2026 workbook through the real UI and
// checks the stored run against the upstream golden totals (17 riders,
// net 24,223.7156), then approves and cancels it.
export async function verifyPlatformPayroll(page, admin, tenantId, ownerAuthId, appUrl) {
  let stage = 'payroll import'
  try {
    await page.evaluate(() => localStorage.setItem('elite-locale', 'en'))
    await page.goto(`${appUrl}/payroll/platform`)
    await page.locator('input[type="month"]').first().fill('2026-09')
    await page.locator('input[type="file"]').setInputFiles(path.resolve('src/lib/payroll-engine/__fixtures__/sep-2026.xlsx'))
    await page.getByRole('button', { name: 'Import & calculate', exact: true }).click()
    await page.waitForURL(/\/payroll\/platform\/runs\/[0-9a-f-]{36}/, { timeout: 60_000 })
    const runId = page.url().match(/runs\/([0-9a-f-]{36})/)[1]
    const run = await admin.from('payroll_engine_runs').select('tenant_id,status,total_drivers,total_net,created_by,file_path,rule_set_id').eq('id', runId).single()
    expect(run.error).toBeNull()
    expect(run.data.tenant_id).toBe(tenantId)
    expect(run.data.status).toBe('draft')
    expect(run.data.total_drivers).toBe(17)
    expect(Math.abs(Number(run.data.total_net) - 24223.71555555556)).toBeLessThan(0.005)
    expect(run.data.created_by).toBe(ownerAuthId)
    const rules = await admin.from('payroll_engine_rule_sets').select('created_by').eq('id', run.data.rule_set_id).single()
    expect(rules.data?.created_by).toBe(ownerAuthId)
    const results = await admin.from('payroll_engine_results').select('id', { count: 'exact', head: true }).eq('run_id', runId)
    expect(results.count).toBe(17)

    stage = 'payroll bonus reflects instantly'
    const target = (await admin.from('payroll_engine_results').select('rider_id,result').eq('run_id', runId).order('rider_id').limit(1).single()).data
    const before = (await admin.from('payroll_engine_runs').select('version').eq('id', runId).single()).data.version
    await page.goto(`${appUrl}/payroll/platform/adjustments`)
    await page.getByRole('tab', { name: 'Manual adjustments' }).click()
    await page.getByLabel('Rider ID').fill(target.rider_id)
    await page.getByLabel('Type').selectOption('bonus')
    await page.getByLabel('Title', { exact: true }).fill('CI Eid bonus')
    await page.getByLabel('Arabic title').fill('مكافأة العيد')
    await page.getByLabel('Amount (SAR)').fill('250')
    await page.getByRole('button', { name: 'Add adjustment' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Payslips updated in 1 draft payroll run' })).toBeVisible()
    const after = (await admin.from('payroll_engine_results').select('result').eq('run_id', runId).eq('rider_id', target.rider_id).single()).data.result
    expect(after.manualBonuses.map(b => b.title)).toContain('CI Eid bonus')
    expect(Math.abs(after.grossSalaryBeforePenalties - target.result.grossSalaryBeforePenalties - 250)).toBeLessThan(0.005)
    expect((await admin.from('payroll_engine_runs').select('version').eq('id', runId).single()).data.version).toBeGreaterThan(before)

    stage = 'payroll payslip preview'
    await page.goto(`${appUrl}/payroll/platform/runs/${runId}`)
    await page.getByRole('tab', { name: 'Payslips' }).click()
    await page.locator('div.rounded-2xl').filter({ hasText: target.rider_id }).getByRole('button', { name: 'View payslip' }).first().click()
    const slip = page.frameLocator('[data-testid="payslip-frame"]')
    await expect(slip.getByText('CI Eid bonus')).toBeVisible()
    await expect(slip.getByText('FINAL NET SALARY')).toBeVisible()
    await page.keyboard.press('Escape')

    stage = 'payroll approve'
    page.once('dialog', d => d.accept())
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect.poll(async () => (await admin.from('payroll_engine_runs').select('status').eq('id', runId).single()).data?.status).toBe('approved')

    stage = 'payroll cancel'
    await page.getByRole('button', { name: 'Cancel run', exact: true }).first().click()
    await page.locator('textarea').last().fill('Browser verification rollback')
    await page.getByRole('button', { name: 'Cancel run', exact: true }).last().click()
    await expect.poll(async () => (await admin.from('payroll_engine_runs').select('status').eq('id', runId).single()).data?.status).toBe('cancelled')
    console.log('PASS: platform payroll workbook import matched golden totals; a manual bonus instantly recalculated the draft payslip; branded payslip preview; approved and cancelled through authenticated browser actions')
  } catch (error) {
    console.error(JSON.stringify({ check: 'platform-payroll', stage, errorType: error.name, detail: String(error.message).slice(0, 400) }))
    throw new Error(`Platform payroll browser verification failed: ${stage}`)
  }
}
