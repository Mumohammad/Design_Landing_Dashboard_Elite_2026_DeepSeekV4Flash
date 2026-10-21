// Real journal schema and reversal RPC on an owned synthetic PostgreSQL cluster.
// Does not read environment files, hosted connection strings, or production data.
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

if (process.argv[2] !== '--local-disposable') throw Error('Requires --local-disposable')
const root = path.resolve('supabase/.temp')
const data = path.join(root, `journal-reversal-${Date.now()}-${randomUUID()}`)
const bin = path.resolve(process.env.JOURNAL_TEST_PG_BIN || path.join(root, 'pg-tools/pgsql/bin'))
if (!data.startsWith(root + path.sep)) throw Error('Unsafe disposable cluster path')
const exe = name => path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''))
const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  PGHOST: '127.0.0.1', PGPORT: '59453', PGUSER: 'postgres', PGDATABASE: 'postgres', PGPASSWORD: '' }
const run = (name, args) => {
  const fd = fs.openSync(path.join(root, 'journal-reversal-' + name + '.log'), 'w')
  try {
    const result = spawnSync(exe(name), args, { env, windowsHide: true, stdio: ['ignore', fd, fd], timeout: 60000 })
    if (result.status !== 0) throw Error('Disposable PostgreSQL operation failed: ' + name)
  } finally { fs.closeSync(fd) }
}
const sql = statement => new Promise((resolve, reject) => {
  const child = spawn(exe('psql'), ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { env, windowsHide: true, timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'] })
  let out = '', err = ''
  child.stdout.on('data', d => { out += d }); child.stderr.on('data', d => { err += d })
  child.on('error', reject); child.on('close', code => code === 0 ? resolve(out.replaceAll('\r\n', '\n').trim()) : reject(Error(err)))
  child.stdin.end(statement)
})
const migration = name => fs.readFileSync(path.join('supabase/migrations', name), 'utf8').replaceAll('\r\n', '\n')
const section = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a)
  if (a < 0 || b < 0) throw Error('Repository SQL section not found')
  return source.slice(a, b)
}
const functionSql = name => {
  const source = migration('034_journal_engine.sql')
  const start = source.indexOf('CREATE OR REPLACE FUNCTION ' + name + '(')
  const end = source.indexOf('\n$$;', start)
  if (start < 0 || end < 0) throw Error('Repository function not found')
  return source.slice(start, end + 4)
}
let started = false, assertions = 0, stage = 'disposable cluster setup'
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions++ }
const denied = async (promise, pattern) => { await assert.rejects(promise, pattern); assertions++ }
try {
  fs.mkdirSync(root, { recursive: true })
  run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '--locale=C', '-E', 'UTF8'])
  run('pg_ctl', ['-D', data, '-l', path.join(data, 'server.log'), '-o', '-p 59453 -h 127.0.0.1', '-w', 'start'])
  started = true
  await sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE TABLE public.tenants(id uuid PRIMARY KEY);`)
  // Exact repository types, tables, constraints, and immutability triggers.
  await sql(section(migration('027_accounting.sql'), 'CREATE TYPE account_type AS ENUM', '-- 6. Bank accounts'))
  await sql(functionSql('get_or_create_period'))
  await sql(functionSql('reverse_journal_entry'))
  await sql(`REVOKE ALL ON FUNCTION public.get_or_create_period(uuid,date) FROM PUBLIC,authenticated,anon;
    GRANT EXECUTE ON FUNCTION public.get_or_create_period(uuid,date) TO service_role;
    GRANT USAGE ON SCHEMA public,auth TO service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;`)
  await sql(migration('20261021020708_protect_invoice_journal_reversal.sql'))
  // Reapplying the migration must preserve the signature and restricted ACL.
  await sql(migration('20261021020708_protect_invoice_journal_reversal.sql'))
  const signature = 'public.reverse_journal_entry(uuid,uuid,text,text,date,uuid)'
  equal(await sql(`SELECT has_function_privilege('anon','${signature}','EXECUTE'),
    has_function_privilege('authenticated','${signature}','EXECUTE'),
    has_function_privilege('service_role','${signature}','EXECUTE'),
    (SELECT prosecdef FROM pg_proc WHERE oid='${signature}'::regprocedure);`), 'f|f|t|f')

  const tenant = randomUUID(), otherTenant = randomUUID(), actor = randomUUID()
  const debitAccount = randomUUID(), creditAccount = randomUUID()
  await sql(`INSERT INTO public.tenants VALUES('${tenant}'),('${otherTenant}'); INSERT INTO auth.users VALUES('${actor}');
    INSERT INTO public.chart_of_accounts(id,tenant_id,account_code,name_ar,name_en,account_type,normal_balance)
    VALUES('${debitAccount}','${tenant}','1000','Synthetic cash','Synthetic cash','asset','debit'),
      ('${creditAccount}','${tenant}','3000','Synthetic capital','Synthetic capital','equity','credit');`)
  const literal = value => value == null ? 'NULL' : "'" + value.replaceAll("'", "''") + "'"
  const seed = async (type, source, { module = 'accounting', parent = null, deleted = false, status = 'posted' } = {}) => {
    const id = randomUUID()
    await sql(`INSERT INTO public.journal_entries(id,tenant_id,entry_date,period_id,entry_type,status,description_ar,
      source_module,source_entity_type,source_entity_id,reversal_of_entry_id,created_by,deleted_at)
      VALUES('${id}','${tenant}','2026-10-21',public.get_or_create_period('${tenant}','2026-10-21'),
        '${type}','${status}','Synthetic reversal fixture',${literal(module)},${literal(source)},'${randomUUID()}',
        ${literal(parent)},'${actor}',${deleted ? 'now()' : 'NULL'});
      INSERT INTO public.journal_entry_lines(tenant_id,journal_entry_id,account_id,description,debit_amount,credit_amount)
      VALUES('${tenant}','${id}','${debitAccount}','Synthetic debit',115,0),
        ('${tenant}','${id}','${creditAccount}','Synthetic credit',0,115);`)
    return id
  }
  const reverse = (id, who = tenant, date = '2026-10-21', role = 'service_role') => sql(`SET ROLE ${role};
    SELECT row_to_json(r) FROM public.reverse_journal_entry('${who}','${id}','Synthetic reversal',NULL,'${date}','${actor}') r;`).then(JSON.parse)
  const snapshot = () => sql(`SELECT jsonb_build_object(
    'entries',(SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM public.journal_entries j),
    'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.journal_entry_lines l),
    'periods',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.accounting_periods p));`)

  stage = 'invoice, purchase, note, cancellation, and legacy ownership protection'
  const protectedCases = [
    ['invoice','invoice'], ['expense','purchase_invoice'], ['reversal','credit_note'], ['invoice','debit_note'],
    ['reversal','invoice'], ['manual','credit_note'], ['invoice',null],
  ]
  let sourceInvoice
  for (const [type, source] of protectedCases) {
    const id = await seed(type, source, { module: source == null ? null : 'accounting' })
    if (!sourceInvoice) sourceInvoice = id
    const before = await snapshot()
    // A far-future date also proves rejection happens before period creation.
    await denied(reverse(id, tenant, '2040-01-01'), /JRN015/)
    equal(await snapshot(), before)
  }
  const absentModule = await seed('expense','purchase_invoice',{ module: null })
  await denied(reverse(absentModule), /JRN015/)
  // Historic generic reversals carry no invoice source tag; protect ancestors.
  const historic = await seed('reversal','journal_reversal',{ parent: sourceInvoice })
  const historicChild = await seed('reversal','journal_reversal',{ parent: historic })
  await sql(`UPDATE public.journal_entries SET status='reversed',reversed_entry_id='${historic}' WHERE id='${sourceInvoice}';
    UPDATE public.journal_entries SET status='reversed',reversed_entry_id='${historicChild}' WHERE id='${historic}';`)
  const beforeHistoric = await snapshot()
  await denied(reverse(historicChild), /JRN015/)
  equal(await snapshot(), beforeHistoric)

  stage = 'manual and opening reversal behavior'
  for (const type of ['manual','opening']) {
    const id = await seed(type,type === 'manual' ? 'manual_entry' : 'opening_balance')
    const reversal = await reverse(id)
    equal(await sql(`SELECT status,reversed_entry_id FROM public.journal_entries WHERE id='${id}';`), `reversed|${reversal.out_entry_id}`)
    equal(await sql(`SELECT entry_type,status,reversal_of_entry_id,source_entity_type FROM public.journal_entries WHERE id='${reversal.out_entry_id}';`), `reversal|posted|${id}|journal_reversal`)
    equal(await sql(`SELECT account_id,debit_amount,credit_amount FROM public.journal_entry_lines
      WHERE journal_entry_id='${reversal.out_entry_id}' ORDER BY account_id;`),
    [[debitAccount, '0.00', '115.00'],[creditAccount, '115.00', '0.00']].sort(([a],[b])=>a.localeCompare(b)).map(row=>row.join('|')).join('\n'))
    await denied(reverse(id), /JRN012|JRN011/)
    // Manual/opening reversal chains remain available.
    const child = await reverse(reversal.out_entry_id)
    equal(await sql(`SELECT reversal_of_entry_id FROM public.journal_entries WHERE id='${child.out_entry_id}'`), reversal.out_entry_id)
  }

  stage = 'tenant, role, status, soft-delete, and period checks'
  const candidate = await seed('manual','manual_entry')
  await denied(reverse(candidate,otherTenant), /JRN010/)
  await denied(reverse(candidate,tenant,'2026-10-21','authenticated'), /permission denied for function reverse_journal_entry/)
  await denied(reverse(candidate,tenant,'2026-10-21','anon'), /permission denied for function reverse_journal_entry/)
  await denied(reverse(await seed('manual','manual_entry',{ status: 'draft' })), /JRN012/)
  await denied(reverse(await seed('manual','manual_entry',{ deleted: true })), /JRN010/)
  await sql(`INSERT INTO public.accounting_periods(tenant_id,period_year,period_month,status) VALUES('${tenant}',2026,11,'closed');`)
  const beforeClosed = await snapshot()
  await denied(reverse(candidate,tenant,'2026-11-01'), /ACC001/)
  equal(await snapshot(), beforeClosed)

  stage = 'simultaneous generic reversals'
  const concurrent = await seed('manual','manual_entry')
  const races = await Promise.allSettled(Array.from({length:6},()=>reverse(concurrent)))
  equal(races.filter(result=>result.status==='fulfilled').length,1)
  equal(races.filter(result=>result.status==='rejected' && /JRN012|JRN011/.test(result.reason.message)).length,5)
  equal(await sql(`SELECT count(*) FROM public.journal_entries WHERE reversal_of_entry_id='${concurrent}'`),'1')
  console.log(`PASS: ${assertions} local PostgreSQL assertions for invoice ownership, legacy ancestry, manual/opening reversals, authorization, period rollback and concurrency`)
} catch (error) {
  fs.writeFileSync(path.join(root,'journal-reversal-failure.log'), `${stage}\n${error.stack ?? error.message}`)
  console.error('FAIL: local journal reversal verification at ' + stage + '; inspect ignored synthetic failure log')
  process.exitCode = 1
} finally {
  if (started) run('pg_ctl',['-D',data,'-m','fast','-w','stop'])
}
