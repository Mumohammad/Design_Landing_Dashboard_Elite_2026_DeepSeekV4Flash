import { expect as baseExpect } from '@playwright/test'
import { assertModuleTestTarget } from './assert-module-test-target.mjs'
import { assertCounterEntry, balancedLines, minorUnits } from './lib/finance-verification-contracts.mjs'
const expect = baseExpect.configure({ timeout: 30_000 })
/** Call immediately after verifyAccountingPages records its real SAR1 receipt.
 * The caller supplies its exact owned payment and manual receivable IDs. */
export async function verifyPaymentVoidLifecycle(page, admin, tenantId, appUrl, { paymentId, receivableId }) {
  await assertModuleTestTarget(page, admin.supabaseUrl, appUrl)
  let stage = 'read posted receipt and immutable allocation', stale
  const one = async (table, id, fields) => {
    const result = await admin.from(table).select(fields).eq('tenant_id', tenantId).eq('id', id).single()
    if (result.error) throw Error('Owned ' + table + ' read failed')
    return result.data
  }
  const lines = async id => {
    const result = await admin.from('journal_entry_lines').select('id,account_id,description,debit_amount,credit_amount')
      .eq('tenant_id', tenantId).eq('journal_entry_id', id).order('id')
    if (result.error) throw Error('Owned payment journal lines unavailable')
    balancedLines(result.data); return result.data
  }
  const entries = async type => {
    const result = await admin.from('journal_entries').select('id,status,entry_type,source_entity_type,source_entity_id')
      .eq('tenant_id', tenantId).eq('source_entity_type', 'payment').eq('source_entity_id', paymentId).eq('entry_type', type)
    if (result.error) throw Error('Owned payment postings unavailable')
    return result.data
  }
  const open = async target => {
    await target.goto(appUrl + '/accounting?lang=en'); await target.getByRole('tab', { name: 'Payments', exact: true }).click()
    const card = target.locator('[data-slot="card"]').filter({ has: target.getByText('Finance payments', { exact: true }) })
    await card.getByRole('searchbox', { name: 'Search records', exact: true }).fill(payment.payment_ref)
    const row = card.locator('tbody tr').filter({ has: target.getByRole('cell', { name: payment.payment_ref, exact: true }) })
    await expect(row).toHaveCount(1); return row
  }
  let payment
  try {
    payment = await one('finance_payments', paymentId, 'id,payment_ref,status,amount,direction,reference')
    if (!payment.reference?.startsWith('PAGE136-') || !payment.reference.endsWith(' posted receipt')) throw Error('Exact caller-owned receipt required')
    expect(payment.status).toBe('allocated'); expect(payment.direction).toBe('in'); expect(minorUnits(payment.amount)).toBe(100n)
    const ar = await one('receivables', receivableId, 'id,status,paid_amount,total_amount,source_entity_type,invoice_ref')
    if (!ar.invoice_ref.startsWith('PAGE136-') || ar.source_entity_type === 'invoice') throw Error('Owned manual receivable required')
    expect(ar.status).toBe('paid'); expect(minorUnits(ar.paid_amount)).toBe(100n)
    const allocations = await admin.from('payment_allocations').select('id,receivable_id,allocated_amount').eq('tenant_id', tenantId).eq('finance_payment_id', paymentId).order('id')
    if (allocations.error || allocations.data.length !== 1 || allocations.data[0].receivable_id !== receivableId || minorUnits(allocations.data[0].allocated_amount) !== 100n) throw Error('Exact owned allocation required')
    const original = await entries('bank'); expect(original).toHaveLength(1); expect(original[0].status).toBe('posted')
    const originalLines = await lines(original[0].id)
    expect(await entries('reversal')).toHaveLength(0)
    stale = await page.context().newPage(); const staleRow = await open(stale)
    await staleRow.getByRole('button', { name: 'Void', exact: true }).click()
    await expect(staleRow.getByRole('button', { name: 'Confirm?', exact: true })).toBeVisible()
    stage = 'normal UI void and stale confirmation replay'
    const row = await open(page); await row.getByRole('button', { name: 'Void', exact: true }).click()
    // Arm the stale confirmation again after the first navigation so its4s
    // safety timeout cannot accidentally convert this into an untested click.
    if (await staleRow.getByRole('button', { name: 'Void', exact: true }).count()) await staleRow.getByRole('button', { name: 'Void', exact: true }).click()
    await row.getByRole('button', { name: 'Confirm?', exact: true }).click()
    await expect(row.getByRole('button', { name: 'Void', exact: true })).toHaveCount(0)
    await expect(row).toHaveCount(1)
    await expect.poll(async () => (await one('finance_payments', paymentId, 'status')).status).toBe('void')
    // Explicit stale-page retry must be a second real server action. Re-arm
    // its still-old UI if necessary, then let the same idempotent contract run.
    if (await staleRow.getByRole('button', { name: 'Void', exact: true }).count()) await staleRow.getByRole('button', { name: 'Void', exact: true }).click()
    const replayRequest = stale.waitForRequest(request => request.method() === 'POST' && !!request.headers()['next-action'] && (request.postData() ?? '').includes(paymentId))
    await staleRow.getByRole('button', { name: 'Confirm?', exact: true }).click()
    await replayRequest
    await expect(staleRow).toHaveCount(1)
    await expect(staleRow.getByRole('button', { name: 'Void', exact: true })).toHaveCount(0)
    const after = await one('receivables', receivableId, 'status,paid_amount,total_amount')
    expect(after.status).toBe('open'); expect(minorUnits(after.paid_amount)).toBe(0n); expect(minorUnits(after.total_amount)).toBe(minorUnits(ar.total_amount))
    const reversals = await entries('reversal'); expect(reversals).toHaveLength(1); expect(reversals[0].status).toBe('posted')
    assertCounterEntry(originalLines, await lines(reversals[0].id))
    expect(await lines(original[0].id)).toEqual(originalLines)
    const retained = await admin.from('payment_allocations').select('id,receivable_id,allocated_amount').eq('tenant_id', tenantId).eq('finance_payment_id', paymentId).order('id')
    if (retained.error) throw Error('Retained allocation unavailable')
    expect(retained.data).toEqual(allocations.data)
    const events = await admin.from('financial_events').select('id,processing_status').eq('tenant_id', tenantId).eq('source_id', paymentId).eq('event_type', 'PaymentVoidedEvent')
    const audit = await admin.from('audit_log').select('id').eq('tenant_id', tenantId).eq('entity_id', paymentId).eq('action', 'payment_voided')
    if (events.error || audit.error) throw Error('Payment void evidence unavailable')
    expect(events.data).toHaveLength(1); expect(events.data[0].processing_status).toBe('processed'); expect(audit.data).toHaveLength(1)
    console.log(JSON.stringify({ check: 'UI payment void/stale replay, exact reversal and receivable restoration with one audit/event', result: 'PASS' }))
  } catch (error) {
    console.error(JSON.stringify({ check: 'payment void lifecycle', stage, errorType: error.name }))
    throw Error('Payment void acceptance failed: ' + stage)
  } finally { if (stale) await stale.close() }
}
