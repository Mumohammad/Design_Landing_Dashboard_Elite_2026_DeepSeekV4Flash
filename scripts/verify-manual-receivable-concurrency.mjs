// Synthetic fixtures only; the CLI entry point is pinned to the disposable DB.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function verifyManualReceivable(sql) {
  const tenant = randomUUID(), otherTenant = randomUUID(), actor = randomUUID(), otherActor = randomUUID()
  const request = randomUUID(), retry = randomUUID()
  let stage = 'synthetic tenant setup'
  try {
    await sql(`INSERT INTO public.tenants(id,name_ar,name_en,slug) VALUES
      ('${tenant}','Manual AR fixture','Manual AR fixture','ar-${tenant}'),
      ('${otherTenant}','Other AR fixture','Other AR fixture','ar-${otherTenant}');
      INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES
      ('${actor}','${actor}@example.test','{"provider":"email","providers":["email"]}','{"_invite_provisioned":true}'),
      ('${otherActor}','${otherActor}@example.test','{"provider":"email","providers":["email"]}','{"_invite_provisioned":true}');
      INSERT INTO public.users(id,auth_user_id,tenant_id,email,role,status,must_change_password) VALUES
      (gen_random_uuid(),'${actor}','${tenant}','${actor}@example.test','general_manager','active',false),
      (gen_random_uuid(),'${otherActor}','${otherTenant}','${otherActor}@example.test','general_manager','active',false);`)
    const context = (who = actor, aal = 'aal2') => `BEGIN; SET LOCAL ROLE authenticated;
      SET LOCAL request.jwt.claims='{"sub":"${who}","role":"authenticated","aal":"${aal}"}';
      SET LOCAL request.jwt.claim.sub='${who}';`
    const payload = { invoice_ref: 'Synthetic manual AR', invoice_date: '2026-10-19', due_date: '2026-10-20', amount: 4.1, vat_rate: 15 }
    const call = (key = request, details = payload, who = actor, aal = 'aal2') =>
      sql(context(who, aal) + `SELECT public.create_manual_receivable_atomic('${JSON.stringify(details)}','${key}'); COMMIT;`).then(JSON.parse)
    stage = 'simultaneous retries'
    const responses = await Promise.all(Array.from({ length: 6 }, () => call()))
    assert.equal(new Set(responses.map(row => row.id)).size, 1)
    assert.equal(responses.filter(row => !row.replayed).length, 1)
    const id = responses[0].id
    assert.equal(await sql(`SELECT count(*) FROM public.receivables WHERE tenant_id='${tenant}'`), '1')
    assert.equal(await sql(`SELECT count(*) FROM public.audit_log WHERE tenant_id='${tenant}' AND entity_id='${id}' AND action='receivable_created'`), '1')
    const money = JSON.parse(await sql(`SELECT jsonb_build_object('net',amount,'vat',vat_amount,'total',total_amount,'actor',created_by) FROM public.receivables WHERE id='${id}'`))
    assert.deepEqual(money, { net: 4.1, vat: 0.62, total: 4.72, actor })
    stage = 'request conflict and tenant scope'
    await assert.rejects(call(request, { ...payload, amount: 5 }), /AR_RETRY:/)
    const other = await call(request, payload, otherActor)
    assert.notEqual(other.id, id)
    assert.equal(await sql(`SELECT tenant_id FROM public.receivables WHERE id='${other.id}'`), otherTenant)
    stage = 'audit failure rolls back both writes'
    const fault = 'manual_ar_fault_' + randomUUID().replaceAll('-', '')
    await sql(`CREATE FUNCTION public.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='receivable_created' AND NEW.new_values->>'request_id'='${retry}' THEN RAISE EXCEPTION 'synthetic audit fault'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER ${fault} BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.${fault}();`)
    try { await assert.rejects(call(retry), /synthetic audit fault/) }
    finally { await sql(`DROP TRIGGER ${fault} ON public.audit_log; DROP FUNCTION public.${fault}();`) }
    assert.equal(await sql(`SELECT count(*) FROM public.receivables WHERE tenant_id='${tenant}' AND request_id='${retry}'`), '0')
    assert.equal(await sql(`SELECT count(*) FROM public.audit_log WHERE tenant_id='${tenant}' AND new_values->>'request_id'='${retry}'`), '0')
    const recovered = await call(retry)
    assert.equal(recovered.replayed, false)
    assert.equal((await call(retry)).id, recovered.id)
    stage = 'identity and JWT permission guards'
    await assert.rejects(sql(context() + `UPDATE public.receivables SET invoice_ref='bypass' WHERE id='${id}'; COMMIT;`), /AR_MANAGED|permission denied/)
    await assert.rejects(sql(`UPDATE public.receivables SET request_id=gen_random_uuid() WHERE id='${id}'`), /AR_IDENTITY/)
    await assert.rejects(call(randomUUID(), payload, actor, 'aal1'), /AR_PERMISSION|AR_AUTH/)
    await assert.rejects(sql(`BEGIN;SET LOCAL ROLE anon;SELECT public.create_manual_receivable_atomic('{}','${randomUUID()}');ROLLBACK;`), /permission denied/)
    await assert.rejects(sql(`BEGIN;SET LOCAL ROLE service_role;SELECT public.create_manual_receivable_atomic('{}','${randomUUID()}');ROLLBACK;`), /permission denied/)
    stage = 'input validation and persistence bounds'
    for (const invalid of [{ amount: 0 }, { amount: 0.001 }, { amount: -1 }, { amount: 1e10 },
      { amount: 9_999_999_999, vat_rate: 15 }, { vat_rate: -1 }, { vat_rate: 101 }, { amount: '4.10' },
      { invoice_ref: '' }, { invoice_ref: 'x'.repeat(201) }, { invoice_date: '2026-02-30' },
      { invoice_date: '2026-1-1' }, { due_date: '2026-10-18' }, { tenant_id: otherTenant }]) {
      await assert.rejects(call(randomUUID(), { ...payload, ...invalid }), /AR_INPUT|date\/time|out of range|date field|numeric field overflow/)
    }
    stage = 'soft deletion cannot be replayed as success'
    await sql(`UPDATE public.receivables SET deleted_at=now() WHERE id='${id}'`)
    await assert.rejects(call(), /AR_RETRY_UNAVAILABLE/)
    assert.equal(await sql(`SELECT count(*) FROM public.receivables WHERE tenant_id='${tenant}'`), '2')
    console.log('PASS: manual AR concurrent retries create one record/audit, exact VAT, tenant scope, atomic audit rollback, JWT/MFA and immutable request guards, input bounds and deleted-record handling')
  } catch (error) { error.verificationStage = stage; throw error }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] !== '--local-disposable') throw Error('Requires the disposable local Supabase DB')
  const sql = statement => new Promise((accept, reject) => {
    const child = spawn('docker', ['exec', '-i', 'supabase_db_elite-release-20261012', 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    child.stdout.on('data', data => { out += data }); child.stderr.on('data', data => { err += data })
    child.on('error', reject); child.on('close', code => code === 0 ? accept(out.trim()) : reject(Error(err)))
    child.stdin.end(statement)
  })
  try { await verifyManualReceivable(sql) }
  catch (error) { console.error(`FAIL: disposable manual AR verification at ${error.verificationStage ?? 'startup'}`); process.exitCode = 1 }
}
