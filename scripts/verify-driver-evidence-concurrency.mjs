import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {randomUUID,createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'

export function assertNativeEvidenceTarget(meta){
 if(meta?.host!=='127.0.0.1'||meta.port!==59463||meta.schemaOnly!==true||!/^driver_evidence_[a-f0-9]{32}$/.test(meta.database??''))throw Error('Only an owned schema-only native evidence database is allowed')
 return meta.database
}
const quote=value=>"'"+String(value).replaceAll("'","''")+"'"
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))

/** Real independent connections. Fixtures are committed ONLY in a newly owned synthetic database. */
export async function verifyDriverEvidenceConcurrency(sql){
 await sql("INSERT INTO storage.buckets(id,name,public) VALUES('driver-documents','driver-documents',false),('driver-photos','driver-photos',false) ON CONFLICT(id) DO NOTHING;")
 const owner=randomUUID(),tag=randomUUID().replaceAll('-','').slice(0,12)
 await sql(`INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES(${quote(owner)},${quote('evidence-'+tag+'@example.test')},'{"_invite_provisioned":true}');`)
 const tenant=JSON.parse(await sql(`SELECT public.provision_company_atomic(${quote(owner)},jsonb_build_object('name','Evidence concurrency fixture','slug',${quote('evidence-'+tag)},'domain',${quote(tag+'.example.test')}));`)).id
 await sql(`UPDATE public.users SET must_change_password=false WHERE auth_user_id=${quote(owner)};`)
 const claims=quote(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}))
 const auth=body=>`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claims=${claims};${body};COMMIT;`
 const read=async q=>JSON.parse(await sql(q))
 const fail=message=>{throw Error(message)}
 const check=(truth,message)=>{if(!truth)fail(message)}
 const driver=async()=>{const id=randomUUID();await sql(`INSERT INTO public.drivers(id,tenant_id,full_name_ar,primary_mobile,category,status,hire_date) VALUES(${quote(id)},${quote(tenant)},'Synthetic evidence race','0501440001','freelancer','active','2020-01-01');`);return id}
 const version=async id=>Number(await sql(`SELECT profile_version FROM public.drivers WHERE id=${quote(id)};`))
 const object=async(id,leaf,bucket='driver-documents')=>{const name=tenant+'/'+id+'/'+leaf,mime=bucket==='driver-photos'?'image/png':'application/pdf';await sql(`INSERT INTO storage.objects(bucket_id,name,owner,owner_id,metadata) VALUES(${quote(bucket)},${quote(name)},${quote(owner)},${quote(owner)},jsonb_build_object('size',100,'mimetype',${quote(mime)}));`);return name}
 const mutation=(action,id,v,input={},source=null,sourceVersion=null)=>`SELECT public.mutate_driver_evidence(${quote(action)},${quote(id)},${v},${quote(JSON.stringify(input))}::jsonb,${source?quote(source):'NULL'},${sourceVersion??'NULL'})`
 const call=async(action,id,input={},source=null,sourceVersion=null)=>JSON.parse(await sql(auth(mutation(action,id,await version(id),input,source,sourceVersion))))
 const auditCount=async(action,id)=>Number(await sql(`SELECT count(*) FROM public.audit_log WHERE tenant_id=${quote(tenant)} AND action=${quote(action)} AND entity_id=${quote(id)};`))
 const results=[]
 const race=async(name,id,first,second=first)=>{
  const prefix='e144_'+tag+'_'+name
  let release=false
  const holder=sql(`SET application_name=${quote(prefix+'_holder')};BEGIN;SELECT profile_version FROM public.drivers WHERE id=${quote(id)} FOR UPDATE;SELECT pg_sleep(4);COMMIT;`).finally(()=>{release=true})
  const until=Date.now()+3000
  while(Date.now()<until){if(Number(await sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${quote(prefix+'_holder')} AND wait_event='PgSleep';`))===1)break;await delay(40)}
  check(!release,'Driver lock fixture released before contention')
  const a=sql(`SET application_name=${quote(prefix+'_a')};`+auth(first)),b=sql(`SET application_name=${quote(prefix+'_b')};`+auth(second))
  // Attach rejection handling immediately while querying independent lock observation.
  const settled=Promise.allSettled([a,b]);let blocked=0
  while(!release){blocked=Number(await sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name IN(${quote(prefix+'_a')},${quote(prefix+'_b')}) AND wait_event_type='Lock';`));if(blocked===2)break;await delay(40)}
  check(blocked===2,'Both evidence writers must wait on the actual held driver row')
  await holder;const done=await settled,success=done.filter(x=>x.status==='fulfilled'),failure=done.filter(x=>x.status==='rejected')
  check(success.length===1&&failure.length===1&&failure[0].reason.message.includes('EVIDENCE_STALE'),'Race must have one commit and one reviewed-version denial: '+name)
  results.push({check:name,result:'PASS',observedBlockedWriters:blocked,commits:1,staleDenials:1})
  return JSON.parse(success[0].value)
 }
 const cardDriver=await driver(),cardVersion=await version(cardDriver)
 const card=await race('card_issue',cardDriver,mutation('card_issue',cardDriver,cardVersion))
 check(Number(await sql(`SELECT count(*) FROM public.driver_cards WHERE driver_id=${quote(cardDriver)} AND status='active';`))===1,'Only one current card can commit')
 check(await auditCount('card_issue',card.id)===1,'Only one card issuance audit can commit')
 check(await sql(`SELECT card_status::text FROM public.drivers WHERE id=${quote(cardDriver)};`)==='active','Card source and derived status must commit together')
 const printVersion=await version(cardDriver)
 await race('card_print',cardDriver,mutation('card_print',cardDriver,printVersion,{format:'pvc'},card.id,1))
 check(Number(await sql(`SELECT reprint_count FROM public.driver_cards WHERE id=${quote(card.id)};`))===1,'One print counter must commit')
 check(Number(await sql(`SELECT count(*) FROM public.driver_card_prints WHERE card_id=${quote(card.id)};`))===1,'One print request must commit')
 const documentDriver=await driver(),first=await object(documentDriver,'race-a.pdf'),second=await object(documentDriver,'race-b.pdf'),dv=await version(documentDriver)
 const doc=await race('document_register',documentDriver,mutation('document_register',documentDriver,dv,{doc_type:'health_certificate',file_path:first}),mutation('document_register',documentDriver,dv,{doc_type:'health_certificate',file_path:second}))
 check(Number(await sql(`SELECT count(*) FROM public.driver_documents WHERE driver_id=${quote(documentDriver)} AND is_active;`))===1,'One document source must commit')
 check(Number(await sql(`SELECT count(*) FROM storage.objects WHERE bucket_id='driver-documents' AND name IN(${quote(first)},${quote(second)});`))===2,'Both uploaded objects must remain after the uncertain loser')
 await race('document_verify',documentDriver,mutation('document_verify',documentDriver,await version(documentDriver),{},doc.id,1))
 check(await sql(`SELECT is_verified::text FROM public.driver_documents WHERE id=${quote(doc.id)};`)==='true','Verification must persist only once')
 const photoDriver=await driver(),oldPhoto=await object(photoDriver,'photo-old.png','driver-photos'),newPhoto=await object(photoDriver,'photo-new.png','driver-photos')
 await call('photo_update',photoDriver,{file_path:oldPhoto})
 const pv=await version(photoDriver),photo=await race('photo_replace_remove',photoDriver,mutation('photo_update',photoDriver,pv,{file_path:newPhoto}),mutation('photo_remove',photoDriver,pv))
 const photoState=await read(`SELECT jsonb_build_object('path',photo_url,'active',(SELECT count(*) FROM driver_operations_private.photo_records WHERE driver_id=d.id AND retired_at IS NULL),'retired',(SELECT count(*) FROM driver_operations_private.photo_records WHERE driver_id=d.id AND retired_at IS NOT NULL)) FROM public.drivers d WHERE id=${quote(photoDriver)};`)
 check((photoState.path===newPhoto&&photoState.active===1&&photoState.retired===1)||(photoState.path===null&&photoState.active===0&&photoState.retired===1),'Photo pointer and private history must reflect exactly the winning mutation')
 check(Number(await sql(`SELECT count(*) FROM storage.objects WHERE bucket_id='driver-photos' AND name IN(${quote(oldPhoto)},${quote(newPhoto)});`))===2,'Photo replacement/removal must retain both objects')
 check(photo.profile_version===await version(photoDriver),'Winning photo receipt must match final driver state')
 const overrideDriver=await driver(),ov=await version(overrideDriver)
 const override=await race('override_create',overrideDriver,mutation('override_create',overrideDriver,ov,{requirement:'identity',reason:'Synthetic reviewed concurrent override',days:7}))
 check(await auditCount('override_create',override.id)===1,'Only one override audit must commit')
 const faultDriver=await driver(),basePath=await object(faultDriver,'original.pdf'),faultPath=await object(faultDriver,'fault.pdf'),base=await call('document_register',faultDriver,{doc_type:'health_certificate',file_path:basePath})
 const snapshot=()=>read(`SELECT jsonb_build_object('version',profile_version,'photo',photo_url,'card',card_status,'docs',(SELECT jsonb_agg(jsonb_build_object('id',id,'active',is_active,'version',workflow_version) ORDER BY id) FROM public.driver_documents WHERE driver_id=d.id),'results',(SELECT count(*) FROM public.driver_compliance_results WHERE driver_id=d.id),'audit',(SELECT count(*) FROM public.audit_log WHERE tenant_id=${quote(tenant)})) FROM public.drivers d WHERE id=${quote(faultDriver)};`)
 const before=await snapshot(),faultName='evidence_fault_'+tag
 await sql(`CREATE FUNCTION driver_operations_private.${faultName}() RETURNS trigger LANGUAGE plpgsql AS $fault$BEGIN IF NEW.tenant_id=${quote(tenant)}::uuid AND NEW.entity_type='driver_evidence' THEN RAISE EXCEPTION 'E144_SYNTHETIC_AUDIT_FAILURE';END IF;RETURN NEW;END;$fault$;CREATE TRIGGER ${faultName} BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION driver_operations_private.${faultName}();`)
 try{await call('document_register',faultDriver,{doc_type:'health_certificate',file_path:faultPath});fail('Audit fault unexpectedly committed')}catch(error){check(error.message.includes('E144_SYNTHETIC_AUDIT_FAILURE'),'Forced audit failure must be the rejection cause')}
 check(JSON.stringify(await snapshot())===JSON.stringify(before),'Audit failure must roll back driver version, compliance, source retirement and audit together')
 check(Number(await sql(`SELECT count(*) FROM public.driver_documents WHERE id=${quote(base.id)} AND is_active AND workflow_version=1;`))===1,'Original source must remain current after audit rollback')
 check(Number(await sql(`SELECT count(*) FROM storage.objects WHERE name=${quote(faultPath)};`))===1,'Failed metadata finalization must retain the uploaded object')
 await sql(`DROP TRIGGER ${faultName} ON public.audit_log;DROP FUNCTION driver_operations_private.${faultName}();`)
 results.push({check:'forced audit failure rolls back source, derived state and version; uploaded object retained',result:'PASS'})
 return {check:'real driver evidence concurrency and audit rollback',result:'PASS',metadataFixturesOnly:true,results}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]!=='--native-disposable')throw Error('Explicit native disposable mode required')
 const meta=JSON.parse(fs.readFileSync('supabase/.temp/driver-evidence-testdb.json','utf8')),database=assertNativeEvidenceTarget(meta)
 const binary=path.resolve('supabase/.temp/pg-tools/pgsql/bin/psql.exe')
 const sql=query=>new Promise((resolve,reject)=>{const child=spawn(binary,['-X','-qAt','-v','ON_ERROR_STOP=1'],{windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,PGHOST:'127.0.0.1',PGPORT:'59463',PGUSER:'postgres',PGDATABASE:database,PGPASSWORD:'',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'10',PGOPTIONS:'-c search_path=extensions,public,pg_temp -c timezone=UTC -c statement_timeout=20000 -c lock_timeout=12000'}});let out='',err='';child.stdout.on('data',x=>{out+=x});child.stderr.on('data',x=>{err+=x});child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(err)));child.stdin.end(query)})
 if(await sql('SELECT current_database();')!==database)throw Error('Connected database identity differs from owned target')
 const result=await verifyDriverEvidenceConcurrency(sql)
 const evidence={...result,migrationSha256:createHash('sha256').update(fs.readFileSync(meta.migration)).digest('hex'),verifiedAt:new Date().toISOString()}
 fs.mkdirSync('supabase/.temp/release-backups/driver-evidence',{recursive:true});fs.writeFileSync('supabase/.temp/release-backups/driver-evidence/concurrency-result.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence))
}
