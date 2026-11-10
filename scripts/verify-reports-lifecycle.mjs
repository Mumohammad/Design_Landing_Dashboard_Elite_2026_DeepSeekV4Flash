import { expect as baseExpect } from '@playwright/test'
import { randomUUID, createHash } from 'node:crypto'
import { assertModuleTestTarget } from './assert-module-test-target.mjs'

const expect = baseExpect.configure({ timeout: 30_000 })
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fields = 'id,driver_code,iqama_number,full_name_ar,primary_mobile,category,status,profile_completeness_score,cod_outstanding_amount,cod_risk_flag'
const headers = ['Code','Iqama','Name','Phone','Category','Status','Completeness %','COD Outstanding','COD Risk']

function parseCsv(value) {
  const rows = []; let row = [], cell = '', quoted = false
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (char === '"') {
      if (quoted && value[index + 1] === '"') { cell += '"'; index++ }
      else if (quoted || cell === '') quoted = !quoted
      else throw Error('Owned CSV quote mismatch')
    } else if (!quoted && (char === ',' || char === '\r' || char === '\n')) {
      row.push(cell); cell = ''
      if (char !== ',') { rows.push(row); row = []; if (char === '\r' && value[index + 1] === '\n') index++ }
    } else cell += char
  }
  if (quoted) throw Error('Owned CSV quote mismatch')
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}
async function bytesOf(download) {
  const stream = await download.createReadStream()
  if (!stream) throw Error('Owned report download stream unavailable')
  const chunks = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

/** Uses only the caller-owned synthetic tenant. All Auth/tenant retirement remains with the coordinator. */
export async function verifyReportsLifecycle(page, admin, tenantId, appUrl) {
  await assertModuleTestTarget(page, admin.supabaseUrl, appUrl)
  if (!uuid.test(tenantId)) throw Error('Owned report tenant required')
  const initialViewport = page.viewportSize(), initialLocale = await page.locator('html').getAttribute('lang') === 'ar' ? 'ar' : 'en'
  const tag = randomUUID().slice(0, 8), routes = [], completed = []
  let stage = 'owned report fixture', popups = 0
  const popup = () => { popups++ }
  page.on('popup', popup)
  const reports = async () => {
    const result = await admin.from('report_generation_log').select('id,status,report_type,report_params,file_name,file_url,file_size_bytes,expires_at,generated_by',{count:'exact'}).eq('tenant_id',tenantId).order('id').limit(500)
    if (result.error || result.count === null || result.count !== result.data?.length) throw Error('Owned report ledger snapshot incomplete')
    return result.data
  }
  const readDrivers = async () => {
    const rows = []; let count
    do {
      const result = await admin.from('drivers').select(fields,{count:'exact'}).eq('tenant_id',tenantId).is('deleted_at',null).order('driver_code').order('id').range(rows.length,rows.length + 499)
      if (result.error || result.count === null || result.count > 5000 || count !== undefined && result.count !== count || !Array.isArray(result.data) || !result.data.length && rows.length < result.count) throw Error('Owned report source snapshot incomplete')
      count = result.count; rows.push(...result.data)
    } while (rows.length < count)
    if (rows.length !== count || new Set(rows.map(row=>row.id)).size !== count) throw Error('Owned report source snapshot inconsistent')
    return rows
  }
  const expectHeaders = async ar => {
    for (const text of ar ? ['النوع','الصيغة','الملف','الحجم','تاريخ الإنشاء','انتهاء الصلاحية'] : ['Type','Format','File','Size','Created','Expires']) await expect(page.getByRole('columnheader',{name:text,exact:true})).toBeVisible()
  }
  try {
    const tenant = await admin.from('tenants').select('domain').eq('id',tenantId).single()
    if (tenant.error || !/^[0-9a-f-]{36}\.test$/i.test(tenant.data.domain ?? '')) throw Error('Synthetic report tenant required')
    const driverCode = 'RPT' + tag.toUpperCase()
    const fixture = await admin.from('drivers').insert({tenant_id:tenantId,driver_code:driverCode,full_name_ar:'تقرير, '+tag,full_name_en:'Report '+tag,primary_mobile:'+966500000000',category:'freelancer',status:'active',cod_outstanding_amount:23.45,cod_risk_flag:false}).select('id,driver_code').single()
    if (fixture.error || !uuid.test(fixture.data?.id)) throw Error('Owned report driver fixture failed')
    expect(fixture.data.driver_code).toBe(driverCode)
    const source = await readDrivers(), baselineReports = await reports(), before = new Set(baselineReports.map(row=>row.id))
    const initialCompleted = baselineReports.filter(row=>row.status==='completed').length
    stage = 'ordinary report generation and immutable ledger'
    await page.goto(appUrl + '/reports?lang=en')
    await expectHeaders(false)
    await page.getByRole('combobox',{name:'Report type',exact:true}).selectOption('driver_performance')
    const period = {year:Number(await page.getByRole('combobox',{name:'Report year',exact:true}).inputValue()),month:Number(await page.getByRole('combobox',{name:'Report month',exact:true}).inputValue())}
    const generate = page.getByRole('button',{name:'Generate report',exact:true})
    await generate.click()
    await expect(page.getByRole('status').filter({hasText:'Report generated successfully.'})).toBeVisible()
    await expect(generate).toBeEnabled()
    let created
    await expect.poll(async()=>{const rows=(await reports()).filter(row=>!before.has(row.id));if(rows.length===1)created=rows[0];return rows.length===1&&rows[0].status==='completed'}).toBe(true)
    expect(created.report_type).toBe('driver_performance');expect(created.report_params).toEqual(period)
    expect(created.file_url).toBe(tenantId+'/'+created.id+'/'+created.file_name)
    expect(Number(created.file_size_bytes)).toBeGreaterThan(0)
    completed.push(created)
    const audit = await admin.from('audit_log').select('id,actor_id,new_values',{count:'exact'}).eq('tenant_id',tenantId).eq('entity_id',created.id).eq('action','report_generated')
    if(audit.error||audit.count!==1||audit.data[0].actor_id!==created.generated_by||audit.data[0].new_values?.rows!==source.length)throw Error('Owned report generation audit mismatch')
    stage = 'private signed report attachment preserves tenant rows and amounts'
    const privateCheck = await page.request.get(admin.supabaseUrl+'/storage/v1/object/public/generated-reports/'+created.file_url,{maxRedirects:0})
    expect(privateCheck.ok()).toBe(false)
    const storage = await admin.storage.from('generated-reports').download(created.file_url)
    if(storage.error||!storage.data)throw Error('Owned stored report unavailable')
    const stored = Buffer.from(await storage.data.arrayBuffer())
    const downloading = page.waitForEvent('download')
    await page.getByTestId('report-download-'+created.id).click()
    const download = await downloading, actual = await bytesOf(download)
    expect(download.suggestedFilename()).toBe(created.file_name)
    expect(createHash('sha256').update(actual).digest('hex')).toBe(createHash('sha256').update(stored).digest('hex'))
    expect(actual.length).toBe(Number(created.file_size_bytes))
    const csv = parseCsv(actual.toString('utf8').replace(/^\uFEFF/,''))
    expect(csv.shift()).toEqual(headers)
    const expected = source.map(row=>[row.driver_code??'',row.iqama_number??'',row.full_name_ar??'',row.primary_mobile??'',row.category??'',row.status??'',String(row.profile_completeness_score??0),Number(row.cod_outstanding_amount??0).toFixed(2),row.cod_risk_flag?'YES':'NO'])
    const sortRows=rows=>rows.map(row=>JSON.stringify(row)).sort()
    expect(sortRows(csv)).toEqual(sortRows(expected))
    expect(csv.filter(row=>row[0]===driverCode)).toHaveLength(1)
    expect(csv.find(row=>row[0]===driverCode)?.[7]).toBe('23.45')
    expect(popups).toBe(0);expect(new URL(page.url()).pathname).toBe('/reports')
    stage = 'localized generation rejection releases pending state and can retry'
    await page.goto(appUrl + '/reports?lang=ar')
    await expectHeaders(true)
    await expect(page.locator('html')).toHaveAttribute('lang','ar')
    await page.getByRole('combobox',{name:'نوع التقرير',exact:true}).selectOption('driver_performance')
    const initialCount=(await reports()).length
    const actionPattern='**/reports**', actionFault=async route=>{if(route.request().method()==='POST'&&route.request().headers()['next-action'])return route.abort('failed');return route.continue()}
    routes.push([actionPattern,actionFault]);await page.route(actionPattern,actionFault)
    await page.getByRole('button',{name:'إنشاء تقرير',exact:true}).click()
    await expect(page.getByRole('alert')).toContainText('تعذر إنشاء التقرير. أعد المحاولة.')
    await expect(page.getByRole('button',{name:'إنشاء تقرير',exact:true})).toBeEnabled()
    expect((await reports()).length).toBe(initialCount)
    await page.unroute(actionPattern,actionFault)
    await page.getByRole('button',{name:'إنشاء تقرير',exact:true}).click()
    await expect(page.getByRole('status').filter({hasText:'تم إنشاء التقرير بنجاح.'})).toBeVisible()
    await expect.poll(async()=>(await reports()).filter(row=>row.status==='completed').length).toBe(initialCompleted+2)
    const retry=(await reports()).find(row=>!before.has(row.id)&&row.id!==created.id)
    if(!retry||retry.status!=='completed')throw Error('Owned report retry unavailable')
    completed.push(retry)
    stage = 'localized signed-download failure and ordinary retry'
    const signPattern='**/storage/v1/object/sign/generated-reports/**', signFault=route=>route.fulfill({status:503,contentType:'application/json',body:'{"message":"SENSITIVE_TEST_DETAIL"}'})
    routes.push([signPattern,signFault]);await page.route(signPattern,signFault)
    await page.getByTestId('report-download-'+retry.id).click()
    await expect(page.getByRole('alert')).toContainText('تعذر تنزيل التقرير. أعد المحاولة.')
    await expect(page.locator('main')).not.toContainText('SENSITIVE_TEST_DETAIL')
    await expect(page.getByTestId('report-download-'+retry.id)).toBeEnabled()
    await page.unroute(signPattern,signFault)
    const retryingDownload=page.waitForEvent('download');await page.getByTestId('report-download-'+retry.id).click()
    expect((await bytesOf(await retryingDownload)).equals(actual)).toBe(true)
    stage = 'completed but expired report is visibly retained without download'
    const expired=await admin.from('report_generation_log').update({expires_at:new Date(Date.now()-60_000).toISOString()}).eq('id',retry.id).eq('tenant_id',tenantId).select('id,status').single()
    if(expired.error||expired.data.status!=='completed')throw Error('Owned report expiry fixture failed')
    await page.reload();await expectHeaders(true)
    await expect(page.getByTestId('report-download-'+retry.id)).toHaveCount(0)
    await expect(page.getByTestId('report-status-'+retry.id)).toHaveText('منتهي')
    await page.setViewportSize({width:390,height:844})
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
    expect((await reports()).filter(row=>completed.some(item=>item.id===row.id))).toHaveLength(2)
    console.log(JSON.stringify({check:'ordinary report generation/private Storage/download, exact tenant CSV/amounts/audit, localized failures/retries and expiry history',result:'PASS'}))
  } catch(error) {
    console.error(JSON.stringify({check:'reports lifecycle',stage,errorType:error.name,callsite:/verify-reports-lifecycle\.mjs:(\d+):(\d+)/.exec(error.stack)?.slice(1)}))
    error.verificationStage=stage;throw error
  } finally {
    page.off('popup',popup)
    for(const[pattern,handler]of routes)await page.unroute(pattern,handler).catch(()=>{})
    if(initialViewport)await page.setViewportSize(initialViewport)
    await page.goto(appUrl+'/reports?lang='+initialLocale).catch(()=>{})
  }
}
