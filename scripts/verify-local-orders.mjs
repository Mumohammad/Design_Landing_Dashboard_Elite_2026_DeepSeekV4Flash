import { expect as baseExpect } from '@playwright/test'

const expect = baseExpect.configure({ timeout: 20_000 })

// Only called by the loopback-only MFA harness, in its synthetic tenant.
// Daily orders end to end: validation, create, edit, archive.
export async function verifyOrdersCrud(page, admin, tenantId, appUrl) {
  let stage = 'orders fixture'
  try {
    const driver = await admin.from('drivers').insert({ tenant_id: tenantId, full_name_ar: 'سائق طلبات الاختبار', full_name_en: 'Orders Check Driver',
      primary_mobile: '0551237788', category: 'sponsored_type1', status: 'active' }).select('id').single()
    expect(driver.error).toBeNull()
    const platform = await admin.from('delivery_platforms').insert({ tenant_id: tenantId, code: 'orders-check', name_ar: 'منصة فحص الطلبات',
      name_en: 'Orders Check Platform', is_active: true }).select('id').single()
    expect(platform.error).toBeNull()

    stage = 'orders validation'
    await page.evaluate(() => localStorage.setItem('elite-locale', 'en'))
    await page.goto(`${appUrl}/orders`)
    await page.getByRole('button', { name: 'Add Orders' }).first().click()
    let dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Record Daily Orders')).toBeVisible()
    await dialog.getByRole('button', { name: 'Save orders', exact: true }).click()
    await expect(dialog).toBeVisible()
    const before = await admin.from('daily_order_entries').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
    expect(before.count ?? 0).toBe(0)

    stage = 'orders create'
    await dialog.locator('#driver_id').click()
    await page.getByRole('option', { name: /Orders Check Driver/ }).click()
    await dialog.locator('#platform_id').click()
    await page.getByRole('option', { name: /Orders Check Platform/ }).click()
    await dialog.locator('#orders_delivered').fill('23')
    await dialog.locator('#orders_failed').fill('2')
    await dialog.getByRole('button', { name: 'Save orders', exact: true }).click()
    await expect(dialog).toBeHidden()
    let entry
    await expect.poll(async () => {
      entry = (await admin.from('daily_order_entries').select('id,orders_delivered,orders_failed,driver_id,platform_id,deleted_at')
        .eq('tenant_id', tenantId).eq('driver_id', driver.data.id).maybeSingle()).data
      return entry?.orders_delivered
    }).toBe(23)
    expect(entry).toMatchObject({ platform_id: platform.data.id, orders_failed: 2, deleted_at: null })

    stage = 'orders edit'
    await page.reload()
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Edit Daily Orders')).toBeVisible()
    await dialog.locator('#orders_delivered').fill('31')
    await dialog.getByRole('button', { name: 'Save orders', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await admin.from('daily_order_entries').select('orders_delivered').eq('id', entry.id).single()).data?.orders_delivered).toBe(31)

    stage = 'orders archive'
    page.once('dialog', (confirmDialog) => confirmDialog.accept())
    await page.getByRole('button', { name: 'Archive', exact: true }).first().click()
    await expect.poll(async () => (await admin.from('daily_order_entries').select('deleted_at').eq('id', entry.id).single()).data?.deleted_at).not.toBeNull()
    console.log('PASS: daily orders validation/create/edit/archive persisted through authenticated browser actions')
  } catch (error) {
    console.error(JSON.stringify({ check: 'orders', stage, errorType: error.name, detail: String(error.message).slice(0, 400) }))
    throw new Error(`Orders browser verification failed: ${stage}`)
  }
}
