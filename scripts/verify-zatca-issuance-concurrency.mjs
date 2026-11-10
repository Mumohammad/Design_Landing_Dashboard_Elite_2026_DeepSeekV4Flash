// Only the disposable local DB. Never reads app env files or hosted credentials.
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import assert from "node:assert/strict"
import ts from "typescript"

const requireDependency = createRequire(import.meta.url), modules = new Map()
function load(file) {
  file=path.resolve(file)
  if(modules.has(file)) return modules.get(file)
  const exports={}; modules.set(file,exports)
  const code=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  new Function("exports","require",code)(exports,name=>name.startsWith("./")?load(path.resolve(path.dirname(file),name+".ts")):requireDependency(name))
  return exports
}
const {buildZatcaUblInvoice}=load("src/lib/accounting/zatca-ubl.ts")
const {computeInvoiceHash,genesisPiH}=load("src/lib/accounting/zatca-crypto.ts")
const {canonicalizeZatcaInvoice}=load("src/lib/accounting/zatca-canonical.ts")
const literal=value=>"'"+String(value).replaceAll("'","''")+"'"

export async function verifyIssuanceLedger(sql) {
  let stage="fixture setup"
  try {
  const tenant=randomUUID(), otherTenant=randomUUID(), actor=randomUUID(), otherActor=randomUUID(), customer=randomUUID(), stream=randomUUID()
  const invoices=Array.from({length:4},()=>randomUUID()), credits=[randomUUID(),randomUUID()], debits=[randomUUID(),randomUUID()]
  const lines=[{line_no:1,description:"Synthetic issuance service خدمة & <test>",quantity:1,unit_price:100,discount:0,amount:100,vat_rate:15,vat_amount:15}]
  await sql(`
    INSERT INTO public.tenants(id,name_ar,name_en,slug) VALUES
      ('${tenant}','Issuance test','Issuance test','zatca-${tenant}'),('${otherTenant}','Other test','Other test','zatca-${otherTenant}');
    INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES
      ('${actor}','${actor}@example.test','{"provider":"email","providers":["email"]}','{"_invite_provisioned":true}'),
      ('${otherActor}','${otherActor}@example.test','{"provider":"email","providers":["email"]}','{"_invite_provisioned":true}');
    INSERT INTO public.users(id,auth_user_id,tenant_id,email,role,status,must_change_password) VALUES
      (gen_random_uuid(),'${actor}','${tenant}','${actor}@example.test','general_manager','active',false),
      (gen_random_uuid(),'${otherActor}','${otherTenant}','${otherActor}@example.test','general_manager','active',false);
    INSERT INTO public.customers(id,tenant_id,name_ar) VALUES ('${customer}','${tenant}','Synthetic customer');
    ${invoices.map((id,i)=>`INSERT INTO public.invoices(id,tenant_id,invoice_number,invoice_type,customer_id,issue_date,due_date,status,subtotal,vat_amount,total)
      VALUES ('${id}','${tenant}','SYNTHETIC-INV-${i}','sales','${customer}',CURRENT_DATE,CURRENT_DATE,'draft',100,15,115);
      INSERT INTO public.invoice_lines(tenant_id,invoice_id,line_no,description,quantity,unit_price,discount,amount,vat_rate,vat_amount)
      VALUES ('${tenant}','${id}',1,${literal(lines[0].description)},1,100,0,100,15,15);
      UPDATE public.invoices SET status='finalized' WHERE id='${id}';`).join("\n")}
    ${[["credit_notes","credit_note_number",credits],["debit_notes","debit_note_number",debits]].flatMap(([table,column,ids])=>ids.map((id,i)=>`
      INSERT INTO public.${table}(id,tenant_id,${column},reference_invoice_id,customer_id,issue_date,currency,status,subtotal,vat_amount,total,reason,lines)
      VALUES ('${id}','${tenant}','SYNTHETIC-${column}-${i}','${invoices[0]}','${customer}',CURRENT_DATE,'SAR','finalized',100,15,115,'Synthetic adjustment',${literal(JSON.stringify(lines))});`)).join("\n")}
    INSERT INTO public.zatca_issuance_streams(id,tenant_id,environment,egs_serial) VALUES ('${stream}','${tenant}','sandbox','SYNTHETIC-EGS');`)
  const party={name:"Synthetic seller",vatNumber:"399999999900003",address:"Synthetic street",buildingNumber:"1234",district:"Synthetic district",city:"Riyadh",postalCode:"12345",countryCode:"SA"}
  function statement(source,type,counter,previous,overrides={}) {
    const id=randomUUID(), time=new Date().toISOString().replace(/\.\d{3}Z$/,"Z"), local=new Date(Date.parse(time)+3*3600_000).toISOString().slice(0,19)
    const index=type==="invoice"?invoices.indexOf(source):(type==="credit_note"?credits:debits).indexOf(source)
    const number=type==="invoice"?`SYNTHETIC-INV-${index}`:`SYNTHETIC-${type}_number-${index}`
    const data={docType:type,invoiceKind:"simplified",invoiceNumber:number,uuid:id,invoiceCounter:counter+1,previousInvoiceHash:previous,
      issueDate:local.slice(0,10),issueTime:local.slice(11,19),currency:"SAR",seller:party,buyer:party,lines,subtotal:100,discount:0,vatAmount:15,total:115,
      ...(type!=="invoice"?{referenceInvoiceNumber:"SYNTHETIC-INV-0",noteReason:"Synthetic adjustment"}:{}),
      qr:{sellerName:party.name,sellerVatNumber:party.vatNumber,timestamp:local,total:115,vatAmount:15},...overrides.data}
    const xml=buildZatcaUblInvoice(data), canonical=canonicalizeZatcaInvoice(xml)
    return `SELECT public.record_zatca_issuance('${tenant}','${overrides.stream??stream}',${literal(type)},'${source}','${id}',${literal(overrides.time??time)},${counter},${literal(previous)},${literal(xml)},${literal(canonical)},${literal(overrides.hash??computeInvoiceHash(xml))},'${overrides.actor??actor}');`
  }
  const record=(...args)=>sql(`BEGIN; SET LOCAL ROLE service_role; ${statement(...args)} SELECT pg_sleep(0.1); COMMIT;`).then(result=>JSON.parse(result.split("\n")[0]))
  stage="concurrent replay"
  const replay=await Promise.all([record(invoices[0],"invoice",0,genesisPiH()),record(invoices[0],"invoice",0,genesisPiH())])
  assert.equal(replay[0].id,replay[1].id)
  assert.equal(await sql(`SELECT count(*) FROM public.zatca_document_issuances WHERE tenant_id='${tenant}'`),"1")
  stage="competing counter allocation"
  const race=await Promise.allSettled([record(invoices[1],"invoice",1,replay[0].invoice_hash),record(invoices[2],"invoice",1,replay[0].invoice_hash)])
  assert.equal(race.filter(r=>r.status==="fulfilled").length,1)
  assert.match(race.find(r=>r.status==="rejected").reason.message,/ZTC_CONFLICT/)
  const loser=race[0].status==="rejected"?invoices[1]:invoices[2]
  let state=JSON.parse(await sql(`SELECT to_jsonb(s) FROM public.zatca_issuance_streams s WHERE id='${stream}'`))
  assert.equal(Number(state.last_counter),2)
  await record(loser,"invoice",2,state.last_invoice_hash)
  stage="independent note identities"
  for(const [type,ids] of [["credit_note",credits],["debit_note",debits]]) for(const id of ids) {
    state=JSON.parse(await sql(`SELECT to_jsonb(s) FROM public.zatca_issuance_streams s WHERE id='${stream}'`))
    await record(id,type,Number(state.last_counter),state.last_invoice_hash)
  }
  state=JSON.parse(await sql(`SELECT to_jsonb(s) FROM public.zatca_issuance_streams s WHERE id='${stream}'`))
  assert.equal(Number(state.last_counter),7)
  stage="invalid artifact rollback"
  for(const [overrides,pattern] of [[{data:{total:116}},/ZTC_XML/],[{data:{vatAmount:16}},/ZTC_XML/],
    [{data:{lines:[{...lines[0],quantity:2}]}},/ZTC_XML/],[{data:{lines:[{...lines[0],description:"Changed description"}]}},/ZTC_XML/],
    [{data:{lines:[{...lines[0],discount:1}]}},/ZTC_XML/],
    [{time:"2000-01-01T00:00:00Z"},/ZTC_TIME/],[{hash:genesisPiH()},/ZTC_XML/],[{actor:otherActor},/ZTC_ACTOR/]]) {
    await assert.rejects(record(invoices[3],"invoice",7,state.last_invoice_hash,overrides),pattern)
  }
  assert.equal(await sql(`SELECT last_counter FROM public.zatca_issuance_streams WHERE id='${stream}'`),"7")
  assert.equal(await sql(`SELECT count(*) FROM public.zatca_document_issuances WHERE tenant_id='${tenant}'`),"7")
  stage="post-insert fault rollback"
  const faultName="zatca_fixture_fault_"+randomUUID().replaceAll("-","")
  await sql(`CREATE FUNCTION public.${faultName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.source_id='${invoices[3]}'::uuid THEN RAISE EXCEPTION 'synthetic post-insert fault'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER zzz_issuance_fixture_fault AFTER INSERT ON public.zatca_document_issuances FOR EACH ROW EXECUTE FUNCTION public.${faultName}();`)
  try { await assert.rejects(record(invoices[3],"invoice",7,state.last_invoice_hash),/synthetic post-insert fault/) }
  finally { await sql(`DROP TRIGGER zzz_issuance_fixture_fault ON public.zatca_document_issuances; DROP FUNCTION public.${faultName}();`) }
  assert.equal(await sql(`SELECT last_counter FROM public.zatca_issuance_streams WHERE id='${stream}'`),"7")
  assert.equal(await sql(`SELECT count(*) FROM public.zatca_document_issuances WHERE tenant_id='${tenant}'`),"7")
  stage="immutable evidence and stream protections"
  await assert.rejects(sql(`UPDATE public.zatca_document_issuances SET issued_at=now() WHERE tenant_id='${tenant}'`),/ZTC_IMMUTABLE/)
  await assert.rejects(sql(`DELETE FROM public.zatca_document_issuances WHERE tenant_id='${tenant}'`),/ZTC_IMMUTABLE/)
  await assert.rejects(sql(`UPDATE public.zatca_issuance_streams SET last_counter=99 WHERE id='${stream}'`),/ZTC_CHAIN/)
  await assert.rejects(sql(`INSERT INTO public.zatca_issuance_streams(tenant_id,environment,egs_serial) VALUES ('${tenant}','live','UNAVAILABLE')`),/check constraint/)
  await assert.rejects(sql(`INSERT INTO public.zatca_issuance_streams(tenant_id,environment,egs_serial,last_counter) VALUES ('${tenant}','sandbox','BAD-GENESIS',1)`),/ZTC_CHAIN/)
  stage="tenant RLS and RPC privileges"
  const context=who=>`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${who}","role":"authenticated","aal":"aal2"}'; SET LOCAL request.jwt.claim.sub='${who}';`
  assert.equal(await sql(context(actor)+`SELECT count(*) FROM public.zatca_document_issuances; ROLLBACK;`),"7")
  assert.equal(await sql(context(otherActor)+`SELECT count(*) FROM public.zatca_document_issuances; ROLLBACK;`),"0")
  await assert.rejects(sql(context(actor)+statement(invoices[3],"invoice",7,state.last_invoice_hash)+"ROLLBACK;"),/permission denied/)
  await assert.rejects(sql(`BEGIN; SET LOCAL ROLE anon; SELECT * FROM public.zatca_document_issuances; ROLLBACK;`),/permission denied/)
  assert.equal(await sql(`SELECT sum(total) FROM public.invoices WHERE tenant_id='${tenant}'`),"460.00")
  stage="cross-EGS duplicate race"
  const streams=[randomUUID(),randomUUID()]
  await sql(`INSERT INTO public.zatca_issuance_streams(id,tenant_id,environment,egs_serial) VALUES
    ('${streams[0]}','${tenant}','simulation','SIMULATED-EGS-A'),('${streams[1]}','${tenant}','simulation','SIMULATED-EGS-B');`)
  const acrossStreams=await Promise.allSettled(streams.map(id=>record(invoices[3],"invoice",0,genesisPiH(),{stream:id})))
  assert.ok(acrossStreams.some(r=>r.status==="fulfilled"))
  for(const r of acrossStreams.filter(r=>r.status==="rejected")) assert.match(r.reason.message,/duplicate key/)
  assert.equal(new Set(acrossStreams.filter(r=>r.status==="fulfilled").map(r=>r.value.id)).size,1)
  assert.equal(await sql(`SELECT count(*) FROM public.zatca_document_issuances WHERE tenant_id='${tenant}' AND environment='simulation'`),"1")
  assert.equal(await sql(`SELECT sum(last_counter) FROM public.zatca_issuance_streams WHERE id IN ('${streams[0]}','${streams[1]}')`),"1")
  console.log("PASS: issuance replay/concurrent allocation, contiguous PIH chain, independent credit/debit notes, rollback on invalid artifacts, immutable evidence, tenant RLS and service-only writes; financial totals unchanged")
  } catch(error) { error.verificationStage=stage; throw error }
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  if(process.argv[2]!=="--local-disposable") throw new Error("Requires the disposable local Supabase DB")
  const sql=statement=>new Promise((resolve,reject)=>{
    const child=spawn("docker",["exec","-i","supabase_db_elite-release-20261012","psql","-X","-qAt","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1"],{windowsHide:true,stdio:["pipe","pipe","pipe"]})
    let out="",error="";child.stdout.on("data",d=>{out+=d});child.stderr.on("data",d=>{error+=d});child.on("error",reject)
    child.on("close",code=>code===0?resolve(out.trim()):reject(new Error(error)));child.stdin.end(statement)
  })
  try { await verifyIssuanceLedger(sql) } catch(error) {
    const safeCode=error.message?.match(/\b(?:INV\d{3}|AUTH\d{3}|ZTC_[A-Z]+):/)?.[0]??"database-or-assertion"
    console.error(`FAIL: disposable ZATCA issuance verification at ${error.verificationStage??"startup"} (${safeCode})`)
    process.exitCode=1
  }
}
