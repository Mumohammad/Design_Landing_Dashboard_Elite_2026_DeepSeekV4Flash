import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

export async function verifyAccountingDefaults(sql){
  const tenant=randomUUID(),faultTenant=randomUUID()
  let stage='synthetic finance tenants'
  try{
    await sql(`INSERT INTO public.tenants(id,name_ar,name_en,slug) VALUES
      ('${tenant}','Finance fixture','Finance fixture','finance-${tenant}'),
      ('${faultTenant}','Finance fault fixture','Finance fault fixture','finance-${faultTenant}');`)
    const initialize=id=>sql(`BEGIN;SET LOCAL ROLE service_role;SELECT public.ensure_default_chart_of_accounts('${id}');COMMIT;`)
    const counts=id=>sql(`SELECT (SELECT count(*) FROM public.chart_of_accounts WHERE tenant_id='${id}')||'|'||
      (SELECT count(*) FROM public.expense_category_mappings WHERE tenant_id='${id}')||'|'||
      (SELECT count(*) FROM public.accounting_periods WHERE tenant_id='${id}')`)
    stage='concurrent complete default initialization'
    const results=await Promise.all(Array.from({length:6},()=>initialize(tenant)))
    assert.equal(results.reduce((sum,value)=>sum+Number(value),0),28)
    assert.equal(await counts(tenant),'28|6|1')
    stage='explicit repeat preserves tenant customizations'
    await sql(`UPDATE public.expense_category_mappings SET coa_account_code='5200',vat_recoverability='non_recoverable' WHERE tenant_id='${tenant}' AND expense_type='fuel';
      UPDATE public.chart_of_accounts SET name_en='Custom fuel' WHERE tenant_id='${tenant}' AND account_code='5000';`)
    assert.equal(await initialize(tenant),'0')
    assert.equal(await sql(`SELECT coa_account_code||'|'||vat_recoverability FROM public.expense_category_mappings WHERE tenant_id='${tenant}' AND expense_type='fuel'`),'5200|non_recoverable')
    assert.equal(await sql(`SELECT name_en FROM public.chart_of_accounts WHERE tenant_id='${tenant}' AND account_code='5000'`),'Custom fuel')
    stage='mapping failure rolls back the whole finance initializer'
    const trigger='finance_fault_'+faultTenant.replaceAll('-','')
    await sql(`CREATE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      IF NEW.tenant_id='${faultTenant}' THEN RAISE EXCEPTION 'synthetic finance mapping fault';END IF;RETURN NEW;END $$;
      CREATE TRIGGER ${trigger} BEFORE INSERT ON public.expense_category_mappings FOR EACH ROW EXECUTE FUNCTION public.${trigger}();`)
    try{await assert.rejects(initialize(faultTenant),/synthetic finance mapping fault/)}
    finally{await sql(`DROP TRIGGER ${trigger} ON public.expense_category_mappings;DROP FUNCTION public.${trigger}();`)}
    assert.equal(await counts(faultTenant),'0|0|0')
    await initialize(faultTenant);assert.equal(await counts(faultTenant),'28|6|1')
    stage='private initialization boundary'
    for(const role of ['anon','authenticated'])await assert.rejects(sql(`BEGIN;SET LOCAL ROLE ${role};SELECT public.ensure_default_chart_of_accounts('${tenant}');COMMIT;`),/permission denied/)
    console.log('PASS: six finance initializers produce one standard chart/mapping set/period; custom choices survive; mapping fault rolls back accounts and period; retry and private execution pass')
  }catch(error){error.verificationStage=stage;throw error}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv[2]!=='--local-disposable')throw Error('Requires the disposable local Supabase DB')
  const sql=statement=>new Promise((accept,reject)=>{
    const child=spawn('docker',['exec','-i','supabase_db_elite-release-20261012','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']})
    let output='',error='';child.stdout.on('data',data=>{output+=data});child.stderr.on('data',data=>{error+=data})
    child.on('error',reject);child.on('close',code=>code===0?accept(output.trim()):reject(Error(error)));child.stdin.end(statement)
  })
  try{await verifyAccountingDefaults(sql)}
  catch(error){console.error(`FAIL: disposable accounting default verification at ${error.verificationStage??'startup'}`);process.exitCode=1}
}
