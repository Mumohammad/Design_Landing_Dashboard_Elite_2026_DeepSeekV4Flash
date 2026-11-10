import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

export async function verifyExpenseCreation(sql){
  const tenant=randomUUID(),otherTenant=randomUUID(),actor=randomUUID(),otherActor=randomUUID()
  const request=randomUUID(),retry=randomUUID()
  let stage='synthetic tenant setup'
  try{
    await sql(`INSERT INTO public.tenants(id,name_ar,name_en,slug) VALUES
      ('${tenant}','Expense fixture','Expense fixture','expense-${tenant}'),
      ('${otherTenant}','Other expense fixture','Other expense fixture','expense-${otherTenant}');
      INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES
      ('${actor}','${actor}@example.test','{"provider":"email","providers":["email"]}','{"_invite_provisioned":true}'),
      ('${otherActor}','${otherActor}@example.test','{"provider":"email","providers":["email"]}','{"_invite_provisioned":true}');
      INSERT INTO public.users(id,auth_user_id,tenant_id,email,role,status,must_change_password) VALUES
      (gen_random_uuid(),'${actor}','${tenant}','${actor}@example.test','general_manager','active',false),
      (gen_random_uuid(),'${otherActor}','${otherTenant}','${otherActor}@example.test','general_manager','active',false);`)
    const payload={expense_type:'fuel',amount:1.005,expense_date:'2026-10-19',vat_rate:15.555,category:'  Fuel  ',vendor:'  Synthetic vendor  ',description:null}
    const context=(sub=actor,aal='aal2')=>`BEGIN;SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claims','${JSON.stringify({role:'authenticated',sub,aal})}',true);`
    const call=async(id=request,input=payload,sub=actor,aal='aal2')=>{
      const output=await sql(context(sub,aal)+`SELECT public.create_expense_atomic('${JSON.stringify(input)}'::jsonb,'${id}'::uuid);COMMIT;`)
      return JSON.parse(output.split('\n').find(line=>line.includes('"replayed"')))
    }
    stage='simultaneous retries'
    const results=await Promise.all(Array.from({length:6},()=>call()))
    const id=results[0].id
    assert.ok(results.every(row=>row.id===id));assert.equal(results.filter(row=>!row.replayed).length,1)
    assert.equal(await sql(`SELECT amount||'|'||vat_rate||'|'||currency||'|'||is_approved||'|'||vat_amount FROM public.expenses WHERE id='${id}'`),'1.01|15.56|SAR|false|0.00')
    assert.equal(await sql(`SELECT count(*) FROM public.audit_log WHERE entity_id='${id}' AND action='expense_created'`),'1')
    assert.equal((await call(request,{...payload,category:'Fuel',vendor:'Synthetic vendor'})).id,id)
    await assert.rejects(call(request,{...payload,amount:2}),/EXP_RETRY:/)
    const other=await call(request,payload,otherActor)
    assert.notEqual(other.id,id)
    stage='audit failure rolls back record and request'
    const fault='expense_audit_fault_'+request.replaceAll('-','')
    await sql(`CREATE FUNCTION public.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      IF NEW.tenant_id='${tenant}' AND NEW.new_values->>'request_id'='${retry}' THEN RAISE EXCEPTION 'synthetic expense audit fault';END IF;RETURN NEW;END $$;
      CREATE TRIGGER ${fault} BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.${fault}();`)
    try{await assert.rejects(call(retry),/synthetic expense audit fault/)}
    finally{await sql(`DROP TRIGGER ${fault} ON public.audit_log;DROP FUNCTION public.${fault}();`)}
    assert.equal(await sql(`SELECT count(*) FROM public.expenses WHERE tenant_id='${tenant}' AND request_id='${retry}'`),'0')
    assert.equal(await sql(`SELECT count(*) FROM public.audit_log WHERE tenant_id='${tenant}' AND new_values->>'request_id'='${retry}'`),'0')
    const recovered=await call(retry)
    assert.equal(recovered.replayed,false)
    stage='JWT permission and managed identity guards'
    await assert.rejects(sql(context()+`INSERT INTO public.expenses(tenant_id,expense_type,amount,expense_date) VALUES('${tenant}','fuel',1,'2026-10-19');COMMIT;`),/EXP_MANAGED|permission denied/)
    await assert.rejects(sql(context()+`UPDATE public.expenses SET vendor='bypass' WHERE id='${id}';COMMIT;`),/EXP_MANAGED|permission denied/)
    await assert.rejects(sql(context()+`DELETE FROM public.expenses WHERE id='${id}';COMMIT;`),/EXP_MANAGED|permission denied/)
    await assert.rejects(sql(`UPDATE public.expenses SET request_id=gen_random_uuid() WHERE id='${id}'`),/EXP_IDENTITY/)
    await assert.rejects(call(randomUUID(),payload,actor,'aal1'),/EXP_PERMISSION|EXP_AUTH/)
    for(const role of ['anon','service_role'])await assert.rejects(sql(`BEGIN;SET LOCAL ROLE ${role};SELECT public.create_expense_atomic('{}','${randomUUID()}');ROLLBACK;`),/permission denied/)
    stage='input validation and persistence bounds'
    for(const invalid of [{amount:0},{amount:0.001},{amount:-1},{amount:1e8},{amount:'1.00'},
      {vat_rate:-1},{vat_rate:101},{expense_type:'unsupported'},{expense_date:'2026-02-30'},
      {expense_date:'2026-1-1'},{category:'x'.repeat(201)},{vendor:'x'.repeat(201)},
      {description:'x'.repeat(2001)},{vendor:{}},{tenant_id:otherTenant},{is_approved:true}]){
      await assert.rejects(call(randomUUID(),{...payload,...invalid}),/EXP_INPUT|date\/time|out of range|date field|numeric field overflow/)
    }
    stage='approval compatibility and deleted-record handling'
    await sql(`BEGIN;SET LOCAL ROLE service_role;SELECT public.ensure_default_chart_of_accounts('${tenant}');COMMIT;`)
    const reviewedVersion=await sql(`SELECT correction_version FROM public.expenses WHERE id='${id}'`)
    await sql(context()+`SELECT public.decide_expense_reviewed_atomic('${id}',${reviewedVersion},'approved',20,'recoverable',NULL,'expenses');COMMIT;`)
    assert.equal((await call()).id,id)
    await assert.rejects(sql(`UPDATE public.expenses SET deleted_at=now() WHERE id='${id}'`),/EXP_HISTORY_IMMUTABLE/)
    await sql(`UPDATE public.expenses SET deleted_at=now() WHERE id='${recovered.id}'`)
    await assert.rejects(call(retry),/EXP_RETRY_UNAVAILABLE/)
    console.log('PASS: concurrent expense retries create one record/audit; exact persistence, tenant isolation, audit rollback/recovery, JWT/MFA, managed identity, input bounds, approval compatibility and deleted-record handling')
  }catch(error){error.verificationStage=stage;throw error}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv[2]!=='--local-disposable')throw Error('Requires the disposable local Supabase DB')
  const sql=statement=>new Promise((accept,reject)=>{
    const child=spawn('docker',['exec','-i','supabase_db_elite-release-20261012','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']})
    let output='',error='';child.stdout.on('data',data=>{output+=data});child.stderr.on('data',data=>{error+=data})
    child.on('error',reject);child.on('close',code=>code===0?accept(output.trim()):reject(Error(error)));child.stdin.end(statement)
  })
  try{await verifyExpenseCreation(sql)}
  catch(error){console.error(`FAIL: disposable expense creation verification at ${error.verificationStage??'startup'}`);process.exitCode=1}
}
