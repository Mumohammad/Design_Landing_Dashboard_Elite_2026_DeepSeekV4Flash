import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

// Synthetic contract tests; called only by the owned native-cluster harness.
export async function verifyInvoiceNotes(ctx) {
  const { sql, tenant, actor, foreignActor, colleague, unprivileged, customer, draft, draftInput, transition, version, context } = ctx
  let assertions = 0, stage = 'note fixtures'
  const eq = (a, b) => { assert.deepEqual(a, b); assertions++ }
  const deny = async (p, pattern) => { await assert.rejects(p, pattern); assertions++ }
  const literal = input => JSON.stringify(input).replaceAll("'", "''")
  const today = await sql("SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date")
  const yesterday = await sql("SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date-1")
  const original = async (rate = 15, type = 'sales', lines) => {
    const input = { ...draftInput(type), issue_date: yesterday, due_date: yesterday, vat_rate: rate,
      lines: lines ?? [{ description: 'Synthetic original', quantity: 1, unit_price: 100, vat_rate: rate }] }
    const row = await draft(type, input)
    await transition(row.id, 'issue', row.updated_at)
    const final = await transition(row.id, 'finalize', await version(row.id))
    const consumer = type === 'sales' ? 'dispatch_sales_finalized' : 'dispatch_purchase_approved'
    await sql(`SELECT public.${consumer}(e) FROM public.financial_events e WHERE event_id='${final.event_id}';
      UPDATE public.financial_events SET processing_status='processed',processed_at=now() WHERE event_id='${final.event_id}'`)
    return { id: row.id, updated_at: await version(row.id), event: final.event_id,
      ar: type === 'sales' ? await sql(`SELECT id FROM public.receivables WHERE source_entity_id='${row.id}'`) : null }
  }
  const details = kind => ({ reason: 'Synthetic note reason', issue_date: today,
    ...(kind === 'debit' ? { amount: 4.1, vat_rate: 15, description: 'Synthetic charge' } : {}) })
  const note = (row, kind = 'credit', request = randomUUID(), payload = details(kind), who = actor, aal = 'aal2') =>
    sql(context(who, aal) + `SELECT public.create_invoice_note_atomic('${request}','${row.id}','${row.updated_at}','${kind}','${literal(payload)}');COMMIT;`).then(JSON.parse)
  const counts = invoice => sql(`SELECT jsonb_build_object(
    'credits',(SELECT count(*) FROM public.credit_notes WHERE reference_invoice_id='${invoice}'),
    'debits',(SELECT count(*) FROM public.debit_notes WHERE reference_invoice_id='${invoice}'),
    'receipts',(SELECT count(*) FROM public.invoice_note_requests WHERE invoice_id='${invoice}'),
    'events',(SELECT count(*) FROM public.financial_events WHERE payload->>'reference_invoice_id'='${invoice}'),
    'audit',(SELECT count(*) FROM public.audit_log WHERE new_values->>'reference_invoice_id'='${invoice}' AND action IN('credit_note_issued','debit_note_issued')),
    'status',(SELECT status FROM public.invoices WHERE id='${invoice}'),
    'active_ar',(SELECT count(*) FROM public.receivables WHERE source_entity_id='${invoice}' AND deleted_at IS NULL))`).then(JSON.parse)
  try {
    stage = 'service receipt ACL and browser-role isolation'
    // The synthetic cluster has no Supabase default grants. Supply only the
    // ordinary source reads used before duplicate detection; the migration
    // itself must grant the private receipt read and consumer execution.
    await sql('GRANT SELECT ON public.credit_notes,public.debit_notes,public.journal_entries TO service_role')
    eq(JSON.parse(await sql(`SELECT jsonb_build_object(
      'read',has_table_privilege('service_role','public.invoice_note_requests','SELECT'),
      'insert',has_table_privilege('service_role','public.invoice_note_requests','INSERT'),
      'update',has_table_privilege('service_role','public.invoice_note_requests','UPDATE'),
      'delete',has_table_privilege('service_role','public.invoice_note_requests','DELETE'),
      'truncate',has_table_privilege('service_role','public.invoice_note_requests','TRUNCATE'))`)),
      { read: true, insert: false, update: false, delete: false, truncate: false })
    eq(await sql('BEGIN;SET LOCAL ROLE service_role;SELECT count(*) FROM public.invoice_note_requests;COMMIT;'), '0')
    for (const role of ['anon', 'authenticated']) {
      await deny(sql(`BEGIN;SET LOCAL ROLE ${role};SELECT * FROM public.invoice_note_requests;ROLLBACK;`), /permission denied/)
      for (const kind of ['credit', 'debit']) {
        await deny(sql(`BEGIN;SET LOCAL ROLE ${role};SELECT public.dispatch_${kind}_note(NULL::public.financial_events);ROLLBACK;`), /permission denied/)
      }
    }
    for (const statement of ['INSERT INTO public.invoice_note_requests DEFAULT VALUES',
      'UPDATE public.invoice_note_requests SET actor_id=actor_id WHERE false',
      'DELETE FROM public.invoice_note_requests WHERE false']) {
      await deny(sql(`BEGIN;SET LOCAL ROLE service_role;${statement};ROLLBACK;`), /permission denied/)
    }
    stage = 'simultaneous credit and debit retries'
    for (const kind of ['credit', 'debit']) {
      const row = await original(), request = randomUUID()
      const results = await Promise.all(Array.from({ length: 6 }, () => note(row, kind, request)))
      eq(results.filter(r => !r.replayed).length, 1)
      eq(new Set(results.map(r => r.id)).size, 1)
      eq(new Set(results.map(r => r.event_id)).size, 1)
      eq(results[0].posting_status, 'posted')
      eq(await counts(row.id), { credits: kind === 'credit' ? 1 : 0, debits: kind === 'debit' ? 1 : 0, receipts: 1, events: 1, audit: 1,
        status: kind === 'credit' ? 'credited' : 'finalized', active_ar: kind === 'credit' ? 0 : 1 })
      const result = results[0], table = kind + '_notes'
      eq(JSON.parse(await sql(`SELECT jsonb_build_object('subtotal',subtotal,'vat',vat_amount,'total',total,'date',issue_date) FROM public.${table} WHERE id='${result.id}'`)),
        { subtotal: kind === 'credit' ? 100 : 4.1, vat: kind === 'credit' ? 15 : 0.62, total: kind === 'credit' ? 115 : 4.72, date: today })
      const event = JSON.parse(await sql(`SELECT jsonb_build_object('status',processing_status,'date',event_date) FROM public.financial_events WHERE event_id='${result.event_id}'`))
      eq(event, { status: 'processed', date: today })
      const total = kind === 'credit' ? 115 : 4.72
      eq(JSON.parse(await sql(`SELECT jsonb_build_object('date',j.entry_date,'lines',count(*),'debit',sum(l.debit_amount),'credit',sum(l.credit_amount))
        FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id
        WHERE j.source_entity_id='${result.id}' GROUP BY j.entry_date`)), { date: today, lines: 3, debit: total, credit: total })
      eq(JSON.parse(await sql(`SELECT jsonb_build_object('year',period_year,'month',period_month,'vat',vat_amount) FROM public.vat_adjustments WHERE source_entity_id='${result.id}'`)),
        { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)), vat: kind === 'credit' ? -15 : 0.62 })
      eq((await note(row, kind, request)).id, result.id)
      await deny(note(row, kind, request, { ...details(kind), reason: 'Different request reason' }), /INV_NOTE_RETRY/)
      await deny(note(row, kind, request, details(kind), colleague), /INV_NOTE_RETRY/)
      const replay = () => sql(`BEGIN;SET LOCAL ROLE service_role;
        SELECT public.dispatch_${kind}_note(e) FROM public.financial_events e WHERE event_id='${result.event_id}';COMMIT;`)
      eq(await replay(), 'skipped')
      // An old event has no caller-bound receipt. Even an already posted
      // journal must not silently qualify it as a safe duplicate.
      const beforeLegacyReplay = await counts(row.id)
      await deny(sql(`BEGIN;DELETE FROM public.invoice_note_requests WHERE event_id='${result.event_id}';
        SET LOCAL ROLE service_role;SELECT public.dispatch_${kind}_note(e) FROM public.financial_events e
        WHERE event_id='${result.event_id}';ROLLBACK;`), /INV_NOTE_REVIEW: (credit|debit) decision receipt required/)
      eq(await counts(row.id), beforeLegacyReplay)
      if (kind === 'debit') eq(await sql(`SELECT due_date FROM public.receivables WHERE source_entity_id='${result.id}'`), today)
      else eq(JSON.parse(await sql(`SELECT jsonb_build_object('amount',amount,'vat',vat_amount,'total',total_amount) FROM public.receivables WHERE id='${row.ar}'`)), { amount: 100, vat: 15, total: 115 })
    }
    console.log('PASS: note request retries commit exactly one note, posted journal, VAT, event, audit and receipt; dates and due dates agree')

    stage = 'zero VAT and mixed-rate full credit'
    await sql(`UPDATE public.chart_of_accounts SET deleted_at=now() WHERE tenant_id='${tenant}' AND account_code='2500'`)
    try {
      for (const kind of ['credit', 'debit']) {
        const row = await original(0), result = await note(row, kind, randomUUID(), { ...details(kind), ...(kind === 'debit' ? { vat_rate: 0 } : {}) })
        eq(await sql(`SELECT count(*) FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id WHERE j.source_entity_id='${result.id}'`), '2')
        eq(await sql(`SELECT vat_amount FROM public.vat_adjustments WHERE source_entity_id='${result.id}'`), '0.00')
      }
    } finally { await sql(`UPDATE public.chart_of_accounts SET deleted_at=NULL WHERE tenant_id='${tenant}' AND account_code='2500'`) }
    const mixed = await original(15, 'sales', [{ description: 'Zero rate', quantity: 1, unit_price: 100, vat_rate: 0 },
      { description: 'Standard rate', quantity: 1, unit_price: 100, vat_rate: 15 }])
    const mixedNote = await note(mixed)
    eq(JSON.parse(await sql(`SELECT jsonb_build_object('subtotal',subtotal,'vat',vat_amount,'total',total,'rates',jsonb_path_query_array(lines,'$[*].vat_rate')) FROM public.credit_notes WHERE id='${mixedNote.id}'`)),
      { subtotal: 200, vat: 15, total: 215, rates: [0, 15] })

    stage = 'historical customer can be fully credited but cannot receive a new debit'
    const historical = await original()
    await sql(`UPDATE public.customers SET is_active=false,deleted_at=now() WHERE id='${customer}'`)
    try {
      await deny(note(historical, 'debit'), /INV005/)
      eq((await note(historical)).posting_status, 'posted')
    } finally { await sql(`UPDATE public.customers SET is_active=true,deleted_at=NULL WHERE id='${customer}'`) }
    stage = 'full credit swaps the original journal accounts after chart code changes'
    const recoded = await original()
    await sql(`UPDATE public.chart_of_accounts SET account_code='OLD4000' WHERE tenant_id='${tenant}' AND account_code='4000'`)
    try {
      const reversal = await note(recoded)
      eq(await sql(`SELECT count(*) FROM public.journal_entry_lines r JOIN public.journal_entries j ON j.id=r.journal_entry_id
        WHERE j.source_entity_id='${reversal.id}' AND NOT EXISTS(SELECT 1 FROM public.journal_entry_lines o
          JOIN public.journal_entries orig ON orig.id=o.journal_entry_id WHERE orig.source_entity_id='${recoded.id}'
          AND o.account_id=r.account_id AND o.debit_amount=r.credit_amount AND o.credit_amount=r.debit_amount)`), '0')
    } finally { await sql(`UPDATE public.chart_of_accounts SET account_code='4000' WHERE tenant_id='${tenant}' AND account_code='OLD4000'`) }
    stage = 'forced outbox, journal, VAT and audit failures roll everything back'
    for (const kind of ['credit', 'debit']) {
      for (const target of ['financial_events', 'journal_entries', 'vat_adjustments', 'audit_log']) {
        const row = await original(), request = randomUUID(), fault = 'note_fault_' + randomUUID().replaceAll('-', '')
        const before = await counts(row.id)
        await sql(`CREATE FUNCTION public.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic note fault';END$$;
          CREATE TRIGGER ${fault} BEFORE INSERT ON public.${target} FOR EACH ROW EXECUTE FUNCTION public.${fault}();`)
        try { await deny(note(row, kind, request), /synthetic note fault/) }
        finally { await sql(`DROP TRIGGER ${fault} ON public.${target};DROP FUNCTION public.${fault}();`) }
        eq(await counts(row.id), before)
        eq((await note(row, kind, request)).replayed, false)
      }
    }
    console.log('PASS: forced event, journal, VAT and audit failures restore invoice state/AR and leave no note, receipt or partial effects')

    stage = 'original-posting and payment eligibility'
    const pending = await draft()
    await transition(pending.id, 'issue', pending.updated_at)
    await transition(pending.id, 'finalize', await version(pending.id))
    await deny(note({ id: pending.id, updated_at: await version(pending.id) }), /INV_NOTE_POSTING/)
    const paid = await original()
    await sql(`UPDATE public.receivables SET paid_amount=1 WHERE id='${paid.ar}'`)
    await deny(note(paid), /INV007/)
    const missingVat = await original()
    await sql(`DELETE FROM public.vat_output_ledger WHERE source_entity_id='${missingVat.id}'`)
    await deny(note(missingVat), /INV_NOTE_REVIEW/)
    const archivedGl = await original()
    await sql(`UPDATE public.journal_entries SET deleted_at=now() WHERE source_entity_id='${archivedGl.id}'`)
    await deny(note(archivedGl), /INV_NOTE_REVIEW/)
    const badGl = await original()
    await sql(`UPDATE public.journal_entry_lines SET debit_amount=debit_amount+1 WHERE journal_entry_id IN(SELECT id FROM public.journal_entries WHERE source_entity_id='${badGl.id}') AND debit_amount>0`)
    await deny(note(badGl), /INV_NOTE_REVIEW/)
    const purchase = await original(15, 'purchase')
    await deny(note(purchase), /INV_NOTE_POSTING|INV_NOTE_REFERENCE/)
    const active = await original()
    await deny(note({ ...active, updated_at: '2000-01-01T00:00:00Z' }), /INV015/)
    await deny(note(active, 'credit', randomUUID(), details('credit'), foreignActor), /INV_NOTE_POSTING/)
    await deny(note(active, 'credit', randomUUID(), details('credit'), unprivileged), /AUTH007/)
    await deny(note(active, 'credit', randomUUID(), details('credit'), actor, 'aal1'), /AUTH007/)
    await sql(`UPDATE public.users SET must_change_password=true WHERE auth_user_id='${actor}'`)
    try { await deny(note(active), /AUTH007/) }
    finally { await sql(`UPDATE public.users SET must_change_password=false WHERE auth_user_id='${actor}'`) }
    for (const role of ['anon', 'service_role']) await deny(sql(`BEGIN;SET LOCAL ROLE ${role};SELECT public.create_invoice_note_atomic(gen_random_uuid(),'${active.id}',now(),'credit','{}');ROLLBACK;`), /permission denied/)
    await deny(sql(context() + 'SELECT * FROM public.invoice_note_requests;ROLLBACK;'), /permission denied/)
    await deny(sql(context() + `INSERT INTO public.credit_notes(tenant_id) VALUES('${tenant}');ROLLBACK;`), /permission denied/)
    await deny(sql(context() + `INSERT INTO public.debit_notes(tenant_id) VALUES('${tenant}');ROLLBACK;`), /permission denied/)

    stage = 'strict amounts, dates, fields and closed periods'
    for (const override of [{ amount: 0 }, { amount: 0.001 }, { amount: 4.101 }, { amount: 100000000 }, { amount: '4.1' },
      { vat_rate: null }, { vat_rate: '15' }, { vat_rate: -1 }, { vat_rate: 101 }, { vat_rate: 15.001 },
      { issue_date: '2026-02-30' }, { issue_date: '2000-01-01' }, { issue_date: '9999-12-31' }, { reason: 'no' },
      { reason: 'x'.repeat(501) }, { reason: 12345 }, { description: null }, { lines: [] }, { tenant_id: tenant }]) {
      await deny(note(active, 'debit', randomUUID(), { ...details('debit'), ...override }), /INV_NOTE_INPUT/)
    }
    for (const table of ['accounting_periods', 'vat_periods']) {
      await sql(`UPDATE public.${table} SET status='closed' WHERE tenant_id='${tenant}' AND period_year=${Number(today.slice(0, 4))} AND period_month=${Number(today.slice(5, 7))}`)
      try { await deny(note(active), /ACC001|VAT001/) }
      finally { await sql(`UPDATE public.${table} SET status='open' WHERE tenant_id='${tenant}' AND period_year=${Number(today.slice(0, 4))} AND period_month=${Number(today.slice(5, 7))}`) }
    }
    await sql(`UPDATE public.accounting_periods SET deleted_at=now() WHERE tenant_id='${tenant}' AND period_year=${Number(today.slice(0, 4))} AND period_month=${Number(today.slice(5, 7))}`)
    try { await deny(note(active), /ACC001/) }
    finally { await sql(`UPDATE public.accounting_periods SET deleted_at=NULL WHERE tenant_id='${tenant}' AND period_year=${Number(today.slice(0, 4))} AND period_month=${Number(today.slice(5, 7))}`) }
    stage = 'Data API cannot duplicate, alter or reopen managed receivables'
    await sql('GRANT SELECT,INSERT,UPDATE,DELETE ON public.receivables TO authenticated')
    await deny(sql(context() + `UPDATE public.receivables SET amount=amount+1 WHERE id='${active.ar}';COMMIT;`), /INV_MANAGED_AR/)
    await deny(sql(context() + `UPDATE public.receivables SET source_entity_type='manual' WHERE id='${active.ar}';COMMIT;`), /INV_MANAGED_AR/)
    await deny(sql(context() + `DELETE FROM public.receivables WHERE id='${active.ar}';COMMIT;`), /INV_MANAGED_AR/)
    await deny(sql(context() + `INSERT INTO public.receivables(tenant_id,invoice_ref,invoice_date,due_date,source_entity_type,source_entity_id)
      VALUES('${tenant}','Synthetic duplicate','${today}','${today}','invoice','${active.id}');COMMIT;`), /INV_MANAGED_AR/)
    await sql('GRANT SELECT,INSERT,UPDATE,DELETE ON public.payables TO authenticated')
    await deny(sql(context() + `INSERT INTO public.payables(tenant_id,invoice_ref,invoice_date,due_date,source_entity_type,source_entity_id)
      VALUES('${tenant}','Synthetic duplicate','${today}','${today}','purchase_invoice','${active.id}');COMMIT;`), /INV_MANAGED_AP/)
    const archived = await original(), archivedCredit = await note(archived)
    await deny(sql(context() + `UPDATE public.receivables SET deleted_at=NULL WHERE id='${archived.ar}';COMMIT;`), /INV_MANAGED_AR/)
    eq(archivedCredit.posting_status, 'posted')
    const waitForBarrier = async key => {
      const deadline = Date.now() + 10000
      while (Date.now() < deadline) {
        if (Number(await sql(`SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=${key} AND granted`))) return
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      throw Error('Synthetic transaction barrier not reached')
    }
    const payment = (row, key, wait = false) => {
      const id = randomUUID()
      return sql(`BEGIN;INSERT INTO public.finance_payments(id,tenant_id,direction,customer_id,status)
        VALUES('${id}','${tenant}','in','${customer}','pending');
        INSERT INTO public.payment_allocations(id,tenant_id,finance_payment_id,receivable_id,allocated_amount)
        VALUES(gen_random_uuid(),'${tenant}','${id}','${row.ar}',1);
        ${wait ? `SELECT pg_advisory_xact_lock(${key});SELECT pg_sleep(2);` : ''}COMMIT;`)
    }
    stage = 'a winning payment reservation blocks full credit'
    const reserved = await original(), barrier = 5944901
    const reserveFirst = payment(reserved, barrier, true)
    await waitForBarrier(barrier)
    await deny(note(reserved), /INV_NOTE_RESERVED/)
    await reserveFirst
    eq((await counts(reserved.id)).credits, 0)
    stage = 'a winning credit blocks a fresh payment allocation'
    const credited = await original(), request = randomUUID(), secondBarrier = 5944902
    const creditFirst = sql(context() + `SELECT public.create_invoice_note_atomic('${request}','${credited.id}','${credited.updated_at}','credit','${literal(details('credit'))}');
      SELECT pg_advisory_xact_lock(${secondBarrier});SELECT pg_sleep(2);COMMIT;`)
    await waitForBarrier(secondBarrier)
    await deny(payment(credited), /PMT001/)
    await creditFirst
    eq((await counts(credited.id)).credits, 1)
    stage = 'separate debit balance survives a full base credit'
    const separate = await original(), debit = await note(separate, 'debit')
    await note(separate)
    eq(await sql(`SELECT total_amount FROM public.receivables WHERE source_entity_id='${debit.id}' AND deleted_at IS NULL`), '4.72')
    console.log(`PASS: ${assertions} note SQL assertions, including service-role duplicate/legacy dispatch, receipt ACL, real payment-allocation races, complete rollback, original evidence, strict money/dates, tenancy/MFA, mixed rates and separate debit balances`)
    return assertions
  } catch (error) { error.verificationStage = stage; throw error }
}
