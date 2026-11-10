import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

export async function verifyExpenseRejection(sql){
  const actor=randomUUID(),ids=Array.from({length:7},()=>randomUUID());let tenant
  let stage='synthetic decision setup'
  try{
    await sql(`INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES('${actor}','${actor}@example.test','{"provider":"email","providers":["email"],"_invite_provisioned":true}','{"_invite_provisioned":true}');`)
    tenant=await sql(`SELECT public.provision_company_atomic('${actor}','{"name":"Decision fixture","slug":"decision-${actor}","domain":"decision-${actor}.example.test"}')->>'id';`)
    assert.match(tenant,/^[a-f0-9-]{36}$/)
    await sql(`UPDATE public.users SET must_change_password=false WHERE auth_user_id='${actor}';
      INSERT INTO public.expenses(id,tenant_id,expense_type,amount,expense_date,created_by)
      VALUES ${ids.map(id=>`('${id}','${tenant}','fuel',100,'2026-10-19','${actor}')`).join(',')};`)
    const context=(who=actor,aal='aal2')=>`BEGIN;SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claims','${JSON.stringify({role:'authenticated',sub:who,aal})}',true);`
    const reject=(id,who=actor,reason='Duplicate receipt',version=1)=>sql(context(who)+`SELECT public.decide_expense_reviewed_atomic('${id}',${version},'rejected',NULL,NULL,'${reason.replaceAll("'","''")}','approvals_inbox');COMMIT;`)
    const approve=id=>sql(context()+`SELECT public.decide_expense_reviewed_atomic('${id}',1,'approved',15,'recoverable',NULL,'expenses');COMMIT;`)
    const counts=id=>sql(`SELECT (SELECT count(*) FROM public.payables WHERE tenant_id='${tenant}' AND source_entity_id='${id}' AND deleted_at IS NULL)||'|'||
      (SELECT count(*) FROM public.financial_events WHERE tenant_id='${tenant}' AND source_type='expense' AND source_id='${id}')||'|'||
      (SELECT count(*) FROM public.audit_log WHERE tenant_id='${tenant}' AND entity_id='${id}' AND action IN('expense_approved','expense_rejected'))`)
    stage='six rejection attempts retain one terminal decision and audit'
    const rejected=await Promise.allSettled(Array.from({length:6},()=>reject(ids[0])))
    assert.equal(rejected.filter(r=>r.status==='fulfilled').length,1)
    assert.ok(rejected.filter(r=>r.status==='rejected').every(r=>/EXP_REJECTED/.test(r.reason.message)))
    assert.equal(await counts(ids[0]),'0|0|1')
    assert.equal(await sql(`SELECT is_approved||'|'||(rejected_by='${actor}')||'|'||rejection_reason FROM public.expenses WHERE id='${ids[0]}'`),'false|true|Duplicate receipt')
    await assert.rejects(approve(ids[0]),/EXP_REJECTED/)
    stage='approval versus rejection has one winner and consistent effects'
    const mixed=await Promise.allSettled([approve(ids[1]),reject(ids[1])])
    assert.equal(mixed.filter(r=>r.status==='fulfilled').length,1)
    assert.ok(mixed.filter(r=>r.status==='rejected').every(r=>/EXP002|EXP_REJECTED/.test(r.reason.message)))
    const state=await sql(`SELECT CASE WHEN is_approved THEN 'approved' WHEN rejected_at IS NOT NULL THEN 'rejected' ELSE 'pending' END FROM public.expenses WHERE id='${ids[1]}'`)
    assert.ok(['approved','rejected'].includes(state));assert.equal(await counts(ids[1]),state==='approved'?'1|1|1':'0|0|1')
    stage='audit failure leaves the decision pending and recoverable'
    const fault='reject_fault_'+ids[2].replaceAll('-','')
    await sql(`CREATE FUNCTION public.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      IF NEW.action='expense_rejected' AND NEW.entity_id='${ids[2]}' THEN RAISE EXCEPTION 'synthetic rejection audit fault';END IF;RETURN NEW;END $$;
      CREATE TRIGGER ${fault} BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.${fault}();`)
    try{await assert.rejects(reject(ids[2]),/synthetic rejection audit fault/)}
    finally{await sql(`DROP TRIGGER ${fault} ON public.audit_log;DROP FUNCTION public.${fault}();`)}
    assert.equal(await sql(`SELECT rejected_at IS NULL AND rejected_by IS NULL AND rejection_reason IS NULL AND NOT is_approved FROM public.expenses WHERE id='${ids[2]}'`),'t')
    assert.equal(await counts(ids[2]),'0|0|0');await reject(ids[2]);assert.equal(await counts(ids[2]),'0|0|1')
    stage='legacy financial evidence requires review instead of rejection'
    await sql(`INSERT INTO public.payables(tenant_id,invoice_ref,invoice_date,due_date,amount,vat_amount,total_amount,paid_amount,status,source_entity_type,source_entity_id,created_by)
      VALUES('${tenant}','Legacy fixture',CURRENT_DATE,CURRENT_DATE,100,0,100,0,'open','expense','${ids[3]}','${actor}');
      INSERT INTO public.financial_events(tenant_id,event_id,idempotency_key,source_type,source_id,event_type,event_date,payload)
      VALUES('${tenant}',gen_random_uuid(),'expense:${ids[4]}:fixture','expense','${ids[4]}','ExpenseApprovedEvent',CURRENT_DATE,'{}');`)
    for(const id of [ids[3],ids[4]])await assert.rejects(reject(id),/EXP_FINANCE_REVIEW/)
    assert.equal(await counts(ids[3]),'1|0|0');assert.equal(await counts(ids[4]),'0|1|0')
    stage='actor reason and direct caller boundaries'
    await assert.rejects(reject(ids[5],randomUUID()),/EXP_EDIT_FORBIDDEN/)
    await assert.rejects(reject(ids[5],actor,'no'),/EXP_INPUT/)
    for(const role of ['anon','authenticated','service_role'])await assert.rejects(sql(`BEGIN;SET LOCAL ROLE ${role};SELECT public.reject_expense_atomic('${tenant}','${ids[5]}','Duplicate receipt','${actor}');COMMIT;`),/permission denied/)
    await assert.rejects(sql(context(actor,'aal1')+`SELECT public.decide_expense_reviewed_atomic('${ids[5]}',1,'rejected',NULL,NULL,'Duplicate receipt','approvals_inbox');COMMIT;`),/EXP_EDIT_FORBIDDEN/)
    await assert.rejects(sql(context()+`UPDATE public.expenses SET rejected_at=now(),rejected_by='${actor}',rejection_reason='Bypass fixture' WHERE id='${ids[5]}';COMMIT;`),/EXP_MANAGED|permission denied/)
    await assert.rejects(sql(context()+`UPDATE public.expenses SET rejected_at=NULL,rejected_by=NULL,rejection_reason=NULL WHERE id='${ids[0]}';COMMIT;`),/EXP_MANAGED|permission denied/)
    await assert.rejects(sql(context()+`DELETE FROM public.expenses WHERE id='${ids[0]}';COMMIT;`),/EXP_MANAGED|permission denied/)
    stage='already approved source cannot be rejected'
    await approve(ids[6]);await assert.rejects(reject(ids[6]),/EXP002/);assert.equal(await counts(ids[6]),'1|1|1')
    console.log('PASS: rejection/rejection and approve/reject races retain one decision/audit; rejected source cannot approve; audit rollback/retry, legacy finance review and actor/reason/caller guards pass')
  }catch(error){error.verificationStage=stage;throw error}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv[2]!=='--local-disposable')throw Error('Requires the disposable local Supabase DB')
  const sql=statement=>new Promise((accept,reject)=>{
    const c=spawn('docker',['exec','-i','supabase_db_elite-release-20261012','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']})
    let out='',err='';c.stdout.on('data',d=>{out+=d});c.stderr.on('data',d=>{err+=d});c.on('error',reject);c.on('close',code=>code===0?accept(out.trim()):reject(Error(err)));c.stdin.end(statement)
  })
  try{await verifyExpenseRejection(sql)}catch(error){console.error('FAIL: disposable rejection verification at '+(error.verificationStage??'startup'));process.exitCode=1}
}
