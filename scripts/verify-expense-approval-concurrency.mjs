import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

export async function verifyExpenseApproval(sql){
  const actor=randomUUID(),ids=Array.from({length:7},()=>randomUUID());let tenant
  let stage='synthetic approval setup'
  try{
    await sql(`INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES('${actor}','${actor}@example.test','{"provider":"email","providers":["email"],"_invite_provisioned":true}','{"_invite_provisioned":true}');`)
    tenant=await sql(`SELECT public.provision_company_atomic('${actor}','{"name":"Approval fixture","slug":"approval-${actor}","domain":"approval-${actor}.example.test"}')->>'id';`)
    assert.match(tenant,/^[a-f0-9-]{36}$/)
    await sql(`UPDATE public.users SET must_change_password=false WHERE auth_user_id='${actor}';
      INSERT INTO public.expenses(id,tenant_id,expense_type,amount,expense_date,created_by)
      VALUES ${ids.map(id=>`('${id}','${tenant}','fuel',100,'2026-10-19','${actor}')`).join(',')};`)
    const context=(who=actor,aal='aal2')=>`BEGIN;SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claims','${JSON.stringify({role:'authenticated',sub:who,aal})}',true);`
    const call=async(id=ids[0],rate=15.555,who=actor,version=1,reason=null,surface='expenses')=>{
      const output=await sql(context(who)+`SELECT public.decide_expense_reviewed_atomic('${id}',${version},'approved',${rate===null?'NULL':rate},'recoverable',${reason===null?'NULL':"'"+reason.replaceAll("'","''")+"'"},'${surface}');COMMIT;`)
      return JSON.parse(output.split('\n').find(line=>line.includes('"expense_id"')))
    }
    const counts=async id=>await sql(`SELECT (SELECT count(*) FROM public.payables WHERE tenant_id='${tenant}' AND source_entity_id='${id}')||'|'||
      (SELECT count(*) FROM public.financial_events WHERE tenant_id='${tenant}' AND source_type='expense' AND source_id='${id}')||'|'||
      (SELECT count(*) FROM public.audit_log WHERE tenant_id='${tenant}' AND entity_id='${id}' AND action='expense_approved')`)
    stage='concurrent approvals and retained precision'
    const results=await Promise.allSettled(Array.from({length:6},()=>call()))
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
    assert.ok(results.filter(r=>r.status==='rejected').every(r=>/EXP002/.test(r.reason.message)))
    const result=results.find(r=>r.status==='fulfilled').value
    assert.equal(Number(result.vat_amount),15.56);assert.equal(Number(result.total),115.56)
    assert.equal(await sql(`SELECT vat_rate||'|'||vat_amount FROM public.expenses WHERE id='${ids[0]}'`),'15.56|15.56')
    assert.equal(await counts(ids[0]),'1|1|1')
    assert.equal(await sql(`SELECT count(*) FROM public.financial_events WHERE event_id='${result.event_id}' AND payload->>'vat_rate'='15.56'`),'1')
    stage='audit failure rolls back approval payable and event'
    const fault='expense_approval_fault_'+ids[1].replaceAll('-','')
    await sql(`CREATE FUNCTION public.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      IF NEW.action='expense_approved' AND NEW.entity_id='${ids[1]}' THEN RAISE EXCEPTION 'synthetic approval audit fault';END IF;RETURN NEW;END $$;
      CREATE TRIGGER ${fault} BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.${fault}();`)
    try{await assert.rejects(call(ids[1]),/synthetic approval audit fault/)}
    finally{await sql(`DROP TRIGGER ${fault} ON public.audit_log;DROP FUNCTION public.${fault}();`)}
    assert.equal(await counts(ids[1]),'0|0|0')
    assert.equal(await sql(`SELECT is_approved FROM public.expenses WHERE id='${ids[1]}'`),'f')
    await call(ids[1]);assert.equal(await counts(ids[1]),'1|1|1')
    stage='conflicting legacy event requires review and rollback'
    await sql(`INSERT INTO public.financial_events(tenant_id,event_id,idempotency_key,source_type,source_id,event_type,event_date,payload)
      VALUES('${tenant}',gen_random_uuid(),'expense:${ids[2]}:approved','expense','${ids[2]}','ExpenseApprovedEvent','2026-10-19','{}');`)
    await assert.rejects(call(ids[2]),/EXP_EVENT_REVIEW/)
    assert.equal(await counts(ids[2]),'0|1|0')
    assert.equal(await sql(`SELECT is_approved FROM public.expenses WHERE id='${ids[2]}'`),'f')
    stage='conflicting payable requires review and rollback'
    await sql(`INSERT INTO public.payables(tenant_id,invoice_ref,invoice_date,due_date,amount,vat_amount,total_amount,paid_amount,status,source_entity_type,source_entity_id,created_by)
      VALUES('${tenant}','Conflicting fixture','2026-10-19','2026-10-19',1,0,1,0,'open','expense','${ids[3]}','${actor}');`)
    await assert.rejects(call(ids[3]),/EXP_AP_REVIEW/)
    assert.equal(await counts(ids[3]),'1|0|0')
    assert.equal(await sql(`SELECT is_approved FROM public.expenses WHERE id='${ids[3]}'`),'f')
    stage='actor and caller boundaries'
    await assert.rejects(call(ids[4],15,randomUUID()),/EXP_EDIT_FORBIDDEN/)
    await assert.rejects(call(ids[4],15,actor,1,null,'approvals_inbox'),/EXP_INPUT/)
    await assert.rejects(sql(context(actor,'aal1')+`SELECT public.decide_expense_reviewed_atomic('${ids[4]}',1,'approved',15,'recoverable',NULL,'expenses');COMMIT;`),/EXP_EDIT_FORBIDDEN/)
    for(const role of ['anon','authenticated','service_role']){
      await assert.rejects(sql(`BEGIN;SET LOCAL ROLE ${role};SELECT public.approve_expense_atomic('${tenant}','${ids[4]}',15,'recoverable','${actor}');ROLLBACK;`),/permission denied/)
      await assert.rejects(sql(`BEGIN;SET LOCAL ROLE ${role};SELECT public.approve_expense_with_context_atomic('${tenant}','${ids[4]}',15,'recoverable','${actor}','Reason checked','approvals_inbox');ROLLBACK;`),/permission denied/)
    }
    for(const role of ['anon','service_role'])await assert.rejects(sql(`BEGIN;SET LOCAL ROLE ${role};SELECT public.decide_expense_reviewed_atomic('${ids[4]}',1,'approved',15,'recoverable',NULL,'expenses');ROLLBACK;`),/permission denied/)
    await assert.rejects(sql(context()+`UPDATE public.expenses SET is_approved=true,approved_by='${actor}',approved_at=now() WHERE id='${ids[4]}';COMMIT;`),/EXP_MANAGED|permission denied/)
    await assert.rejects(sql(context()+`UPDATE public.expenses SET amount=1 WHERE id='${ids[0]}';COMMIT;`),/EXP_MANAGED|permission denied/)
    await assert.rejects(sql(context()+`DELETE FROM public.expenses WHERE id='${ids[0]}';COMMIT;`),/EXP_MANAGED|permission denied/)
    stage='inbox reason and stored reduced VAT commit with the approval'
    await sql(`UPDATE public.expenses SET vat_rate=5 WHERE id='${ids[5]}';`)
    await call(ids[5],null,actor,2,'Receipts checked','approvals_inbox')
    assert.equal(await counts(ids[5]),'1|1|1')
    assert.equal(await sql(`SELECT entity_type||'|'||(new_values->>'reason')||'|'||(new_values->>'surface') FROM public.audit_log WHERE entity_id='${ids[5]}' AND action='expense_approved'`),'expense|Receipts checked|approvals_inbox')
    assert.equal(await sql(`SELECT vat_rate||'|'||vat_amount FROM public.expenses WHERE id='${ids[5]}'`),'5.00|5.00')
    stage='pending maker correction serializes and rejects the stale approval'
    const editor='expense-editor-'+ids[6]
    const details=JSON.stringify({expense_type:'fuel',category:null,amount:200,expense_date:'2026-10-19',vendor:null,description:'Controlled pending correction',vat_rate:15.56})
    const edit=sql(`SET application_name='${editor}';`+context()+`SELECT public.correct_pending_expense_atomic('${ids[6]}',1,'${randomUUID()}','update','${details}'::jsonb,'Correct original synthetic amount');SELECT pg_sleep(3);COMMIT;`)
    const deadline=Date.now()+10_000
    while(await sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${editor}' AND wait_event='PgSleep'`)!=='1'){
      if(Date.now()>deadline)throw Error('Synthetic editor did not acquire its row')
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    await assert.rejects(call(ids[6]),/EXP_EDIT_STALE/);await edit
    assert.equal(await counts(ids[6]),'0|0|0')
    const latest=await call(ids[6],15.555,actor,2)
    assert.equal(Number(latest.amount),200);assert.equal(Number(latest.vat_amount),31.12);assert.equal(Number(latest.total),231.12)
    assert.equal(await sql(`SELECT amount||'|'||vat_amount||'|'||total_amount FROM public.payables WHERE tenant_id='${tenant}' AND source_entity_id='${ids[6]}'`),'200.00|31.12|231.12')
    console.log('PASS: approval race creates one payable/event/audit; retained-rate VAT matches, pending corrections reject stale approvals then require current reviewed version, audit rollback/recovery, inbox reason, stale event/payable rejection and actor/caller financial guards')
  }catch(error){error.verificationStage=stage;throw error}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv[2]!=='--local-disposable')throw Error('Requires the disposable local Supabase DB')
  const sql=statement=>new Promise((accept,reject)=>{
    const child=spawn('docker',['exec','-i','supabase_db_elite-release-20261012','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']})
    let output='',error='';child.stdout.on('data',data=>{output+=data});child.stderr.on('data',data=>{error+=data})
    child.on('error',reject);child.on('close',code=>code===0?accept(output.trim()):reject(Error(error)));child.stdin.end(statement)
  })
  try{await verifyExpenseApproval(sql)}
  catch(error){console.error(`FAIL: disposable expense approval verification at ${error.verificationStage??'startup'}`);process.exitCode=1}
}
