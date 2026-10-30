import { expect as baseExpect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

const expect = baseExpect.configure({ timeout: 20_000 })

// Only called by the loopback-only MFA harness, in its synthetic tenant.
// Driver application review end to end: reason gate, under review, approve,
// archive; and a second application rejected.
export async function verifyApplicationsReview(page, admin, tenantId, appUrl) {
  let stage = 'applications fixture'
  try {
    const make = async (n) => {
      const id = randomUUID()
      const { error } = await admin.from('driver_applications').insert({ id, tenant_id: tenantId, application_number: `APP-CHK-${Date.now()}-${n}`,
        first_name: `Review${n}`, last_name: 'Check', full_name: `Review${n} Check`, mobile: `05512300${n}${n}`, identity_type: 'iqama',
        identity_number: `2${String(Date.now()).slice(-8)}${n}`, work_type: 'full_time', status: 'submitted', city: 'Riyadh' })
      expect(error).toBeNull()
      return id
    }
    const first = await make(1), second = await make(2)
    const status = async (id) => (await admin.from('driver_applications').select('status,archived_at').eq('id', id).single()).data
    const reason = page.locator('#application-review-reason')

    stage = 'applications reason gate'
    await page.evaluate(() => localStorage.setItem('elite-locale', 'en'))
    await page.goto(`${appUrl}/applications/${first}`)
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled()
    await reason.fill('ok')
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled()

    stage = 'applications under review'
    await reason.fill('Documents received, starting review')
    await page.getByRole('button', { name: 'Under Review', exact: true }).click()
    await expect.poll(async () => (await status(first))?.status).toBe('under_review')

    stage = 'applications approve'
    await expect(reason).toHaveValue('')
    await reason.fill('All documents verified and interview passed')
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect.poll(async () => (await status(first))?.status).toBe('approved')

    stage = 'applications archive'
    await reason.fill('Hiring completed, archive from queue')
    await page.getByRole('button', { name: 'Archive application', exact: true }).click()
    await expect.poll(async () => (await status(first))?.archived_at).not.toBeNull()

    stage = 'applications reject'
    await page.goto(`${appUrl}/applications/${second}`)
    await reason.fill('Identity document could not be verified')
    await page.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect.poll(async () => (await status(second))?.status).toBe('rejected')
    console.log('PASS: application reason gate/under review/approve/archive/reject persisted through authenticated browser actions')
  } catch (error) {
    console.error(JSON.stringify({ check: 'applications', stage, errorType: error.name, detail: String(error.message).slice(0, 400) }))
    throw new Error(`Applications browser verification failed: ${stage}`)
  }
}
