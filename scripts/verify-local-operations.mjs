import { expect as baseExpect } from '@playwright/test'

const expect = baseExpect.configure({ timeout: 20_000 })

// Only called by the loopback-only MFA harness, in its synthetic tenant.
export async function verifyOperationsCrud(page, admin, tenantId, appUrl) {
  let stage = 'platform creation'
  try {
    await page.evaluate(() => localStorage.setItem('elite-locale', 'en'))
    await page.goto(`${appUrl}/platforms`)
    await page.getByRole('button', { name: 'Add platform', exact: true }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByLabel('Code', { exact: true }).fill('BROWSER')
    await dialog.getByLabel('Name (Arabic)', { exact: true }).fill('منصة اختبار')
    await dialog.getByLabel('Name (English)', { exact: true }).fill('Browser platform')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    const platform = await admin.from('delivery_platforms').select('id,name_en,is_active')
      .eq('tenant_id', tenantId).eq('code', 'BROWSER').single()
    expect(platform.error).toBeNull()
    expect(platform.data.is_active).toBe(true)

    stage = 'platform edit'
    let row = page.getByRole('row').filter({ hasText: 'BROWSER' })
    await row.getByRole('button', { name: 'Edit', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name (English)', { exact: true }).fill('Browser platform edited')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await admin.from('delivery_platforms').select('name_en')
      .eq('id', platform.data.id).single()).data?.name_en).toBe('Browser platform edited')

    stage = 'platform deactivation'
    page.once('dialog', nativeDialog => nativeDialog.accept())
    await row.getByRole('button', { name: 'Deactivate platform', exact: true }).click()
    await expect.poll(async () => (await admin.from('delivery_platforms').select('is_active')
      .eq('id', platform.data.id).single()).data?.is_active).toBe(false)

    stage = 'maintenance fixture'
    const vehicle = await admin.from('vehicles').insert({ tenant_id: tenantId,
      plate_number: 'BROWSER-M', make: 'Fixture', model: 'Test', status: 'available' }).select('id').single()
    expect(vehicle.error).toBeNull()
    stage = 'maintenance create'
    await page.goto(`${appUrl}/maintenance`)
    await page.getByRole('button', { name: 'Add maintenance event', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('Vehicle', { exact: true }).selectOption(vehicle.data.id)
    await dialog.getByLabel('Fault description', { exact: true }).fill('Browser maintenance fixture')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    const event = await admin.from('vehicle_maintenance_events').select('id,status')
      .eq('tenant_id', tenantId).eq('vehicle_id', vehicle.data.id).single()
    expect(event.error).toBeNull()
    expect(event.data.status).toBe('open')

    stage = 'maintenance edit'
    row = page.getByRole('row').filter({ hasText: 'BROWSER-M' })
    await row.getByRole('button', { name: 'Edit', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('Fault description', { exact: true }).fill('Browser maintenance edited')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await admin.from('vehicle_maintenance_events').select('fault_description')
      .eq('id', event.data.id).single()).data?.fault_description).toBe('Browser maintenance edited')

    stage = 'maintenance start'
    await row.getByRole('button', { name: 'Start work', exact: true }).click()
    await expect.poll(async () => (await admin.from('vehicle_maintenance_events').select('status')
      .eq('id', event.data.id).single()).data?.status).toBe('in_progress')
    stage = 'maintenance complete'
    await row.getByRole('button', { name: 'Complete event', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('Cost (SAR)', { exact: true }).fill('25.50')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await admin.from('vehicle_maintenance_events').select('status')
      .eq('id', event.data.id).single()).data?.status).toBe('completed')
    expect((await admin.from('vehicles').select('status').eq('id', vehicle.data.id).single()).data?.status).toBe('available')
    console.log('PASS: platform create/edit/deactivate and maintenance create/edit/start/complete persisted through authenticated browser actions')
  } catch {
    throw new Error(`Operations browser verification failed: ${stage}`)
  }
}
