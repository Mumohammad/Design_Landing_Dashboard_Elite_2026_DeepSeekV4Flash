// Runs actual invoice schema/RPC/authorization definitions on an owned,
// synthetic PostgreSQL cluster. Never reads a hosted DB URL or production data.
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { verifyInvoiceNotes } from './verify-invoice-notes-contract.mjs'
import { verifyInvoiceCancellation } from './verify-invoice-cancellation-contract.mjs'

if (process.argv[2] !== '--local-disposable') throw Error('Requires --local-disposable')
const root = path.resolve('supabase/.temp')
const data = path.join(root, `invoice-transitions-${Date.now()}-${randomUUID()}`)
const bin = path.resolve(process.env.INVOICE_TEST_PG_BIN || path.join(root, 'pg-tools/pgsql/bin'))
if (!data.startsWith(root + path.sep)) throw Error('Unsafe disposable path')
const exe = name => path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''))
const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  PGHOST: '127.0.0.1', PGPORT: '59449', PGUSER: 'postgres', PGDATABASE: 'postgres', PGPASSWORD: '' }
const run = (name, args) => {
  const fd = fs.openSync(path.join(root, 'invoice-native-' + name + '.log'), 'w')
  try {
    const result = spawnSync(exe(name), args, { env, windowsHide: true, stdio: ['ignore', fd, fd], timeout: 180000 })
    if (result.status !== 0) throw Error('Disposable PostgreSQL operation failed: ' + name)
  } finally { fs.closeSync(fd) }
}
const sql = statement => new Promise((accept, reject) => {
  const child = spawn(exe('psql'), ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let out = '', err = ''
  child.stdout.on('data', d => { out += d }); child.stderr.on('data', d => { err += d })
  child.on('error', reject); child.on('close', code => code === 0 ? accept(out.trim()) : reject(Error(err)))
  child.stdin.end(statement)
})
const migration = name => fs.readFileSync(path.join('supabase/migrations', name), 'utf8')
const functionSql = (file, name) => {
  const source = migration(file).replaceAll('\r\n', '\n')
  const start = source.indexOf('CREATE OR REPLACE FUNCTION ' + name + '(')
  const end = source.indexOf('\n$$;', start)
  if (start < 0 || end < 0) throw Error('Function source not found')
  return source.slice(start, end + 4)
}
const section = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a)
  if (a < 0 || b < 0) throw Error('Schema section not found')
  return source.slice(a, b)
}
let started = false, stage = 'local schema setup', assertions = 0
const equal = (a, b) => { assert.deepEqual(a, b); assertions++ }
const denied = async (promise, pattern) => { await assert.rejects(promise, pattern); assertions++ }
try {
  fs.mkdirSync(root, { recursive: true })
  run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '--locale=C', '-E', 'UTF8'])
  run('pg_ctl', ['-D', data, '-l', path.join(data, 'server.log'), '-o', '-p 59449 -h 127.0.0.1', '-w', 'start'])
  started = true
  // Minimal supporting relations; the invoice tables, constraints, triggers,
  // RBAC/MFA helpers and draft/transition functions below are repository SQL.
  await sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE auth.mfa_factors(user_id uuid,status text);
    CREATE TYPE public.user_role AS ENUM('general_manager','admin','accountant');
    CREATE TYPE public.user_status AS ENUM('active','inactive');
    CREATE TABLE public.tenants(id uuid PRIMARY KEY);
    CREATE TABLE public.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),auth_user_id uuid,tenant_id uuid,
      role public.user_role,status public.user_status,must_change_password bool DEFAULT false,deleted_at timestamptz,locked_until timestamptz);
    CREATE TABLE public.roles(id uuid PRIMARY KEY,tenant_id uuid,name public.user_role,deleted_at timestamptz);
    CREATE TABLE public.permissions(id uuid PRIMARY KEY,module text,action text);
    CREATE TABLE public.role_permissions(role_id uuid,permission_id uuid);
    CREATE TABLE public.customers(id uuid PRIMARY KEY,tenant_id uuid,is_active bool DEFAULT true,deleted_at timestamptz);
    CREATE TABLE public.suppliers(LIKE public.customers INCLUDING ALL);
    CREATE TABLE public.audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,actor_id uuid,
      module text,entity_type text,entity_id uuid,action text,old_values jsonb,new_values jsonb);
    CREATE TYPE public.accounting_period_status AS ENUM('open','closing','closed');
    CREATE TYPE public.journal_entry_type AS ENUM('manual','payroll','cod_settlement','invoice','expense','bank','vat','reversal','opening');
    CREATE TABLE public.chart_of_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,account_code text,deleted_at timestamptz);
    CREATE TABLE public.accounting_periods(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,period_year smallint,period_month smallint,status public.accounting_period_status,deleted_at timestamptz,UNIQUE(tenant_id,period_year,period_month));
    CREATE TABLE public.journal_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entry_ref text DEFAULT gen_random_uuid()::text,tenant_id uuid,entry_date date,period_id uuid,entry_type public.journal_entry_type,status text,description_ar text,description_en text,source_module text,source_entity_type text,source_entity_id uuid,deleted_at timestamptz,posted_at timestamptz,posted_by uuid,created_by uuid);
    CREATE TABLE public.journal_entry_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,journal_entry_id uuid,account_id uuid,description text,debit_amount numeric(12,2),credit_amount numeric(12,2));
    CREATE TABLE public.vat_output_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,period_year smallint,period_month smallint,invoice_ref text,invoice_date date,vat_base_amount numeric(12,2),vat_rate numeric(5,2),vat_amount numeric(12,2),customer_id uuid,source_entity_type text,source_entity_id uuid);
    CREATE TABLE public.vat_input_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,period_year smallint,period_month smallint,invoice_ref text,invoice_date date,vat_base_amount numeric(12,2),vat_rate numeric(5,2),vat_amount numeric(12,2),supplier_id uuid,source_entity_type text,source_entity_id uuid,vat_recoverability text);
    CREATE TYPE public.ar_ap_status AS ENUM('open','partially_paid','paid','overdue','written_off');
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claims',true)::jsonb$$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT (auth.jwt()->>'sub')::uuid$$;
    GRANT USAGE ON SCHEMA auth,public TO authenticated,anon,service_role;`)
  await sql(section(migration('009_triggers.sql'), 'CREATE OR REPLACE FUNCTION update_updated_at_column()', '--'))
  const accounting = migration('027_accounting.sql')
  await sql(section(accounting, 'CREATE TABLE receivables (', 'CREATE TABLE payables ('))
  await sql(section(accounting, 'CREATE TABLE payables (', '-- ====================================================================='))
  const engine = migration('038_invoice_engine.sql')
  await sql(section(engine, 'CREATE TYPE invoice_type', '-- 6. RLS'))
  await sql(section(migration('048_payments_engine.sql'), 'CREATE OR REPLACE FUNCTION protect_finalized_invoice()', 'CREATE OR REPLACE FUNCTION dispatch_payment_allocated'))
  await sql(migration('20260902200214_pin_search_path_security_definer_functions.sql'))
  await sql(section(migration('20261012031158_release_mfa_authorization.sql'), 'CREATE OR REPLACE FUNCTION public.has_required_assurance()', 'CREATE OR REPLACE FUNCTION public.storage_path_in_current_tenant'))
  await sql(migration('20261013144623_atomic_invoice_draft_crud.sql'))
  await sql(migration('20261021091437_invoice_lifecycle_transactions.sql'))
  await sql(functionSql('042_event_dispatcher.sql', 'resolve_coa_account'))
  await sql(functionSql('046_fix_journal_line_alias.sql', 'post_journal_entry'))
  await sql(migration('20261021091447_invoice_zero_vat_posting.sql'))

  const vatSchema = migration('041_vat_engine.sql')
  await sql(section(vatSchema, 'CREATE TABLE vat_periods (', 'ALTER TABLE vat_periods ENABLE ROW LEVEL SECURITY'))
  await sql(section(vatSchema, 'CREATE TABLE vat_adjustments (', 'ALTER TABLE vat_adjustments ENABLE ROW LEVEL SECURITY'))
  await sql(`CREATE TABLE public.finance_payments(id uuid PRIMARY KEY,tenant_id uuid,direction text,customer_id uuid,supplier_id uuid,status text,deleted_at timestamptz);
    CREATE TABLE public.payment_allocations(id uuid PRIMARY KEY,tenant_id uuid,finance_payment_id uuid,receivable_id uuid,payable_id uuid,allocated_amount numeric);`)
  await sql(section(migration('20261011101411_accounting_atomic_payments.sql'), 'CREATE OR REPLACE FUNCTION public.guard_payment_allocation()', 'CREATE OR REPLACE FUNCTION public.protect_managed_payment()'))
  await sql(`CREATE TRIGGER trg_payment_allocation_guard BEFORE INSERT OR UPDATE ON public.payment_allocations FOR EACH ROW EXECUTE FUNCTION public.guard_payment_allocation();`)
  await sql(migration('20261021091457_invoice_note_transactions.sql'))
  await sql(`ALTER TABLE public.invoices ADD COLUMN zatca_status text DEFAULT 'not_transmitted',ADD COLUMN zatca_uuid text;
    CREATE TABLE public.zatca_transmissions(tenant_id uuid,invoice_id uuid);
    CREATE TABLE public.zatca_document_issuances(tenant_id uuid,source_type text,source_id uuid);
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.financial_events TO authenticated,anon,service_role;`)
  await sql(migration('20261021091516_invoice_unposted_cancellation_atomic.sql'))
  await sql(migration('20261021091526_guard_legacy_invoice_cancellation_events.sql'))

  const tenant = randomUUID(), foreignTenant = randomUUID(), actor = randomUUID(), foreignActor = randomUUID()
  const colleague = randomUUID(), unprivileged = randomUUID(), customer = randomUUID(), supplier = randomUUID(), foreignCustomer = randomUUID()
  await sql(`INSERT INTO public.tenants VALUES('${tenant}'),('${foreignTenant}');
    INSERT INTO auth.users VALUES('${actor}'),('${foreignActor}'),('${colleague}'),('${unprivileged}');
    INSERT INTO public.users(auth_user_id,tenant_id,role,status) VALUES
      ('${actor}','${tenant}','general_manager','active'),('${colleague}','${tenant}','general_manager','active'),
      ('${foreignActor}','${foreignTenant}','general_manager','active'),('${unprivileged}','${tenant}','accountant','active');
    INSERT INTO public.customers(id,tenant_id) VALUES('${customer}','${tenant}'),('${foreignCustomer}','${foreignTenant}');
    INSERT INTO public.suppliers(id,tenant_id) VALUES('${supplier}','${tenant}');`)
  const context = (who = actor, aal = 'aal2') => `BEGIN;SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claims='{"sub":"${who}","role":"authenticated","aal":"${aal}"}';`
  const draftInput = (type = 'sales') => ({ invoice_type: type, customer_id: type === 'sales' ? customer : null,
    supplier_id: type === 'purchase' ? supplier : null, issue_date: '2026-10-21', due_date: '2026-10-22', currency: 'SAR',
    lines: [{ description: 'Synthetic item', quantity: 1, unit_price: 4.1, vat_rate: 15 }] })
  const draft = async (type = 'sales', payload = draftInput(type)) => JSON.parse(await sql(context() +
    `SELECT public.save_invoice_draft('${JSON.stringify(payload)}');COMMIT;`))
  const version = id => sql(`SELECT updated_at FROM public.invoices WHERE id='${id}'`)
  const transition = (id, operation, timestamp, who = actor, aal = 'aal2') => sql(context(who, aal) +
    `SELECT public.transition_my_invoice('${id}','${operation}',${timestamp ? "'" + timestamp + "'" : 'NULL'});COMMIT;`).then(JSON.parse)
  const issued = async type => { const row = await draft(type); await transition(row.id, 'issue', row.updated_at); return { id: row.id, updated_at: await version(row.id) } }
  const effects = id => sql(`SELECT jsonb_build_object('status',i.status,
    'payables',(SELECT count(*) FROM public.payables WHERE source_entity_id=i.id),
    'events',(SELECT count(*) FROM public.financial_events WHERE source_id=i.id),
    'approvals',(SELECT count(*) FROM public.audit_log WHERE entity_id=i.id AND action IN('invoice_finalized','purchase_invoice_approved')),
    'receipts',(SELECT count(*) FROM public.invoice_transition_receipts WHERE invoice_id=i.id AND operation='finalize'))
    FROM public.invoices i WHERE i.id='${id}'`).then(JSON.parse)

  stage = 'simultaneous issuance and approval retries'
  for (const type of ['sales', 'purchase']) {
    const row = await draft(type)
    const issuance = await Promise.all(Array.from({ length: 6 }, () => transition(row.id, 'issue', row.updated_at)))
    equal(issuance.filter(r => !r.replayed).length, 1)
    equal(await sql(`SELECT count(*) FROM public.audit_log WHERE entity_id='${row.id}' AND action='invoice_issued'`), '1')
    const reviewed = await version(row.id)
    const approvals = await Promise.all(Array.from({ length: 6 }, () => transition(row.id, 'finalize', reviewed)))
    equal(approvals.filter(r => !r.replayed).length, 1)
    equal(new Set(approvals.map(r => r.event_id)).size, 1)
    equal(await effects(row.id), { status: 'finalized', payables: type === 'purchase' ? 1 : 0, events: 1, approvals: 1, receipts: 1 })
    equal(JSON.parse(await sql(`SELECT payload FROM public.financial_events WHERE source_id='${row.id}'`)).total, 4.72)
    await denied(transition(row.id, 'finalize', reviewed, colleague), /INV015/)
    await denied(transition(row.id, 'finalize', row.updated_at), /INV015/)
    await denied(transition(row.id, 'issue', row.updated_at), /INV006/)
    await denied(sql(`UPDATE public.invoice_lines SET description='bypass' WHERE invoice_id='${row.id}'`), /INV003/)
    await denied(sql(`DELETE FROM public.invoice_lines WHERE invoice_id='${row.id}'`), /INV003/)
  }
  console.log('PASS: concurrent issue/approval retries produce one decision, audit, event and purchase payable')

  stage = 'audit and event fault rollback'
  for (const table of ['audit_log', 'financial_events']) {
    const row = await issued('purchase'), fault = 'invoice_fault_' + randomUUID().replaceAll('-', '')
    await sql(`CREATE FUNCTION public.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      RAISE EXCEPTION 'synthetic transaction fault'; END$$;
      CREATE TRIGGER ${fault} BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.${fault}();`)
    try { await denied(transition(row.id, 'finalize', row.updated_at), /synthetic transaction fault/) }
    finally { await sql(`DROP TRIGGER ${fault} ON public.${table};DROP FUNCTION public.${fault}();`) }
    equal(await effects(row.id), { status: 'issued', payables: 0, events: 0, approvals: 0, receipts: 0 })
    equal((await transition(row.id, 'finalize', row.updated_at)).replayed, false)
  }
  const issueFault = await draft()
  await sql(`CREATE FUNCTION public.issue_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
    IF NEW.action='invoice_issued' THEN RAISE EXCEPTION 'synthetic issue fault';END IF;RETURN NEW;END$$;
    CREATE TRIGGER issue_audit_fault BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.issue_audit_fault();`)
  try { await denied(transition(issueFault.id, 'issue', issueFault.updated_at), /synthetic issue fault/) }
  finally { await sql('DROP TRIGGER issue_audit_fault ON public.audit_log;DROP FUNCTION public.issue_audit_fault();') }
  equal(await sql(`SELECT status FROM public.invoices WHERE id='${issueFault.id}'`), 'draft')
  console.log('PASS: forced audit/outbox failures roll back status, payable, receipt and audit together')

  stage = 'draft edits race with issuance under the parent lock'
  const waitForWriter = async () => {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (Number(await sql("SELECT count(*) FROM pg_locks WHERE relation='public.invoices'::regclass AND mode='RowExclusiveLock' AND granted"))) return
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw Error('Synthetic writer lock was not observed')
  }
  const editing = await draft()
  const editFirst = sql(`BEGIN;UPDATE public.invoices SET notes='Synthetic concurrent edit' WHERE id='${editing.id}';SELECT pg_sleep(2);COMMIT;`)
  await waitForWriter()
  const issueAfterEdit = transition(editing.id, 'issue', editing.updated_at)
  await denied(issueAfterEdit, /INV015/)
  await editFirst
  equal(await sql(`SELECT status FROM public.invoices WHERE id='${editing.id}'`), 'draft')
  const issuing = await draft()
  const issueFirst = sql(context() + `SELECT public.transition_my_invoice('${issuing.id}','issue','${issuing.updated_at}');SELECT pg_sleep(2);COMMIT;`)
  await waitForWriter()
  await denied(sql(context() + `SELECT public.save_invoice_draft('${JSON.stringify(draftInput())}','${issuing.id}','${issuing.updated_at}');COMMIT;`), /INV006/)
  await issueFirst
  equal(await sql(`SELECT status FROM public.invoices WHERE id='${issuing.id}'`), 'issued')
  console.log('PASS: competing draft edits and issuance serialize; stale approval intent cannot bypass the winning edit')

  stage = 'stale version and exact line reconciliation'
  const stale = await draft()
  await sql(`UPDATE public.invoice_lines SET description='Revised item' WHERE invoice_id='${stale.id}'`)
  await denied(transition(stale.id, 'issue', stale.updated_at), /INV015/)
  const validVersion = await version(stale.id)
  await denied(transition(stale.id, 'issue', null), /INV015/)
  await denied(transition(stale.id, 'issue', validVersion, foreignActor), /INV001/)
  await transition(stale.id, 'issue', validVersion)
  await denied(sql(`UPDATE public.invoice_lines SET unit_price=5 WHERE invoice_id='${stale.id}'`), /INV003/)
  const bad = await draft()
  await sql(`UPDATE public.invoice_lines SET amount=4.11 WHERE invoice_id='${bad.id}'`)
  await denied(transition(bad.id, 'issue', await version(bad.id)), /INV004/)
  const foreign = await draft()
  await sql(`UPDATE public.invoices SET customer_id='${foreignCustomer}' WHERE id='${foreign.id}'`)
  await denied(transition(foreign.id, 'issue', await version(foreign.id)), /INV005/)
  const empty = await draft()
  await sql(`DELETE FROM public.invoice_lines WHERE invoice_id='${empty.id}'`)
  await denied(transition(empty.id, 'issue', await version(empty.id)), /INV013/)
  const zero = await draft('sales', { ...draftInput(), lines: [{ description: 'No charge', quantity: 1, unit_price: 0, vat_rate: 0 }] })
  await denied(transition(zero.id, 'issue', zero.updated_at), /INV004/)
  const fx = await draft()
  await sql(`UPDATE public.invoices SET currency='USD' WHERE id='${fx.id}'`)
  await denied(transition(fx.id, 'issue', await version(fx.id)), /INV012/)
  const max = await draft('sales', { ...draftInput(), lines: Array.from({ length: 200 }, (_, i) => ({ description: 'Item ' + i, quantity: 1, unit_price: 0.1, vat_rate: 15 })) })
  await transition(max.id, 'issue', max.updated_at)
  await transition(max.id, 'finalize', await version(max.id))
  equal(JSON.parse(await sql(`SELECT payload FROM public.financial_events WHERE source_id='${max.id}'`)).total, 24)
  console.log('PASS: stale versions, frozen issued lines, tenant parties, empty/zero/foreign-currency invoices and all 200 exact numeric lines')

  stage = 'identity, permission and history guards'
  const protectedRow = await draft()
  await denied(transition(protectedRow.id, 'issue', protectedRow.updated_at, unprivileged), /AUTH007/)
  await denied(transition(protectedRow.id, 'issue', protectedRow.updated_at, actor, 'aal1'), /AUTH007/)
  for (const guard of ["must_change_password=true", "status='inactive'", "locked_until=now()+interval '1 hour'", 'deleted_at=now()']) {
    await sql(`UPDATE public.users SET ${guard} WHERE auth_user_id='${actor}'`)
    await denied(transition(protectedRow.id, 'issue', protectedRow.updated_at), /AUTH007/)
    await sql(`UPDATE public.users SET must_change_password=false,status='active',locked_until=NULL,deleted_at=NULL WHERE auth_user_id='${actor}'`)
  }
  for (const role of ['anon', 'service_role']) await denied(sql(`BEGIN;SET LOCAL ROLE ${role};
    SELECT public.transition_my_invoice('${protectedRow.id}','issue',now());ROLLBACK;`), /permission denied/)
  await denied(sql(context() + 'SELECT * FROM public.invoice_transition_receipts;ROLLBACK;'), /permission denied/)
  await denied(sql(context() + `UPDATE public.invoices SET status='issued' WHERE id='${protectedRow.id}';ROLLBACK;`), /permission denied/)
  const partial = await issued('purchase')
  await sql(`INSERT INTO public.payables(tenant_id,invoice_ref,invoice_date,due_date,source_entity_type,source_entity_id)
    VALUES('${tenant}','Synthetic partial','2026-10-21','2026-10-22','purchase_invoice','${partial.id}')`)
  await denied(transition(partial.id, 'finalize', partial.updated_at), /INV_REVIEW/)
  equal(await sql(`SELECT status FROM public.invoices WHERE id='${partial.id}'`), 'issued')
  console.log('PASS: real RBAC/MFA helpers, identity/role guards and historical partial-effect rejection')

  stage = 'zero and standard VAT posting through the real journal function'
  await sql(`INSERT INTO public.chart_of_accounts(tenant_id,account_code)
    SELECT '${tenant}',code FROM unnest(ARRAY['1200','4000','5800','2000']) code`)
  for (const rate of [0, 15]) {
    if (rate) await sql(`INSERT INTO public.chart_of_accounts(tenant_id,account_code)
      SELECT '${tenant}',code FROM unnest(ARRAY['2500','2600']) code`)
    for (const type of ['sales', 'purchase']) {
      const row = await draft(type, { ...draftInput(type), vat_rate: rate,
        lines: [{ description: 'Posting fixture', quantity: 1, unit_price: 100, vat_rate: rate }] })
      await transition(row.id, 'issue', row.updated_at)
      await transition(row.id, 'finalize', await version(row.id))
      const consumer = type === 'sales' ? 'dispatch_sales_finalized' : 'dispatch_purchase_approved'
      const post = () => sql(`SELECT public.${consumer}(ev) FROM public.financial_events ev WHERE source_id='${row.id}'`)
      equal(await post(), 'ok')
      equal(await post(), 'skipped')
      equal(JSON.parse(await sql(`SELECT jsonb_build_object('lines',count(*),'debit',sum(l.debit_amount),'credit',sum(l.credit_amount))
        FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id WHERE j.source_entity_id='${row.id}'`)),
      { lines: rate ? 3 : 2, debit: 100 + rate, credit: 100 + rate })
      const ledger = type === 'sales' ? 'vat_output_ledger' : 'vat_input_ledger'
      equal(JSON.parse(await sql(`SELECT jsonb_build_object('base',vat_base_amount,'vat',vat_amount) FROM public.${ledger} WHERE source_entity_id='${row.id}'`)), { base: 100, vat: rate })
      const balance = type === 'sales' ? 'receivables' : 'payables'
      equal(await sql(`SELECT count(*) FROM public.${balance} WHERE source_entity_id='${row.id}'`), '1')
    }
  }
  // Strict validation remains in force for direct/manual journal callers.
  const accounts = JSON.parse(await sql(`SELECT jsonb_agg(id) FROM public.chart_of_accounts WHERE tenant_id='${tenant}' AND account_code IN('1200','4000')`))
  await denied(sql(`SELECT * FROM public.post_journal_entry('${tenant}','2026-10-21','Synthetic invalid',
    '[{"account_id":"${accounts[0]}","debit":0,"credit":0},{"account_id":"${accounts[1]}","debit":0,"credit":0}]')`), /JRN007/)
  console.log(`PASS: ${assertions} local PostgreSQL assertions including real journal/VAT/AR/AP posting, zero-VAT two-line entries, taxable three-line entries and duplicate replay`)
  stage = 'atomic note contract'
  await verifyInvoiceNotes({ sql, tenant, actor, foreignActor, colleague, unprivileged, customer, draft, draftInput, transition, version, context })
  stage = 'atomic unposted cancellation'
  await verifyInvoiceCancellation({ sql, tenant, actor, foreignActor, colleague, unprivileged, customer, draft, draftInput, transition, version, context })
  stage = 'legacy cancellation event cutover guard'
  const legacy = await issued('sales')
  const legacyFinal = await transition(legacy.id, 'finalize', legacy.updated_at)
  await sql(`SELECT public.dispatch_sales_finalized(e) FROM public.financial_events e WHERE event_id='${legacyFinal.event_id}';
    UPDATE public.financial_events SET processing_status='processed' WHERE event_id='${legacyFinal.event_id}';
    UPDATE public.invoices SET status='cancelled' WHERE id='${legacy.id}';
    INSERT INTO public.financial_events(tenant_id,event_id,idempotency_key,source_type,source_id,event_type,event_date,payload)
    VALUES('${tenant}',gen_random_uuid(),'legacy-cancellation:${legacy.id}','invoice','${legacy.id}',
      'InvoiceCancelledEvent','2026-10-21','{}');`)
  const legacyEffects = () => sql(`SELECT jsonb_build_object(
    'status',(SELECT status FROM public.invoices WHERE id='${legacy.id}'),
    'journals',(SELECT count(*) FROM public.journal_entries WHERE source_entity_id='${legacy.id}'),
    'adjustments',(SELECT count(*) FROM public.vat_adjustments WHERE source_entity_id='${legacy.id}'),
    'active_ar',(SELECT count(*) FROM public.receivables WHERE source_entity_id='${legacy.id}' AND deleted_at IS NULL),
    'event_status',(SELECT processing_status FROM public.financial_events WHERE idempotency_key='legacy-cancellation:${legacy.id}'))`)
  const beforeLegacy = await legacyEffects()
  await denied(sql(`BEGIN;SET LOCAL ROLE service_role;SELECT public.dispatch_invoice_cancelled(e)
    FROM public.financial_events e WHERE idempotency_key='legacy-cancellation:${legacy.id}';COMMIT;`), /INV_CANCEL_REVIEW/)
  equal(await legacyEffects(), beforeLegacy)
  for (const role of ['anon', 'authenticated']) {
    await denied(sql(`BEGIN;SET LOCAL ROLE ${role};SELECT public.dispatch_invoice_cancelled(NULL::public.financial_events);ROLLBACK;`), /permission denied/)
  }
  console.log('PASS: legacy cancellation events require accounting review under the service role, preserve GL/AR/VAT/source/event state, and deny browser roles')
} catch (error) {
  fs.writeFileSync(path.join(root, 'invoice-native-failure.log'), `${error.verificationStage ?? stage}\n${error.stack ?? error.message}`)
  console.error('FAIL: local invoice transaction verification at ' + stage + '; inspect ignored synthetic failure log')
  process.exitCode = 1
} finally {
  if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
}
