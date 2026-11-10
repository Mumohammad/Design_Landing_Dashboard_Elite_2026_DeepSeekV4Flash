import { expect as baseExpect } from '@playwright/test'

const expect = baseExpect.configure({ timeout: 30_000 })
const TYPES = ['driver_performance', 'payroll_summary', 'fleet_cost', 'revenue', 'violations_report', 'attendance_summary', 'executive_dashboard', 'hs_reconciliation']

// Only called by the loopback-only MFA harness, in its synthetic tenant.
// Every supported report type generates a completed CSV through the browser,
// and the newest one downloads with a CSV header row.
export async function verifyReports(page, admin, tenantId, appUrl) {
  let stage = 'reports open'
  try {
    await page.evaluate(() => localStorage.setItem('elite-locale', 'en'))
    await page.goto(`${appUrl}/reports`)
    for (const type of TYPES) {
      stage = `reports generate ${type}`
      await page.getByLabel('Report type').selectOption(type)
      await page.getByRole('button', { name: 'Generate report' }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Report generated successfully.' })).toBeVisible()
      await expect.poll(async () => (await admin.from('report_generation_log').select('status').eq('tenant_id', tenantId).eq('report_type', type)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()).data?.status).toBe('completed')
    }
    stage = 'reports download'
    const latest = (await admin.from('report_generation_log').select('id').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1).single()).data
    await page.reload()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('report-download-' + latest.id).click()])
    const text = await (await download.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString('utf8'))
    expect(download.suggestedFilename()).toMatch(/\.csv$/)
    expect(text.replace(/^\uFEFF/, '').split(/\r?\n/)[0].length).toBeGreaterThan(3)
    console.log('PASS: all 8 report types generated completed CSVs and the newest downloaded through authenticated browser actions')
  } catch (error) {
    const alert = await page.getByRole('alert').first().textContent({ timeout: 1000 }).catch(() => null)
    console.error(JSON.stringify({ check: 'reports', stage, alert, errorType: error.name, detail: String(error.message).slice(0, 400) }))
    throw new Error(`Reports browser verification failed: ${stage}`)
  }
}
