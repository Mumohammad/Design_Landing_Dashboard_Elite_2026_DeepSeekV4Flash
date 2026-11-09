import { expect as baseExpect } from '@playwright/test'

const expect = baseExpect.configure({ timeout: 30_000 })

// Only called by the loopback-only MFA harness, in its synthetic tenant.
// Company profile and WPS settings show field-specific validation errors and
// persist valid values through the atomic settings workflow.
export async function verifySettings(page, admin, tenantId, appUrl) {
  let stage = 'settings open'
  try {
    await page.evaluate(() => localStorage.setItem('elite-locale', 'en'))
    await page.goto(`${appUrl}/settings/company`)
    const company = page.locator('form').filter({ has: page.locator('#nameEn') })
    const wps = page.locator('form').filter({ has: page.locator('#wpsIban') })
    await expect(page.locator('#nameEn')).toBeEnabled()
    stage = 'settings company invalid vat'
    const fill = async (id, value) => { await page.locator('#' + id).fill(value) }
    await fill('nameEn', 'CI Settings Co'); await fill('nameAr', 'شركة الإعدادات'); await fill('crNumber', '1010987654')
    await fill('buildingNumber', '1234'); await fill('additionalNumber', '5678'); await fill('postalCode', '12345')
    await fill('city', 'Riyadh'); await fill('email', 'ops@example.com'); await fill('vatNumber', '123')
    await company.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByTestId('company-settings-error')).toContainText('VAT number is invalid')
    stage = 'settings company save'
    await fill('vatNumber', '311122233300003')
    await company.getByRole('button', { name: 'Save changes' }).click()
    await expect(company.getByText('Saved')).toBeVisible()
    await expect.poll(async () => (await admin.from('tenants').select('name_en,vat_number,city').eq('id', tenantId).single()).data)
      .toEqual({ name_en: 'CI Settings Co', vat_number: '311122233300003', city: 'Riyadh' })
    stage = 'settings wps invalid iban'
    await fill('molReference', '12345678'); await fill('wpsIban', 'SA0380000000608010167510')
    await wps.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByTestId('wps-settings-error')).toContainText('IBAN is invalid')
    stage = 'settings wps save'
    await fill('wpsIban', 'SA0380000000608010167519')
    await wps.getByRole('button', { name: 'Save changes' }).click()
    await expect(wps.getByText('Saved')).toBeVisible()
    await expect.poll(async () => (await admin.from('system_settings').select('value').eq('tenant_id', tenantId).eq('key', 'company.wps_iban').is('deleted_at', null).maybeSingle()).data?.value)
      .toBe('SA0380000000608010167519')
    stage = 'settings reload persists'
    await page.reload()
    await expect(page.locator('#vatNumber')).toHaveValue('311122233300003')
    await expect(page.locator('#molReference')).toHaveValue('12345678')
    console.log('PASS: company and WPS settings show field-specific errors and persist valid values through authenticated browser actions')
  } catch (error) {
    const alert = await page.getByRole('alert').first().textContent({ timeout: 1000 }).catch(() => null)
    console.error(JSON.stringify({ check: 'settings', stage, alert, errorType: error.name, detail: String(error.message).slice(0, 400) }))
    throw new Error(`Settings browser verification failed: ${stage}`)
  }
}
