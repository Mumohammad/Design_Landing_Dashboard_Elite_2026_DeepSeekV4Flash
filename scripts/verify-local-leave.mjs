import { expect as baseExpect } from '@playwright/test'

const expect = baseExpect.configure({ timeout: 20_000 })

// Only called by the loopback-only MFA harness, in its synthetic tenant.
// Driver leave end to end from the driver profile: type validation, request,
// review-reason gate, approve; second request rejected.
export async function verifyLeaveFlow(page, admin, tenantId, appUrl) {
  let stage = 'leave fixture'
  try {
    const driver = await admin.from('drivers').insert({ tenant_id: tenantId, full_name_ar: 'سائق إجازات الاختبار',
      primary_mobile: '0556547788', category: 'sponsored_type1', status: 'active' }).select('id').single()
    expect(driver.error).toBeNull()
    const type = await admin.from('leave_types').insert({ tenant_id: tenantId, code: 'leave-check', name_ar: 'إجازة فحص', name_en: 'Leave Check',
      days_per_year: 21 }).select('id').single()
    expect(type.error).toBeNull()
    const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
    const rows = async () => (await admin.from('driver_leave_requests').select('id,status,start_date').eq('driver_id', driver.data.id).order('start_date')).data ?? []

    stage = 'leave validation'
    await page.evaluate(() => localStorage.setItem('elite-locale', 'en'))
    await page.goto(`${appUrl}/drivers/${driver.data.id}`)
    await page.getByRole('tab', { name: 'Leave', exact: true }).click()
    const panel = page.getByRole('tabpanel')
    const request = async (start, end, reason) => {
      await panel.getByRole('button', { name: 'Request Leave', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.locator('#leave-type').click()
      await page.getByRole('option', { name: /Leave Check/ }).click()
      await dialog.locator('#leave-start').fill(start)
      await dialog.locator('#leave-end').fill(end)
      await dialog.locator('#leave-reason').fill(reason)
      await dialog.getByRole('button', { name: 'Submit Request', exact: true }).click()
      return dialog
    }
    await panel.getByRole('button', { name: 'Request Leave', exact: true }).click()
    let dialog = page.getByRole('dialog')
    const submit = dialog.getByRole('button', { name: 'Submit Request', exact: true })
    await dialog.locator('#leave-start').fill(day(22))
    await dialog.locator('#leave-end').fill(day(20))
    await dialog.locator('#leave-reason').fill('Family visit abroad')
    // End before start cannot be submitted; neither can a too-short reason.
    await expect(submit).toBeDisabled()
    await dialog.locator('#leave-end').fill(day(23))
    await dialog.locator('#leave-reason').fill('abc')
    await expect(submit).toBeDisabled()
    await dialog.locator('#leave-reason').fill('Family visit abroad')
    await expect(submit).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    stage = 'leave request'
    dialog = await request(day(20), day(22), 'Family visit abroad')
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await rows()).map(r => r.status)).toEqual(['pending'])

    stage = 'leave approve'
    const record = panel.locator('[data-testid="driver-leave-record"]').first()
    await expect(record.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled()
    await record.getByLabel('Review reason').fill('Coverage arranged with team')
    await record.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect.poll(async () => (await rows()).map(r => r.status)).toEqual(['approved'])

    stage = 'leave reject'
    dialog = await request(day(40), day(41), 'Personal errand trip')
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await rows()).length).toBe(2)
    const pending = panel.locator('[data-testid="driver-leave-record"]', { has: page.getByRole('button', { name: 'Reject', exact: true }) }).first()
    await pending.getByLabel('Review reason').fill('Peak season, no cover available')
    await pending.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect.poll(async () => (await rows()).map(r => r.status)).toEqual(['approved', 'rejected'])
    console.log('PASS: driver leave date and reason gates/request/review gate/approve/reject persisted through authenticated browser actions')
  } catch (error) {
    console.error(JSON.stringify({ check: 'leave', stage, errorType: error.name, detail: String(error.message).slice(0, 400) }))
    throw new Error(`Leave browser verification failed: ${stage}`)
  }
}
