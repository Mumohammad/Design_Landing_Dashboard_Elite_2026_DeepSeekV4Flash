import { expect as baseExpect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { assertModuleTestTarget } from './assert-module-test-target.mjs'
import { assertCounterEntry, balancedLines } from './lib/finance-verification-contracts.mjs'
const expect = baseExpect.configure({ timeout: 30_000 })

/** Only an already-authenticated owner in the caller's synthetic tenant.
 * This proves the existing owner review workflow, not maker/checker segregation. */
export async function verifyJournalReviewLifecycle(page, admin, tenantId, appUrl, accounts) {
  await assertModuleTestTarget(page, admin.supabaseUrl, appUrl)
  const description = 'Journal review ' + randomUUID(), date = '2003-02-14'
  let stage = 'create balanced manual draft'
  const one = async (table, query, fields = '*') => {
    let request = admin.from(table).select(fields).eq('tenant_id', tenantId)
    for (const [key, value] of Object.entries(query)) request = request.eq(key, value)
    const result = await request.single()
    if (result.error) throw Error('Owned ' + table + ' read failed')
    return result.data
  }
  const readLines = async id => {
    const result = await admin.from('journal_entry_lines').select('id,account_id,description,debit_amount,credit_amount')
      .eq('tenant_id', tenantId).eq('journal_entry_id', id).order('id')
    if (result.error) throw Error('Owned journal line read failed')
    balancedLines(result.data); return result.data
  }
  try {
    await page.goto(appUrl + '/accounting?lang=en')
    await page.getByRole('button', { name: 'New entry', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('#entryDate').fill(date)
    await dialog.locator('#entryDesc').fill(description)
    for (const [index, id, code] of [[1, accounts.cash, '8301'], [2, accounts.income, '8302']]) {
      const picker = dialog.getByTestId('journal-account-' + index + '-picker')
      await picker.getByRole('searchbox', { name: 'Search records', exact: true }).fill(code)
      const option = picker.locator('option[value="' + id + '"]')
      await expect(option).toHaveCount(1)
      await picker.getByRole('combobox', { name: 'Account ' + index, exact: true }).selectOption(id)
    }
    await dialog.getByLabel('Debit 1', { exact: true }).fill('23.45')
    await dialog.getByLabel('Credit 2', { exact: true }).fill('23.45')
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click(); await expect(dialog).toBeHidden()
    await page.getByRole('searchbox', { name: 'Search ledger', exact: true }).fill(description)
    let row = page.getByRole('tabpanel', { name: 'Journal', exact: true }).locator('tbody tr').filter({ hasText: description })
    await expect(row).toHaveCount(1)
    const source = await one('journal_entries', { description_ar: description })
    expect(source.status).toBe('draft'); expect(source.entry_type).toBe('manual'); expect(source.entry_date).toBe(date)
    row = page.getByRole("tabpanel", { name: "Journal", exact: true }).locator("tbody tr").filter({ has: page.getByRole("cell", { name: source.entry_ref, exact: true }) })
    const originalLines = await readLines(source.id)
    stage = 'submit and reject with required reason'
    await row.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(row.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
    expect((await one('journal_approvals', { journal_entry_id: source.id })).status).toBe('submitted')
    await expect(row.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
    await row.getByRole('button', { name: 'Reject', exact: true }).click()
    const rejected = page.getByRole('dialog', { name: 'Reject entry', exact: true })
    await expect(rejected.getByRole('button', { name: 'Reject entry', exact: true })).toBeDisabled()
    const reason = 'Corrected classification review ' + description
    await rejected.getByLabel('Rejection reason (required)', { exact: true }).fill(reason)
    await rejected.getByRole('button', { name: 'Reject entry', exact: true }).click(); await expect(rejected).toBeHidden()
    await expect(row.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
    const rejection = await one('journal_approvals', { journal_entry_id: source.id })
    expect(rejection.status).toBe('rejected'); expect(rejection.comment).toBe(reason); expect(rejection.rejected_by).toBeTruthy()
    expect((await one('journal_entries', { id: source.id })).status).toBe('draft')
    stage = 'resubmit and approve to post'
    await row.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(row.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
    await row.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(row.getByRole('button', { name: 'Reverse', exact: true })).toBeVisible()
    const posted = await one('journal_entries', { id: source.id })
    expect(posted.status).toBe('posted'); expect(posted.posted_at).toBeTruthy(); expect(posted.posted_by).toBeTruthy()
    expect((await one('journal_approvals', { journal_entry_id: source.id })).status).toBe('approved')
    expect(await readLines(source.id)).toEqual(originalLines)
    for (const name of ['Edit', 'Delete', 'Submit', 'Approve', 'Reject']) await expect(row.getByRole('button', { name, exact: true })).toHaveCount(0)
    stage = 'reverse and preserve exact counter-entry'
    await row.getByRole('button', { name: 'Reverse', exact: true }).click()
    const reverse = page.getByRole('dialog', { name: 'Reverse posted entry', exact: true })
    await reverse.getByLabel('Reversal date', { exact: true }).fill(date)
    await reverse.getByLabel('Reversal description (optional)', { exact: true }).fill('Counter-entry ' + description)
    await reverse.getByRole('button', { name: 'Reverse entry', exact: true }).click(); await expect(reverse).toBeHidden()
    await expect(row).toHaveCount(1)
    await expect(row.getByRole('button', { name: 'Reverse', exact: true })).toHaveCount(0)
    const after = await one('journal_entries', { id: source.id })
    expect(after.status).toBe('reversed'); expect(after.reversed_entry_id).toBeTruthy()
    expect(after.entry_ref).toBe(source.entry_ref); expect(after.description_ar).toBe(description); expect(after.entry_date).toBe(date)
    expect(after.posted_at).toBe(posted.posted_at); expect(await readLines(source.id)).toEqual(originalLines)
    const counter = await one('journal_entries', { id: after.reversed_entry_id })
    expect(counter.status).toBe('posted'); expect(counter.entry_type).toBe('reversal'); expect(counter.reversal_of_entry_id).toBe(source.id)
    assertCounterEntry(originalLines, await readLines(counter.id))
    const matches = await admin.from('journal_entries').select('id').eq('tenant_id', tenantId).eq('reversal_of_entry_id', source.id)
    if (matches.error || matches.data.length !== 1) throw Error('Expected exactly one reversal')
    const audit = await admin.from('audit_log').select('action').eq('tenant_id', tenantId).eq('entity_id', source.id)
    if (audit.error) throw Error('Journal audit unavailable')
    for (const [action, count] of [['journal_draft_created', 1], ['journal_submitted_for_approval', 2], ['journal_rejected', 1], ['journal_approved', 1], ['journal_reversed', 1]]) {
      expect(audit.data.filter(entry => entry.action === action)).toHaveLength(count)
    }
    await page.reload(); await page.getByRole('searchbox', { name: 'Search ledger', exact: true }).fill(description)
    await expect(row).toHaveCount(1)
    await expect(row.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
    await expect(row.getByRole('button', { name: 'Reverse', exact: true })).toHaveCount(0)
    console.log(JSON.stringify({ check: 'manual journal submit/reject/resubmit/approve/post/exact reversal and retained audit', result: 'PASS' }))
    return { periodId: posted.period_id, date, journalId: source.id }
  } catch (error) {
    console.error(JSON.stringify({ check: 'manual journal review lifecycle', stage, errorType: error.name }))
    throw Error('Journal review lifecycle failed: ' + stage)
  }
}
