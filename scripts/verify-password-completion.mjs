import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

export async function verifyPasswordCompletion(sql){
  const tenant=randomUUID(),actor=randomUUID(),profile=randomUUID()
  let stage='synthetic password identity'
  const state=()=>sql(`SELECT credential_revision||'|'||must_change_password||'|'||password_requirement_version||'|'||credential_requirement_version FROM public.users WHERE id='${profile}'`)
  const change=n=>sql(`UPDATE auth.users SET encrypted_password='synthetic-revision-${n}' WHERE id='${actor}'`)
  const complete=(revision,generation)=>sql(`BEGIN;SET LOCAL ROLE service_role;SELECT public.complete_user_password_change('${actor}',${revision},${generation})->>'completed';COMMIT;`)
  const auditCount=action=>sql(`SELECT count(*) FROM public.audit_log WHERE entity_id='${profile}' AND action='${action}'`)
  try{
    await sql(`INSERT INTO public.tenants(id,name_ar,name_en,slug) VALUES('${tenant}','Password fixture','Password fixture','password-${tenant}');
      INSERT INTO auth.users(id,email,encrypted_password,raw_app_meta_data) VALUES('${actor}','password-${actor}@example.test','synthetic-revision-0','{"_invite_provisioned":true}');
      INSERT INTO public.users(id,auth_user_id,tenant_id,email,role,status,must_change_password) VALUES('${profile}','${actor}','${tenant}','password-${actor}@example.test','general_manager','active',true);`)
    assert.equal(await state(),'0|true|0|0')
    stage='metadata cannot complete or observe a credential change'
    await sql(`UPDATE auth.users SET raw_user_meta_data='{"must_change_password":false}' WHERE id='${actor}'`)
    await assert.rejects(complete(1,0),/AUTH_PASSWORD_CONCURRENT/)
    assert.equal(await state(),'0|true|0|0');assert.equal(await auditCount('auth_password_changed'),'0')
    stage='administrative credential change preserves forced requirement'
    await change(1)
    assert.equal(await state(),'1|true|0|0')
    assert.equal(await auditCount('auth_password_changed'),'1')
    assert.equal(await sql(`SELECT (actor_id IS NULL AND NOT(new_values::text LIKE '%synthetic-revision%')) FROM public.audit_log WHERE entity_id='${profile}' AND action='auth_password_changed'`),'t')
    await change(1);assert.equal(await auditCount('auth_password_changed'),'1')
    stage='concurrent trusted completion has one audit'
    assert.deepEqual(await Promise.all(Array.from({length:6},()=>complete(1,0))),Array(6).fill('true'))
    assert.equal(await state(),'1|false|0|0');assert.equal(await auditCount('required_password_change_completed'),'1')
    stage='newly forced requirement invalidates older credential and completion'
    await sql(`UPDATE public.users SET must_change_password=true WHERE id='${profile}'`)
    assert.equal(await state(),'1|true|1|0')
    await assert.rejects(complete(1,0),/AUTH_PASSWORD_CONCURRENT/)
    await assert.rejects(complete(1,1),/credential predates/)
    await change(2);assert.equal(await state(),'2|true|1|1')
    await change(3);await assert.rejects(complete(2,1),/AUTH_PASSWORD_CONCURRENT/)
    assert.equal(await complete(3,1),'true')
    stage='explicit true-to-true administrator reset invalidates in-flight completion'
    await sql(`UPDATE public.users SET must_change_password=true WHERE id='${profile}'`)
    await change(4)
    await sql(`UPDATE public.users SET must_change_password=true WHERE id='${profile}'`)
    assert.equal(await state(),'4|true|3|2')
    await assert.rejects(complete(4,2),/AUTH_PASSWORD_CONCURRENT/)
    await assert.rejects(complete(4,3),/credential predates/)
    stage='credential observation audit failure rolls back Auth update'
    const fault='pwd_fault_'+actor.replaceAll('-','')
    await sql(`CREATE FUNCTION public.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.entity_id='${profile}' AND NEW.action='auth_password_changed' THEN RAISE EXCEPTION 'synthetic password observation fault';END IF;RETURN NEW;END$$;
      CREATE TRIGGER ${fault} BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.${fault}();`)
    try{await assert.rejects(change(5),/synthetic password observation fault/)}
    finally{await sql(`DROP TRIGGER ${fault} ON public.audit_log;DROP FUNCTION public.${fault}();`)}
    assert.equal(await state(),'4|true|3|2')
    assert.equal(await sql(`SELECT encrypted_password='synthetic-revision-4' FROM auth.users WHERE id='${actor}'`),'t')
    await change(5);assert.equal(await state(),'5|true|3|3')
    stage='completion audit failure preserves requirement and can retry'
    await sql(`CREATE FUNCTION public.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.entity_id='${profile}' AND NEW.action='required_password_change_completed' THEN RAISE EXCEPTION 'synthetic password completion fault';END IF;RETURN NEW;END$$;
      CREATE TRIGGER ${fault} BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.${fault}();`)
    try{await assert.rejects(complete(5,3),/synthetic password completion fault/)}
    finally{await sql(`DROP TRIGGER ${fault} ON public.audit_log;DROP FUNCTION public.${fault}();`)}
    assert.equal(await state(),'5|true|3|3');assert.equal(await complete(5,3),'true')
    stage='active unlocked identity and private caller guards'
    for(const mutation of ["status='inactive'","status='active',locked_until=now()+interval '1 hour'","status='active',locked_until=NULL,deleted_at=now()"]){
      await sql(`UPDATE public.users SET ${mutation} WHERE id='${profile}'`)
      await assert.rejects(complete(5,3),/AUTH_PASSWORD_ACCOUNT/)
    }
    await sql(`UPDATE public.users SET status='active',locked_until=NULL,deleted_at=NULL,must_change_password=true WHERE id='${profile}'`)
    for(const role of ['anon','authenticated'])await assert.rejects(sql(`BEGIN;SET LOCAL ROLE ${role};SELECT public.complete_user_password_change('${actor}',5,4);COMMIT;`),/permission denied/)
    assert.equal(await sql(`BEGIN;SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"${actor}","aal":"aal2"}',true);SELECT public.has_required_assurance();ROLLBACK;`).then(value=>value.split('\n').at(-1)),'f')
    await change(6);await complete(6,4)
    assert.equal(await sql(`BEGIN;SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"${actor}","aal":"aal2"}',true);SELECT public.has_required_assurance();ROLLBACK;`).then(value=>value.split('\n').at(-1)),'t')
    stage='new administrative requirement wins over an in-flight completion acknowledgment'
    const race=await Promise.allSettled([
      sql(`BEGIN;UPDATE public.users SET must_change_password=true WHERE id='${profile}';SELECT pg_sleep(0.2);COMMIT;`),
      complete(6,4),
    ])
    assert.equal(race[0].status,'fulfilled')
    assert.equal(await state(),'6|true|5|4')
    await assert.rejects(complete(6,5),/credential predates/)
    console.log('PASS: password observations/audits are atomic; admin resets preserve requirements; six completions retain one audit; stale credentials/new forced generations, audit rollback/retry, account-state and private caller/business gates pass')
  }catch(error){error.verificationStage=stage;throw error}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv[2]!=='--local-disposable')throw Error('Requires the disposable local Supabase DB')
  const sql=statement=>new Promise((accept,reject)=>{
    const child=spawn('docker',['exec','-i','supabase_db_elite-release-20261012','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']})
    let output='',error='';child.stdout.on('data',data=>{output+=data});child.stderr.on('data',data=>{error+=data})
    child.on('error',reject);child.on('close',code=>code===0?accept(output.trim()):reject(Error(error)));child.stdin.end(statement)
  })
  try{await verifyPasswordCompletion(sql)}
  catch(error){console.error(`FAIL: disposable password completion verification at ${error.verificationStage??'startup'}`);process.exitCode=1}
}
