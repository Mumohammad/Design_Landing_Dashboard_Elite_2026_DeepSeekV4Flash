import { expect as baseExpect } from '@playwright/test'
import path from 'node:path'
import { getDefaultRuleMap } from '../src/lib/payroll-engine/rules.ts'
import { payslipBreakdown } from '../src/lib/payroll-engine/payslip.ts'

const expect = baseExpect.configure({ timeout: 30_000 })

// Only called by the loopback-only MFA harness, in its synthetic tenant.
// Uploads the anonymized September 2026 workbook through the real UI and
// checks the stored run against the upstream golden totals (17 riders,
// net 24,223.7156), then approves and cancels it.
export async function verifyPlatformPayroll(page, admin, tenantId, ownerAuthId, appUrl) {
  let stage = 'payroll import'
  try {
    const readRuleCount = () => admin.from('payroll_engine_rule_sets').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
    const initialRules = await readRuleCount()
    expect(initialRules.error).toBeNull()
    expect(initialRules.count).toBe(0)
    await page.evaluate(() => localStorage.setItem('elite-locale', 'en'))
    await page.goto(`${appUrl}/payroll/platform`)
    await page.locator('input[type="month"]').first().fill('2026-09')
    await page.locator('input[type="file"]').setInputFiles(path.resolve('src/lib/payroll-engine/__fixtures__/sep-2026.xlsx'))
    await page.getByRole('button', { name: 'Import & calculate', exact: true }).click()
    await page.waitForURL(/\/payroll\/platform\/runs\/[0-9a-f-]{36}/, { timeout: 60_000 })
    const runId = page.url().match(/runs\/([0-9a-f-]{36})/)[1]
    const run = await admin.from('payroll_engine_runs').select('tenant_id,status,total_drivers,total_net,created_by,file_path,rule_set_id,rule_set_name,rule_snapshot').eq('id', runId).single()
    expect(run.error).toBeNull()
    expect(run.data.tenant_id).toBe(tenantId)
    expect(run.data.status).toBe('draft')
    expect(run.data.total_drivers).toBe(17)
    expect(Math.abs(Number(run.data.total_net) - 24223.71555555556)).toBeLessThan(0.005)
    expect(run.data.created_by).toBe(ownerAuthId)
    // Fresh tenants calculate with repository defaults without creating settings
    // as a read/import side effect. The run retains its exact immutable snapshot.
    expect(run.data.rule_set_id).toBeNull()
    expect(run.data.rule_set_name).toBe('Default payroll rules')
    expect(run.data.rule_snapshot).toEqual(getDefaultRuleMap())
    const afterRules = await readRuleCount()
    expect(afterRules.error).toBeNull()
    expect(afterRules.count).toBe(0)
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
    await page.getByPlaceholder('Search rider ID or name', { exact: true }).fill(target.rider_id)
    const viewPayslip = page.getByRole('button', { name: 'View payslip', exact: true })
    await expect(viewPayslip).toHaveCount(1)
    await viewPayslip.click()
    const slip = page.frameLocator('[data-testid="payslip-frame"]')
    await expect(slip.getByText('CI Eid bonus')).toBeVisible()
    await expect(slip.getByText('FINAL NET SALARY')).toBeVisible()
    await page.keyboard.press('Escape')

    stage = 'payroll blocked approval preserves balances'
    const pending = await admin.from('payroll_engine_results').select('rider_id,result').eq('run_id', runId).eq('tenant_id', tenantId)
    expect(pending.error).toBeNull()
    expect(pending.data).toHaveLength(17)
    const unrecovered = pending.data.filter(row => payslipBreakdown(row.result).capFloorAdjustment < -0.005)
    expect(unrecovered).toHaveLength(1)
    expect(unrecovered[0].rider_id).not.toBe(target.rider_id)
    const beforeBlocked = await admin.from('payroll_engine_runs').select('status,version').eq('id', runId).eq('tenant_id', tenantId).single()
    expect(beforeBlocked.error).toBeNull()
    page.once('dialog', d => d.accept())
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    // Next's route announcer is also an alert. Require the specific financial
    // rejection to be unique and visible, without matching unrelated live regions.
    const rejection = page.getByRole('alert').filter({ hasText: 'Some deductions exceed recoverable pay. Resolve them before approval; no balances were advanced.' })
    await expect(rejection).toHaveCount(1)
    await expect(rejection).toBeVisible()
    const afterBlocked = await admin.from('payroll_engine_runs').select('status,version').eq('id', runId).eq('tenant_id', tenantId).single()
    expect(afterBlocked.error).toBeNull()
    expect(afterBlocked.data).toEqual(beforeBlocked.data)
    const unpaid = await admin.from('payroll_engine_adjustments').select('status').eq('tenant_id', tenantId)
    expect(unpaid.error).toBeNull()
    expect(unpaid.data).toEqual([{ status: 'active' }])

    // This controlled synthetic bonus resolves the fixture's uncovered balance;
    // no production deduction/write-off policy or financial guard is changed.
    stage = 'payroll explicit synthetic balance recovery'
    const recoveryBonus = Math.ceil((-payslipBreakdown(unrecovered[0].result).capFloorAdjustment + 0.01) * 100) / 100
    expect(Number.isFinite(recoveryBonus) && recoveryBonus > 0).toBe(true)
    await page.goto(`${appUrl}/payroll/platform/adjustments`)
    await page.getByRole('tab', { name: 'Manual adjustments' }).click()
    await page.getByLabel('Rider ID').fill(unrecovered[0].rider_id)
    await page.getByLabel('Type').selectOption('bonus')
    await page.getByLabel('Title', { exact: true }).fill('CI recovery bonus')
    await page.getByLabel('Arabic title').fill('مكافأة تسوية اختبارية')
    await page.getByLabel('Amount (SAR)').fill(recoveryBonus.toFixed(2))
    await page.getByRole('button', { name: 'Add adjustment' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Payslips updated in 1 draft payroll run' })).toBeVisible()
    const recovered = await admin.from('payroll_engine_results').select('result').eq('run_id', runId).eq('tenant_id', tenantId)
    expect(recovered.error).toBeNull()
    expect(recovered.data).toHaveLength(17)
    expect(recovered.data.every(row => payslipBreakdown(row.result).capFloorAdjustment >= -0.005)).toBe(true)
    await page.goto(`${appUrl}/payroll/platform/runs/${runId}`)


    stage = 'payroll approve'
    page.once('dialog', d => d.accept())
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect.poll(async () => (await admin.from('payroll_engine_runs').select('status').eq('id', runId).single()).data?.status).toBe('approved')

    const settled = await admin.from('payroll_engine_adjustments').select('status').eq('tenant_id', tenantId)
    expect(settled.error).toBeNull()
    expect(settled.data).toHaveLength(2)
    expect(settled.data.every(row => row.status === 'paid')).toBe(true)

    stage = 'payroll cancel'
    await page.getByRole('button', { name: 'Cancel run', exact: true }).first().click()
    await page.locator('textarea').last().fill('Browser verification rollback')
    await page.getByRole('button', { name: 'Cancel run', exact: true }).last().click()
    await expect.poll(async () => (await admin.from('payroll_engine_runs').select('status').eq('id', runId).single()).data?.status).toBe('cancelled')
    const restored = await admin.from('payroll_engine_adjustments').select('status').eq('tenant_id', tenantId)
    expect(restored.error).toBeNull()
    expect(restored.data).toHaveLength(2)
    expect(restored.data.every(row => row.status === 'active')).toBe(true)
    console.log('PASS: golden payroll import, default snapshot, instant bonus/payslip, guarded rejection without settlement, explicit synthetic recovery, approval settlement and cancellation rollback')
  } catch (error) {
    const failureKind = /strict mode violation/.test(error.message) ? 'ambiguous-locator' : /Timeout|timed out/i.test(error.message) ? 'timeout' : 'assertion-or-service'
    const alertCount = await page.getByRole('alert').count().catch(() => null)
    console.error(JSON.stringify({ check: 'platform-payroll', stage, errorType: error.name, failureKind, alertCount, callsite: /verify-local-payroll-platform\.mjs:(\d+):(\d+)/.exec(error.stack)?.slice(1), operation: /expect\(locator\)\.[A-Za-z]+/.exec(error.message)?.[0] }))
    throw new Error(`Platform payroll browser verification failed: ${stage}`)
  }
}
