import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

// Exported only for the owned synthetic native-cluster harness. No connection
// setup, environment-file access, hosted data, or standalone execution.
export async function verifyInvoiceCancellation(ctx) {
  const { sql, tenant, actor, foreignActor, colleague, unprivileged, customer, draft, draftInput, transition, version, context } = ctx
  let assertions = 0, stage = 'cancellation fixtures'
  const eq = (a,b) => { assert.deepEqual(a,b); assertions++ }
  const deny = async (promise,pattern) => { await assert.rejects(promise,pattern); assertions++ }
  const text = value => value == null ? 'NULL' : "'" + value.replaceAll("'","''") + "'"
  const reason = 'Synthetic cancellation reason'
  const cancel = (row,why=reason,who=actor,aal='aal2',expected=row.updated_at) => sql(context(who,aal) +
    `SELECT public.cancel_unposted_invoice_atomic('${row.id}',${text(expected)},${text(why)});COMMIT;`).then(JSON.parse)
  const fixture = async (type='sales',state='draft') => {
    const row = await draft(type,draftInput(type))
    if (state !== 'draft') await transition(row.id,'issue',row.updated_at)
    return { id:row.id,updated_at:await version(row.id) }
  }
  const counts = id => sql(`SELECT jsonb_build_object('status',i.status,'reason',i.cancel_reason,
    'actor',i.cancelled_by,'updated_by',i.updated_by,'timestamp',i.cancelled_at IS NOT NULL,
    'events',(SELECT count(*) FROM public.financial_events WHERE source_id=i.id),
    'audit',(SELECT count(*) FROM public.audit_log WHERE entity_id=i.id AND action='invoice_cancelled'),
    'receipts',(SELECT count(*) FROM public.invoice_transition_receipts WHERE invoice_id=i.id AND operation='cancel'),
    'finalizations',(SELECT count(*) FROM public.invoice_transition_receipts WHERE invoice_id=i.id AND operation='finalize'),
    'payables',(SELECT count(*) FROM public.payables WHERE source_entity_id=i.id)) FROM public.invoices i WHERE id='${id}'`).then(JSON.parse)
  const snapshot = id => sql(`SELECT jsonb_build_object('invoice',to_jsonb(i),
    'audits',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM public.audit_log a WHERE entity_id=i.id),
    'receipts',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.operation),'[]'::jsonb) FROM public.invoice_transition_receipts r WHERE invoice_id=i.id),
    'events',(SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) FROM public.financial_events e WHERE source_id=i.id))
    FROM public.invoices i WHERE id='${id}'`)
  const waitForBarrier = async key => {
    const deadline = Date.now()+10000
    while (Date.now()<deadline) {
      if (await sql(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=${key} AND granted)`) === 't') return
      await new Promise(resolve=>setTimeout(resolve,20))
    }
    throw Error('Synthetic cancellation lock barrier was not observed')
  }
  const barrier = () => parseInt(randomUUID().replaceAll('-','').slice(0,7),16)
  try {
    stage = 'financial event table writes remain private to guarded producers'
    for (const role of ['authenticated','anon','service_role']) {
      eq(await sql(`SELECT has_table_privilege('${role}','public.financial_events','SELECT'),
        has_table_privilege('${role}','public.financial_events','INSERT'),
        has_table_privilege('${role}','public.financial_events','UPDATE'),
        has_table_privilege('${role}','public.financial_events','DELETE')`),role==='service_role'?'t|t|t|t':'t|f|f|f')
    }
    await deny(sql(context()+`INSERT INTO public.financial_events(tenant_id,event_id,idempotency_key,source_type,source_id,event_type,event_date,payload)
      VALUES('${tenant}',gen_random_uuid(),'blocked-cancel-fixture:${randomUUID()}','invoice',gen_random_uuid(),'InvoiceFinalizedEvent','2026-10-21','{}');COMMIT;`),/permission denied/)
    stage = 'simultaneous draft and issued cancellation retries'
    for (const type of ['sales','purchase']) {
      for (const state of ['draft','issued']) {
        const row = await fixture(type,state)
        const results = await Promise.all(Array.from({length:6},()=>cancel(row,' \t'+reason+'\n ')))
        eq(results.filter(result=>!result.replayed).length,1)
        eq(results.filter(result=>result.replayed).length,5)
        eq(new Set(results.map(result=>result.id)).size,1)
        eq(results.every(result=>result.id===row.id && result.operation==='cancel'),true)
        eq(await counts(row.id),{status:'cancelled',reason,actor,updated_by:actor,timestamp:true,events:0,audit:1,receipts:1,finalizations:0,payables:0})
        eq(await sql(`SELECT input_reason,event_id IS NULL FROM public.invoice_transition_receipts WHERE invoice_id='${row.id}' AND operation='cancel'`),reason+'|t')
        eq((await cancel(row)).replayed,true)
        await deny(cancel(row,'A different cancellation reason'),/INV015/)
        await deny(cancel(row,reason,colleague),/INV015/)
        await deny(cancel(row,reason,actor,'aal2',await version(row.id)),/INV015/)
      }
    }
    console.log('PASS: draft/issued sales and purchase cancellation retries commit one audit/receipt, preserve exact review identity, and emit no financial event')

    stage = 'version, reason, tenancy, identity and role checks'
    const guarded = await fixture()
    const beforeGuard = await snapshot(guarded.id)
    await deny(cancel(guarded,reason,actor,'aal2',null),/INV015/)
    await deny(cancel(guarded,reason,actor,'aal2','2000-01-01T00:00:00Z'),/INV015/)
    for (const why of [null,'','    ','four','x'.repeat(501)]) await deny(cancel(guarded,why),/INV002/)
    await deny(cancel(guarded,reason,foreignActor),/INV001/)
    await deny(cancel(guarded,reason,unprivileged),/AUTH007/)
    await deny(cancel(guarded,reason,actor,'aal1'),/AUTH007/)
    await deny(sql(`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claims='{"role":"authenticated","aal":"aal2"}';
      SELECT public.cancel_unposted_invoice_atomic('${guarded.id}','${guarded.updated_at}','${reason}');ROLLBACK;`),/AUTH007/)
    for (const change of ['must_change_password=true',"status='inactive'","locked_until=now()+interval '1 hour'",'deleted_at=now()']) {
      await sql(`UPDATE public.users SET ${change} WHERE auth_user_id='${actor}'`)
      try { await deny(cancel(guarded),/AUTH007/) }
      finally { await sql(`UPDATE public.users SET must_change_password=false,status='active',locked_until=NULL,deleted_at=NULL WHERE auth_user_id='${actor}'`) }
    }
    for (const role of ['anon','service_role']) await deny(sql(`BEGIN;SET LOCAL ROLE ${role};
      SELECT public.cancel_unposted_invoice_atomic('${guarded.id}','${guarded.updated_at}','${reason}');ROLLBACK;`),/permission denied/)
    await deny(sql(context()+'SELECT * FROM public.invoice_transition_receipts;ROLLBACK;'),/permission denied/)
    eq(await snapshot(guarded.id),beforeGuard)
    for (const length of [5,500]) eq((await cancel(await fixture(),'x'.repeat(length))).replayed,false)
    const edited = await fixture()
    await sql(`UPDATE public.invoice_lines SET description='Synthetic newer version' WHERE invoice_id='${edited.id}'`)
    await deny(cancel(edited),/INV015/)
    const deleted = await fixture()
    await sql(`UPDATE public.invoices SET deleted_at=now() WHERE id='${deleted.id}'`)
    await deny(cancel(deleted),/INV001/)
    const historical = await fixture()
    await sql(`UPDATE public.invoices SET status='cancelled' WHERE id='${historical.id}'`)
    await deny(cancel({...historical,updated_at:await version(historical.id)}),/INV006/)

    stage = 'posted documents are rejected without waiting for parent or AR locks'
    const posted = []
    for (const state of ['finalized','paid','partially_paid','overdue','credited']) {
      const row = await fixture('sales','issued')
      await transition(row.id,'finalize',row.updated_at)
      if (state!=='finalized') await sql(`UPDATE public.invoices SET status='${state}' WHERE id='${row.id}'`)
      row.updated_at=await version(row.id)
      const before = await snapshot(row.id)
      await deny(cancel(row),/INV_CANCEL_POSTED/)
      eq(await snapshot(row.id),before)
      posted.push(row)
    }
    const locked = posted[0], lockKey = barrier()
    const heldParent = sql(`BEGIN;SELECT id FROM public.invoices WHERE id='${locked.id}' FOR UPDATE;
      SELECT pg_advisory_xact_lock(${lockKey});SELECT pg_sleep(2);COMMIT;`)
    await waitForBarrier(lockKey)
    try { await deny(sql(context()+`SET LOCAL lock_timeout='250ms';SELECT public.cancel_unposted_invoice_atomic('${locked.id}','${locked.updated_at}','${reason}');COMMIT;`),/INV_CANCEL_POSTED/) }
    finally { await heldParent }

    stage = 'forced cancellation audit failure restores all state'
    for (const state of ['draft','issued']) {
      const row = await fixture('sales',state),fault = 'cancel_fault_'+randomUUID().replaceAll('-','')
      const before = await snapshot(row.id)
      await sql(`CREATE FUNCTION public.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
        IF NEW.entity_id='${row.id}' AND NEW.action='invoice_cancelled' THEN RAISE EXCEPTION 'synthetic cancellation audit fault';END IF;RETURN NEW;END$$;
        CREATE TRIGGER ${fault} BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.${fault}();`)
      try { await deny(cancel(row),/synthetic cancellation audit fault/) }
      finally { await sql(`DROP TRIGGER ${fault} ON public.audit_log;DROP FUNCTION public.${fault}();`) }
      eq(await snapshot(row.id),before)
      eq((await cancel(row)).replayed,false)
    }

    stage = 'competing issuance and finalization decisions'
    const cancellingDraft = await fixture(), cancelKey = barrier()
    const cancellationFirst = sql(context()+`SELECT public.cancel_unposted_invoice_atomic('${cancellingDraft.id}','${cancellingDraft.updated_at}','${reason}');
      SELECT pg_advisory_xact_lock(${cancelKey});SELECT pg_sleep(2);COMMIT;`)
    await waitForBarrier(cancelKey)
    try { await deny(transition(cancellingDraft.id,'issue',cancellingDraft.updated_at),/INV006/) }
    finally { await cancellationFirst }
    eq((await counts(cancellingDraft.id)).events,0)
    eq((await counts(cancellingDraft.id)).audit,1)
    const issuing = await fixture(),issueKey = barrier()
    const issuanceFirst = sql(context()+`SELECT public.transition_my_invoice('${issuing.id}','issue','${issuing.updated_at}');
      SELECT pg_advisory_xact_lock(${issueKey});SELECT pg_sleep(2);COMMIT;`)
    await waitForBarrier(issueKey)
    try { await deny(cancel(issuing),/INV015/) }
    finally { await issuanceFirst }
    const issuedCounts = await counts(issuing.id)
    eq([issuedCounts.status,issuedCounts.events,issuedCounts.audit,issuedCounts.receipts],['issued',0,0,0])
    eq((await cancel({...issuing,updated_at:await version(issuing.id)})).replayed,false)
    for (const type of ['sales','purchase']) {
      const cancelling = await fixture(type,'issued'),firstKey = barrier()
      const cancelFirst = sql(context()+`SELECT public.cancel_unposted_invoice_atomic('${cancelling.id}','${cancelling.updated_at}','${reason}');
        SELECT pg_advisory_xact_lock(${firstKey});SELECT pg_sleep(2);COMMIT;`)
      await waitForBarrier(firstKey)
      try { await deny(transition(cancelling.id,'finalize',cancelling.updated_at),/INV006/) }
      finally { await cancelFirst }
      const cancelledCounts = await counts(cancelling.id)
      eq([cancelledCounts.status,cancelledCounts.events,cancelledCounts.audit,cancelledCounts.receipts,cancelledCounts.payables],['cancelled',0,1,1,0])
      const finalizing = await fixture(type,'issued'),secondKey = barrier()
      const finalizationFirst = sql(context()+`SELECT public.transition_my_invoice('${finalizing.id}','finalize','${finalizing.updated_at}');
        SELECT pg_advisory_xact_lock(${secondKey});SELECT pg_sleep(2);COMMIT;`)
      await waitForBarrier(secondKey)
      try { await deny(cancel(finalizing),/INV_CANCEL_POSTED/) }
      finally { await finalizationFirst }
      const finalCounts = await counts(finalizing.id)
      eq([finalCounts.status,finalCounts.events,finalCounts.audit,finalCounts.receipts,finalCounts.finalizations,finalCounts.payables],
        ['finalized',1,0,0,1,type==='purchase'?1:0])
    }
    console.log('PASS: cancellation/issue/finalize races have one complete outcome and never create partial cancellation or financial effects')

    stage = 'historical accounting evidence is rejected without repair'
    const foreignTenant = await sql(`SELECT tenant_id FROM public.users WHERE auth_user_id='${foreignActor}'`)
    const evidence = [
      row=>`INSERT INTO public.financial_events(tenant_id,event_id,idempotency_key,source_type,source_id,event_type,event_date,payload)
        VALUES('${foreignTenant}',gen_random_uuid(),'cancel-evidence:${row.id}','invoice','${row.id}','InvoiceFinalizedEvent','2026-10-21','{}')`,
      row=>`INSERT INTO public.financial_events(tenant_id,event_id,idempotency_key,source_type,source_id,event_type,event_date,payload)
        VALUES('${tenant}',gen_random_uuid(),'cancel-note-evidence:${row.id}','credit_note',gen_random_uuid(),'CreditNoteIssuedEvent','2026-10-21',jsonb_build_object('reference_invoice_id','${row.id}'))`,
      row=>`INSERT INTO public.journal_entries(tenant_id,entry_date,entry_type,status,source_entity_type,source_entity_id)
        VALUES('${foreignTenant}','2026-10-21','invoice','draft','invoice','${row.id}')`,
      ...['receivables','payables'].map(table=>row=>`INSERT INTO public.${table}(tenant_id,invoice_ref,invoice_date,due_date,source_entity_type,source_entity_id,deleted_at)
        VALUES('${foreignTenant}','Synthetic archived evidence','2026-10-21','2026-10-22','invoice','${row.id}',now())`),
      ...['vat_output_ledger','vat_input_ledger'].map(table=>row=>`INSERT INTO public.${table}(tenant_id,period_year,period_month,invoice_ref,invoice_date,vat_base_amount,vat_rate,vat_amount,source_entity_type,source_entity_id)
        VALUES('${foreignTenant}',2026,10,'Synthetic VAT evidence','2026-10-21',4.10,15,0.62,'invoice','${row.id}')`),
      row=>`INSERT INTO public.vat_adjustments(tenant_id,period_year,period_month,adjustment_type,direction,base_amount,vat_amount,reason,status,source_entity_type,source_entity_id,deleted_at)
        VALUES('${foreignTenant}',2026,10,'correction','output',4.10,0.62,'Synthetic archived VAT','draft','invoice','${row.id}',now())`,
      ...['credit','debit'].map(kind=>row=>`INSERT INTO public.${kind}_notes(tenant_id,${kind}_note_number,reference_invoice_id,customer_id,issue_date,reason,status)
        VALUES('${tenant}','Synthetic ${kind} ${row.id}','${row.id}','${customer}','2026-10-21','Synthetic historical note','cancelled')`),
      row=>`INSERT INTO public.invoice_transition_receipts(tenant_id,invoice_id,operation,actor_id,input_updated_at)
        VALUES('${tenant}','${row.id}','finalize','${actor}','${row.updated_at}')`,
      row=>`UPDATE public.invoices SET finalized_at=now(),finalized_by='${actor}' WHERE id='${row.id}'`,
      row=>`UPDATE public.invoices SET zatca_status='pending' WHERE id='${row.id}'`,
      row=>`UPDATE public.invoices SET zatca_uuid='Synthetic issued ZATCA document' WHERE id='${row.id}'`,
      row=>`INSERT INTO public.zatca_transmissions(tenant_id,invoice_id) VALUES('${foreignTenant}','${row.id}')`,
      row=>`INSERT INTO public.zatca_document_issuances(tenant_id,source_type,source_id) VALUES('${foreignTenant}','invoice','${row.id}')`,
    ]
    for (const insertEvidence of evidence) {
      const row = await fixture()
      await sql(insertEvidence(row))
      row.updated_at=await version(row.id)
      const before = await snapshot(row.id)
      await deny(cancel(row),/INV_CANCEL_REVIEW/)
      eq(await snapshot(row.id),before)
    }
    const blockedAr = await fixture(),arId = randomUUID(),arKey = barrier()
    await sql(`INSERT INTO public.receivables(id,tenant_id,invoice_ref,invoice_date,due_date,source_entity_type,source_entity_id)
      VALUES('${arId}','${tenant}','Synthetic locked AR','2026-10-21','2026-10-22','invoice','${blockedAr.id}')`)
    const heldAr = sql(`BEGIN;SELECT id FROM public.receivables WHERE id='${arId}' FOR UPDATE;
      SELECT pg_advisory_xact_lock(${arKey});SELECT pg_sleep(2);COMMIT;`)
    await waitForBarrier(arKey)
    try { await deny(sql(context()+`SET LOCAL lock_timeout='250ms';SELECT public.cancel_unposted_invoice_atomic('${blockedAr.id}','${blockedAr.updated_at}','${reason}');COMMIT;`),/INV_CANCEL_REVIEW/) }
    finally { await heldAr }
    console.log(`PASS: ${assertions} cancellation SQL assertions, including retry identity, RBAC/MFA, audit rollback, status/AR lock exclusion, decision races, archived and foreign-tenant accounting/ZATCA evidence`)
    return assertions
  } catch (error) { error.verificationStage=stage;throw error }
}
