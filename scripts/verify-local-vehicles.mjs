import { expect as baseExpect } from '@playwright/test'

const expect = baseExpect.configure({ timeout: 20_000 })

// Only called by the loopback-only MFA harness, in its synthetic tenant.
// Vehicles end to end: validation, create (spaced plate is normalized),
// edit, assign a driver, unassign, archive.
export async function verifyVehiclesCrud(page, admin, tenantId, appUrl) {
  let stage = 'vehicle fixture'
  try {
    const driver = await admin.from('drivers').insert({ tenant_id: tenantId, full_name_ar: 'سائق مركبة الاختبار',
      primary_mobile: '0559876543', category: 'sponsored_type1', status: 'active' }).select('id').single()
    expect(driver.error).toBeNull()

    stage = 'vehicle validation'
    await page.evaluate(() => localStorage.setItem('elite-locale', 'en'))
    await page.goto(`${appUrl}/vehicles`)
    await page.getByRole('button', { name: 'Add Vehicle' }).first().click()
    let dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Plate number/).fill('HELLO')
    await dialog.getByLabel(/^Make/).fill('Toyota')
    await dialog.getByLabel(/^Model/).fill('Hilux')
    await dialog.getByRole('button', { name: 'Create vehicle', exact: true }).click()
    await expect(dialog.getByText('Invalid Saudi plate format')).toBeVisible()

    stage = 'vehicle create'
    await dialog.getByLabel(/^Plate number/).fill('x y z 4321')
    await dialog.getByRole('button', { name: 'Create vehicle', exact: true }).click()
    await expect(dialog).toBeHidden()
    await page.waitForURL(/\/vehicles\/[0-9a-f-]{36}/)
    const vehicleId = page.url().match(/\/vehicles\/([0-9a-f-]{36})/)[1]
    const created = await admin.from('vehicles').select('tenant_id,plate_number,status,make').eq('id', vehicleId).single()
    expect(created.error).toBeNull()
    expect(created.data).toMatchObject({ tenant_id: tenantId, plate_number: 'XYZ 4321', status: 'available', make: 'Toyota' })

    stage = 'vehicle edit'
    await page.getByRole('button', { name: 'Edit vehicle', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Color/).fill('White')
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect.poll(async () => (await admin.from('vehicles').select('color').eq('id', vehicleId).single()).data?.color).toBe('White')
    await expect(dialog).toBeHidden()

    stage = 'vehicle assign'
    await page.getByRole('button', { name: 'Assign driver', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.locator('#assign-driver').selectOption(driver.data.id)
    await dialog.getByRole('button', { name: 'Assign', exact: true }).click()
    await expect.poll(async () => (await admin.from('vehicles').select('current_driver_id,status').eq('id', vehicleId).single()).data)
      .toMatchObject({ current_driver_id: driver.data.id, status: 'assigned' })

    stage = 'vehicle unassign'
    await page.getByRole('button', { name: 'Unassign', exact: true }).click()
    await expect.poll(async () => (await admin.from('vehicles').select('current_driver_id,status').eq('id', vehicleId).single()).data)
      .toMatchObject({ current_driver_id: null, status: 'available' })
    // The record controls must pick up the new row version without a reload.
    await expect(page.getByText('Driver unassigned')).toBeVisible()

    stage = 'vehicle archive'
    await page.getByRole('button', { name: 'Archive vehicle', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.locator('#vehicle-archive-reason').fill('Browser verification archive')
    await dialog.getByRole('button', { name: 'Archive', exact: true }).click()
    await Promise.race([page.waitForURL(/\/vehicles$/), page.locator('[data-sonner-toast][data-type="error"]').first().waitFor().then(async () => {
      throw new Error('archive toast: ' + await page.locator('[data-sonner-toast][data-type="error"]').first().innerText())
    })])
    await expect.poll(async () => (await admin.from('vehicles').select('deleted_at').eq('id', vehicleId).single()).data?.deleted_at).not.toBeNull()
    console.log('PASS: vehicle validation/create/edit/assign/unassign/archive persisted through authenticated browser actions')
  } catch (error) {
    console.error(JSON.stringify({ check: 'vehicles', stage, errorType: error.name, detail: String(error.message).slice(0, 400) }))
    throw new Error(`Vehicles browser verification failed: ${stage}`)
  }
}
