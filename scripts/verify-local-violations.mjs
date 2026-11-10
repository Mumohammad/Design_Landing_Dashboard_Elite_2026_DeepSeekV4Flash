import { expect as baseExpect } from '@playwright/test'

const expect = baseExpect.configure({ timeout: 20_000 })

// Only called by the loopback-only MFA harness, in its synthetic tenant.
// Driver violations end to end from the driver profile: validation, add,
// edit, archive.
export async function verifyViolationsCrud(page, admin, tenantId, appUrl) {
  let stage = 'violations fixture'
  try {
    const driver = await admin.from('drivers').insert({ tenant_id: tenantId, full_name_ar: 'سائق مخالفات الاختبار',
      primary_mobile: '0553214455', category: 'sponsored_type1', status: 'active' }).select('id').single()
    expect(driver.error).toBeNull()

    stage = 'violations validation'
    await page.evaluate(() => localStorage.setItem('elite-locale', 'en'))
    await page.goto(`${appUrl}/drivers/${driver.data.id}`)
    await page.getByRole('tab', { name: 'Violations' }).click()
    await page.getByRole('tabpanel').getByRole('button', { name: 'Add violation' }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Incident date and description are required')).toBeVisible()

    stage = 'violations create'
    await dialog.locator('#deduction_amount').fill('150')
    await dialog.locator('#incident_location').fill('Riyadh Olaya')
    await dialog.locator('#incident_description').fill('Late delivery handover')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    let row
    await expect.poll(async () => {
      row = (await admin.from('violations').select('id,deduction_amount,incident_location,status,deleted_at').eq('driver_id', driver.data.id).maybeSingle()).data
      return row?.status
    }).toBe('open')
    expect(Number(row.deduction_amount)).toBe(150)

    stage = 'violations edit'
    await page.getByRole('tabpanel').getByRole('button', { name: 'Edit', exact: true }).first().click()
    dialog = page.getByRole('dialog')
    await dialog.locator('#violations-incident_location').fill('Riyadh Malqa')
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect.poll(async () => (await admin.from('violations').select('incident_location').eq('id', row.id).single()).data?.incident_location).toBe('Riyadh Malqa')
    await expect(dialog).toBeHidden()

    stage = 'violations archive'
    await page.getByRole('tabpanel').getByRole('button', { name: 'Archive', exact: true }).first().click()
    await page.getByRole('tabpanel').getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.poll(async () => (await admin.from('violations').select('deleted_at').eq('id', row.id).single()).data?.deleted_at).not.toBeNull()
    await expect(page.getByText('No violations recorded')).toBeVisible()
    console.log('PASS: driver violation validation/create/edit/archive persisted through authenticated browser actions')
  } catch (error) {
    console.error(JSON.stringify({ check: 'violations', stage, errorType: error.name, detail: String(error.message).slice(0, 400) }))
    throw new Error(`Violations browser verification failed: ${stage}`)
  }
}
