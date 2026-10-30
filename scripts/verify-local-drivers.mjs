import { expect as baseExpect } from '@playwright/test'

const expect = baseExpect.configure({ timeout: 20_000 })

// Only called by the loopback-only MFA harness, in its synthetic tenant.
// Exercises the Drivers module end to end through the real UI and server
// actions: validation, create, edit, status workflow and archive.
export async function verifyDriversCrud(page, admin, tenantId, appUrl) {
  let stage = 'driver validation'
  const name = 'سائق اختبار المتصفح'
  try {
    await page.evaluate(() => localStorage.setItem('elite-locale', 'en'))
    await page.goto(`${appUrl}/drivers`)
    await page.getByRole('button', { name: 'Add New' }).first().click()
    let dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Full name \(Arabic\)/).fill(name)
    await dialog.getByLabel(/^Primary mobile/).fill('12345')
    await dialog.getByRole('button', { name: 'Create driver', exact: true }).click()
    await expect(dialog.getByText(/Saudi mobile/).first()).toBeVisible()
    expect((await admin.from('drivers').select('id').eq('tenant_id', tenantId).eq('full_name_ar', name)).data?.length ?? 0).toBe(0)

    stage = 'driver create'
    await dialog.getByLabel(/^Primary mobile/).fill('0551234567')
    await dialog.getByRole('button', { name: 'Create driver', exact: true }).click()
    await expect(dialog).toBeHidden()
    await page.waitForURL(/\/drivers\/[0-9a-f-]{36}/)
    const driverId = page.url().match(/\/drivers\/([0-9a-f-]{36})/)[1]
    const created = await admin.from('drivers').select('id,tenant_id,status,primary_mobile,created_by,deleted_at').eq('id', driverId).single()
    expect(created.error).toBeNull()
    expect(created.data.tenant_id).toBe(tenantId)
    expect(created.data.status).toBe('draft')
    expect(created.data.primary_mobile).toBe('0551234567')
    expect(created.data.deleted_at).toBeNull()

    stage = 'driver edit'
    await page.getByRole('button', { name: 'Actions', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Edit driver' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.locator(`#edit-${driverId}-current_city`)).toBeVisible()
    await sheet.locator(`#edit-${driverId}-current_city`).fill('Riyadh')
    await sheet.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect.poll(async () => (await admin.from('drivers').select('current_city').eq('id', driverId).single()).data?.current_city).toBe('Riyadh')
    await expect(sheet).toBeHidden()

    stage = 'driver activate'
    await page.getByRole('button', { name: 'Actions', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Activate' }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.poll(async () => (await admin.from('drivers').select('status').eq('id', driverId).single()).data?.status).toBe('active')

    stage = 'driver suspend'
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: 'Actions', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Suspend driver' }).click()
    dialog = page.getByRole('dialog')
    await dialog.locator(`#action-reason-${driverId}`).fill('Browser verification suspension')
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.poll(async () => (await admin.from('drivers').select('status').eq('id', driverId).single()).data?.status).toBe('suspended')

    stage = 'driver archive'
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: 'Actions', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    dialog = page.getByRole('dialog')
    await dialog.locator(`#action-reason-${driverId}`).fill('Browser verification archive')
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
    await page.waitForURL(/\/drivers$/)
    await expect.poll(async () => (await admin.from('drivers').select('deleted_at').eq('id', driverId).single()).data?.deleted_at).not.toBeNull()
    const audit = await admin.from('audit_log').select('action').eq('tenant_id', tenantId).eq('entity_id', driverId)
    expect(audit.error).toBeNull()
    expect(audit.data.length).toBeGreaterThanOrEqual(4)
    console.log('PASS: driver validation/create/edit/activate/suspend/archive persisted through authenticated browser actions')
  } catch (error) {
    console.error(JSON.stringify({ check: 'drivers', stage, errorType: error.name, detail: String(error.message).slice(0, 400) }))
    throw new Error(`Drivers browser verification failed: ${stage}`)
  }
}
