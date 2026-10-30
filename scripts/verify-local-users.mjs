import { expect as baseExpect } from '@playwright/test'

const expect = baseExpect.configure({ timeout: 20_000 })

// Only called by the loopback-only MFA harness, in its synthetic tenant.
// Team invites end to end: validation, invite, duplicate rejection, revoke.
export async function verifyUsersInvites(page, admin, tenantId, appUrl) {
  let stage = 'invite validation'
  const email = `invite-check-${Date.now()}@example.com`
  try {
    await page.evaluate(() => localStorage.setItem('elite-locale', 'en'))
    await page.goto(`${appUrl}/users`)
    await page.getByRole('button', { name: 'Invite user' }).first().click()
    let dialog = page.getByRole('dialog')
    await dialog.locator('#invite-email').fill('not-an-email')
    await dialog.getByRole('button', { name: 'Send invite', exact: true }).click()
    await expect(page.getByText('Enter a valid email address')).toBeVisible()
    await expect(dialog).toBeVisible()

    stage = 'invite create'
    await dialog.locator('#invite-email').fill(email.toUpperCase())
    await dialog.locator('#invite-role').click()
    await page.getByRole('option', { name: 'HR Officer', exact: true }).click()
    await dialog.getByRole('button', { name: 'Send invite', exact: true }).click()
    await expect(dialog).toBeHidden()
    let invite
    await expect.poll(async () => {
      invite = (await admin.from('invites').select('id,role,status').eq('tenant_id', tenantId).eq('email', email).maybeSingle()).data
      return invite?.status
    }).toBe('pending')
    expect(invite.role).toBe('hr_officer')

    stage = 'invite duplicate'
    await page.getByRole('button', { name: 'Invite user' }).first().click()
    dialog = page.getByRole('dialog')
    await dialog.locator('#invite-email').fill(email)
    await dialog.getByRole('button', { name: 'Send invite', exact: true }).click()
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(1500)
    const count = await admin.from('invites').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('email', email)
    expect(count.count).toBe(1)
    await page.keyboard.press('Escape')

    stage = 'invite revoke'
    await page.goto(`${appUrl}/settings/users`)
    await page.getByRole('tab', { name: /Invite/ }).click()
    const row = page.locator('tr', { hasText: email })
    await row.getByRole('button', { name: 'Revoke', exact: true }).click()
    await expect.poll(async () => (await admin.from('invites').select('status').eq('id', invite.id).single()).data?.status).toBe('revoked')
    await expect(row).toHaveCount(0)
    console.log('PASS: user invite validation/create/duplicate-block/revoke persisted through authenticated browser actions')
  } catch (error) {
    console.error(JSON.stringify({ check: 'users', stage, errorType: error.name, detail: String(error.message).slice(0, 400) }))
    throw new Error(`Users browser verification failed: ${stage}`)
  }
}
