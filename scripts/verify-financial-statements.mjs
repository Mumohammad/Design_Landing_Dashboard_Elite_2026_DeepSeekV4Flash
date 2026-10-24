import { expect as baseExpect } from '@playwright/test'
const expect=baseExpect.configure({timeout:30_000})
// Invoke after invoice lifecycle acceptance has created actual synthetic postings.
export async function verifyFinancialStatements(page,admin,tenantId,appUrl){
 const backend=new URL(admin.supabaseUrl),app=new URL(appUrl)
 const csp=(await fetch(appUrl+'/landing')).headers.get('content-security-policy')??''
 const local=['localhost','127.0.0.1'].includes(backend.hostname)&&['localhost','127.0.0.1'].includes(app.hostname)
 const stage=backend.origin==='https://viowrovartosrkqukjxy.supabase.co'&&/^elite-dashboard-[a-z0-9-]+-elitesaasc-5643\.vercel\.app$/.test(app.hostname)&&csp.includes(backend.origin)
 if((!local&&!stage)||app.hostname==='elite-dashboard-blush.vercel.app'||csp.includes('wwfnsbilmyxeawgzicmv.supabase.co')||csp.includes('connect-src')&&/connect-src[^;]*\*\.supabase\.co/.test(csp)||!tenantId)throw Error('Isolated financial report verification required')
 const latest=await admin.from('journal_entries').select('entry_date').eq('tenant_id',tenantId).in('status',['posted','reversed']).is('deleted_at',null).order('entry_date',{ascending:false}).limit(1)
 if(latest.error||latest.data.length!==1)throw Error('Posted synthetic invoice lifecycle fixture required')
 const period=latest.data[0].entry_date.slice(0,7),[year,month]=period.split('-').map(Number)
 const expected=await admin.from('profit_loss').select('account_code,name_en,net_balance',{count:'exact'}).eq('tenant_id',tenantId).eq('period_year',year).eq('period_month',month)
 if(expected.error||!expected.data.length||expected.count!==expected.data.length)throw Error('Complete synthetic statement expectations unavailable')
 const sumCents=expected.data.reduce((n,r)=>n+Math.round(Number(r.net_balance)*100),0)
 const money=(sumCents/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})
 let phase='read failure and recovery'
 try{
  await page.goto(appUrl+'/accounting?lang=en')
  await expect(page.getByRole('tab',{name:'Statements',exact:true})).toBeVisible()
  let blocked=false
  const unavailable=async route=>{
   const request=route.request()
   if(!blocked&&request.method()==='POST'&&request.headers()['next-action']){blocked=true;await route.fulfill({status:503,contentType:'text/plain',body:'Synthetic report service unavailable'})}
   else await route.continue()
  }
  const reportUrl=url=>url.pathname==='/accounting'
  await page.route(reportUrl,unavailable)
  await page.getByRole('tab',{name:'Statements',exact:true}).click()
  const panel=page.getByRole('tabpanel',{name:'Statements',exact:true})
  const error=panel.getByRole('alert')
  await expect(error).toContainText('The complete financial statements could not be loaded.')
  await page.unroute(reportUrl,unavailable)
  await error.getByRole('button',{name:'Try again',exact:true}).click()
  await expect(panel.getByRole('combobox',{name:'Financial period',exact:true})).toBeVisible()
  await panel.getByRole('combobox',{name:'Financial period',exact:true}).selectOption(period)
  const pl=panel.locator('[data-slot="card"]').filter({has:page.getByText('Profit & Loss',{exact:true})})
  const bs=panel.locator('[data-slot="card"]').filter({has:page.getByText('Balance Sheet',{exact:true})})
  await expect(pl.getByRole('row').filter({hasText:'Net Profit / Loss'})).toContainText(money)
  await expect(bs.getByRole('row').filter({hasText:'Balance Check'})).toContainText('Balanced')
  phase='complete CSV download'
  const pendingDownload=page.waitForEvent('download')
  await pl.getByRole('button',{name:'CSV',exact:true}).click()
  const download=await pendingDownload
  const stream=await download.createReadStream(),chunks=[]
  for await(const chunk of stream)chunks.push(chunk)
  const csv=Buffer.concat(chunks).toString('utf8')
  for(const account of expected.data)if(!csv.includes(account.account_code))throw Error('Statement CSV omitted an account')
  phase='print popup and rendered report'
  const pendingPopup=page.waitForEvent('popup')
  await pl.getByRole('button',{name:'Print',exact:true}).click()
  const popup=await pendingPopup
  await popup.evaluate(()=>{window.print=()=>{window.__financialPrintRequested=true}})
  await expect(popup.locator('body')).toContainText('Profit & Loss Statement')
  await expect(popup.locator('body')).toContainText(period)
  await expect.poll(()=>popup.evaluate(()=>Boolean(window.__financialPrintRequested))).toBe(true)
  await popup.screenshot({path:'supabase/.temp/financial-statement-print.png',fullPage:true})
  await popup.close()
  phase='Arabic mobile rendering'
  await page.setViewportSize({width:390,height:844})
  await page.goto(appUrl+'/accounting?lang=ar')
  await page.getByRole('tab',{name:'القوائم المالية',exact:true}).click()
  const arabicPanel=page.getByRole('tabpanel',{name:'القوائم المالية',exact:true})
  await expect(arabicPanel.getByRole('combobox',{name:'الفترة المالية',exact:true})).toBeVisible()
  await arabicPanel.getByRole('combobox',{name:'الفترة المالية',exact:true}).selectOption(period)
  await expect(arabicPanel).toContainText('متوازنة')
  await expect(arabicPanel.getByText('Entry Type',{exact:true})).toHaveCount(0)
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  await page.screenshot({path:'supabase/.temp/financial-statements-ar-mobile.png',fullPage:true})
  console.log(JSON.stringify({check:'financial statements, complete CSV, print, read failure recovery and Arabic mobile',result:'PASS'}))
 }catch(error){console.error(JSON.stringify({check:'financial statements',phase,errorType:error.name}));throw Error('Financial statement verification failed: '+phase)}
 finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.setViewportSize({width:1440,height:1000})}
}
