// Only the disposable local stack. Never accepts a hosted URL/key/container.
// Creates a dedicated fixture tenant; reset this disposable DB afterward.
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
if (process.argv[2] !== '--local-disposable') throw new Error('Requires --local-disposable; reset local test DB after running.')
const container = 'supabase_db_elite-release-20261012'
function sql(statement) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = '', error = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { error += data })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(error)))
    child.stdin.end(statement)
  })
}
const tenant = '81111111-1111-4111-8111-111111111111'
const auth = '81333333-3333-4333-8333-333333333333'
const customer = '81555555-5555-4555-8555-555555555555'
const target = '81777777-7777-4777-8777-777777777777'
await sql(`
INSERT INTO public.tenants(id,name_ar,name_en,slug) VALUES ('${tenant}','Concurrent test','Concurrent test','payment-81-concurrency');
INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES ('00000000-0000-0000-0000-000000000000','${auth}','authenticated','authenticated','payment-81@test.local',crypt('fixture',gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{"_invite_provisioned":true}');
INSERT INTO public.users(id,auth_user_id,tenant_id,email,role,status,must_change_password)
VALUES ('81444444-4444-4444-8444-444444444444','${auth}','${tenant}','payment-81@test.local','general_manager','active',false);
INSERT INTO public.customers(id,tenant_id,name_ar) VALUES ('${customer}','${tenant}','Concurrent test');
INSERT INTO public.receivables(id,tenant_id,customer_id,invoice_ref,invoice_date,due_date,amount,total_amount)
VALUES ('${target}','${tenant}','${customer}','AR81','2026-10-11','2026-10-11',100,100);`)
function record(request, amount) {
  return sql(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${auth}'; SET LOCAL request.jwt.claims='{"sub":"${auth}","role":"authenticated","aal":"aal2"}';
SELECT public.record_finance_payment_atomic(
'{"direction":"in","payment_date":"2026-10-11","amount":${amount},"method":"cash","customer_id":"${customer}"}',
'[{"receivable_id":"${target}","amount":${amount}}]','${request}');
SELECT pg_sleep(0.5); COMMIT;`)
}
const key = '81000000-0000-4000-8000-000000000001'
const replay = await Promise.all([record(key,25),record(key,25)])
const ids = replay.map(result => JSON.parse(result.split('\n')[0]).id)
assert.equal(ids[0],ids[1])
assert.equal(await sql(`SELECT count(*) FROM public.finance_payments WHERE tenant_id='${tenant}';`),'1')
assert.equal(await sql(`SELECT count(*) FROM public.audit_log WHERE tenant_id='${tenant}' AND action='payment_recorded';`),'1')
console.log('Replay race: two successful requests, one payment and one audit; same identifier.')
await sql(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${auth}'; SET LOCAL request.jwt.claims='{"sub":"${auth}","role":"authenticated","aal":"aal2"}'; SELECT public.void_finance_payment_atomic('${ids[0]}'); COMMIT;`)
const race = await Promise.allSettled([
  record('81000000-0000-4000-8000-000000000002',80),
  record('81000000-0000-4000-8000-000000000003',80),
])
assert.equal(race.filter(result => result.status === 'fulfilled').length,1)
const rejected = race.find(result => result.status === 'rejected')
assert.match(rejected.reason.message,/PMT001: allocation exceeds unreserved outstanding balance/)
assert.equal(await sql(`SELECT count(*) FROM public.finance_payments WHERE tenant_id='${tenant}' AND status='pending';`),'1')
assert.equal(await sql(`SELECT sum(a.allocated_amount) FROM public.payment_allocations a JOIN public.finance_payments p ON p.id=a.finance_payment_id WHERE p.tenant_id='${tenant}' AND p.status='pending';`),'80.00')
console.log('Allocation race: one committed payment; one PMT001 rejection; reserved total 80.00, balance 100.00.')
console.log('PASS. Reset the disposable elite-release-20261012 DB to remove these fixtures.')
