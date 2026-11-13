import test from 'node:test'
import assert from 'node:assert/strict'
import https from 'node:https'
import http from 'node:http'
import {generateKeyPairSync,createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {mkdtempSync,writeFileSync,existsSync} from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {startVerificationProxy} from './lib/verification-proxy.mjs'
const require=createRequire(import.meta.url),{KEYUTIL,KJUR}=require('jsrsasign'),{chromium}=require('@playwright/test')
const HEADER='x-vercel-trusted-oidc-idp-token',fabricated='fabricated-ephemeral-identity'
function certificate(hostname='localhost'){
 const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),key=pair.privateKey.export({type:'pkcs8',format:'pem'}),pub=pair.publicKey.export({type:'spki',format:'pem'})
 const cert=KJUR.asn1.x509.X509Util.newCertPEM({serial:{int:1},sigalg:'SHA256withECDSA',issuer:{str:'/CN='+hostname},subject:{str:'/CN='+hostname},notbefore:'20260101000000Z',notafter:'20300101000000Z',sbjpubkey:KEYUTIL.getKey(pub),cakey:KEYUTIL.getKey(key),ext:[{extname:'basicConstraints',cA:true},{extname:'subjectAltName',array:[{dns:hostname}]}]})
 return{key,cert}
}
async function fixture(run){
 const tls=certificate(),requests=[],timers=new Set();let writes=0,other,connections=0
 const server=https.createServer(tls,async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk)
  requests.push({path:req.url,header:req.headers[HEADER],proxy:req.headers['proxy-authorization'],cookie:req.headers.cookie,method:req.method,body:Buffer.concat(chunks).toString()})
  if(req.url==='/redirect'||req.url==='/redirect307'){res.writeHead(req.url==='/redirect'?302:307,{location:other+'/redirected'});res.end();return}
  if(req.url==='/cookie')res.setHeader('set-cookie','native_session=synthetic; Path=/; HttpOnly; SameSite=Lax')
  if(req.url==='/download'){res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="synthetic.bin"'});res.end(Buffer.alloc(32768,73));return}
  if(req.url==='/write')writes++
  if(req.url==='/slow'){res.writeHead(200,{'content-type':'text/plain'});res.write('start');const timer=setInterval(()=>res.write('chunk'),50);timers.add(timer);res.on('close',()=>{clearInterval(timer);timers.delete(timer)});return}
  res.setHeader('content-type','text/html');res.end('<html><body>Native app</body></html>')
 })
 server.on('secureConnection',()=>connections++)
 server.on('upgrade',(req,socket)=>{
  requests.push({path:req.url,header:req.headers[HEADER],proxy:req.headers['proxy-authorization']})
  const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n')
  socket.on('error',()=>{})
  socket.once('data',frame=>{if((frame[0]&15)!==1){socket.destroy();return}const size=frame[1]&127,mask=frame.subarray(2,6),data=Buffer.from(frame.subarray(6,6+size));for(let i=0;i<data.length;i++)data[i]^=mask[i%4];socket.write(Buffer.concat([Buffer.from([129,data.length]),data]))})
 })
 const foreignRequests=[],foreign=https.createServer(tls,async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);foreignRequests.push({header:req.headers[HEADER],proxy:req.headers['proxy-authorization'],method:req.method,body:Buffer.concat(chunks).toString()});res.setHeader('access-control-allow-origin',req.headers.origin??'*');res.end('Foreign origin')})
 for(const instance of [server,foreign])await new Promise(resolve=>instance.listen(0,'127.0.0.1',resolve))
 const origin=`https://localhost:${server.address().port}`;other=`https://localhost:${foreign.address().port}`
 const resolveTarget=async url=>{if(![origin,other].includes(url.origin))throw Error('Synthetic target outside fixture');return{address:'127.0.0.1',family:4,ca:tls.cert}}
 const headersFor=async(url,initial)=>{const headers=new Headers(initial);headers.delete(HEADER);headers.delete('proxy-authorization');if(new URL(url).origin===origin)headers.set(HEADER,fabricated);return Object.fromEntries(headers)}
 let proxy,browser
 try{
  proxy=await startVerificationProxy({origin,headersFor,resolveTarget})
  assert.ok(proxy&&typeof proxy.close==='function','Proxy must start an owned loopback server')
  browser=await chromium.launch({headless:true})
  await run({proxy,browser,origin,other,requests,foreignRequests,tls,resolveTarget,headersFor,writes:()=>writes,connections:()=>connections})
 }finally{
  await browser?.close();await proxy?.close()
  for(const timer of timers)clearInterval(timer)
  for(const instance of [server,foreign]){instance.closeAllConnections();await new Promise(resolve=>instance.close(resolve))}
 }
}

test('native browser preserves cookies/body/tabs and never forwards identity or proxy credentials to a foreign redirect',{timeout:20000},async()=>fixture(async({proxy,browser,origin,other,requests,foreignRequests})=>{
 const context=await browser.newContext(proxy.contextOptions)
 await proxy.assertContext(context)
 const page=await context.newPage();await page.goto(origin+'/cookie');await page.goto(origin+'/page')
 assert.match(requests.find(row=>row.path==='/page').cookie,/native_session=synthetic/)
 await page.evaluate(()=>fetch('/write',{method:'POST',body:'synthetic unchanged body'}).then(r=>r.text()))
 const post=requests.find(row=>row.path==='/write');assert.equal(post.method,'POST');assert.equal(post.body,'synthetic unchanged body')
 const tab=await context.newPage();await tab.goto(origin+'/tab')
 await page.goto(origin+'/redirect');assert.equal(new URL(page.url()).origin,other)
 assert.match(await page.textContent('body'),/Foreign origin/)
 await page.goto(origin+'/page');await page.evaluate(()=>fetch('/redirect307',{method:'POST',body:'redirect body unchanged'}).then(r=>r.text()))
 assert.ok(foreignRequests.some(row=>row.method==='POST'&&row.body==='redirect body unchanged'))
 await context.request.get(other,{headers:{[HEADER]:'inherited identity must be stripped'}})
 assert.ok(requests.length>=4);assert.ok(requests.every(row=>row.header===fabricated&&row.proxy===undefined))
 assert.ok(foreignRequests.length);assert.ok(foreignRequests.every(row=>row.header===undefined&&row.proxy===undefined))
 await context.close()
}))

test('native fault injection keeps one committed POST and shutdown cancels streamed upstream work',{timeout:20000},async()=>fixture(async({proxy,browser,origin,writes})=>{
 const context=await browser.newContext(proxy.contextOptions),page=await context.newPage();await proxy.assertContext(context);await page.goto(origin)
 await page.route('**/write',async route=>{const response=await route.fetch({maxRedirects:0});assert.equal(response.status(),200);await route.abort('failed')})
 const failed=await page.evaluate(()=>fetch('/write',{method:'POST',body:'synthetic response loss'}).then(()=>false,()=>true))
 assert.equal(failed,true);assert.equal(writes(),1)
 await page.unrouteAll({behavior:'wait'})
 await page.evaluate(()=>{window.syntheticStream=fetch('/slow').then(r=>r.text()).catch(()=>null)})
 await context.close();await proxy.close();assert.equal(proxy.stats().sockets,0,JSON.stringify(proxy.stats()))
}))

test('native transport preserves binary downloads and concurrent browser responses',{timeout:20000},async()=>fixture(async({proxy,browser,origin,requests})=>{
 const context=await browser.newContext(proxy.contextOptions),page=await context.newPage();await proxy.assertContext(context);await page.goto(origin)
 const responses=await page.evaluate(()=>Promise.all(Array.from({length:8},(_,index)=>fetch('/parallel?index='+index).then(r=>r.text()))))
 assert.equal(responses.length,8);assert.ok(responses.every(text=>text.includes('Native app')))
 assert.equal(requests.filter(row=>row.path.startsWith('/parallel?')).length,8)
 await page.setContent('<a href="'+origin+'/download" download>Download synthetic file</a>')
 const pending=page.waitForEvent('download');await page.getByRole('link',{name:'Download synthetic file',exact:true}).click()
 const download=await pending,stream=await download.createReadStream(),chunks=[]
 for await(const chunk of stream)chunks.push(Buffer.from(chunk))
 assert.equal(download.suggestedFilename(),'synthetic.bin');assert.deepEqual(Buffer.concat(chunks),Buffer.alloc(32768,73));await context.close()
}))

test('a tunneled request cannot replace the authenticated CONNECT authority',{timeout:20000},async()=>fixture(async({proxy,browser,origin,other,requests})=>{
 const context=await browser.newContext(proxy.contextOptions);await proxy.assertContext(context)
 const response=await context.request.get(origin,{headers:{host:new URL(other).host}})
 assert.equal(response.status(),400);assert.equal(requests.length,0);await context.close()
}))

test('a context without the configured proxy cannot pass its transport probe',{timeout:20000},async()=>fixture(async({proxy,browser})=>{
 const direct=await browser.newContext({ignoreHTTPSErrors:true})
 await assert.rejects(()=>proxy.assertContext(direct),/Verification proxy context was not confirmed/)
 await direct.close()
}))

test('cancelling a browser context during identity acquisition starts no later upstream work',{timeout:20000},async()=>fixture(async({browser,origin,headersFor,resolveTarget,requests,connections})=>{
 let release,started
 const gate=new Promise(resolve=>{release=resolve}),beginning=new Promise(resolve=>{started=resolve})
 const proxy=await startVerificationProxy({origin,resolveTarget,headersFor:async(url,headers)=>{if(new URL(url).pathname==='/cancel-before-upstream'){started();await gate}return headersFor(url,headers)}})
 try{
  const cancelled=await browser.newContext(proxy.contextOptions),page=await cancelled.newPage();await proxy.assertContext(cancelled)
  const navigation=page.goto(origin+'/cancel-before-upstream').catch(()=>null)
  await beginning;await cancelled.close();release();await navigation
  const live=await browser.newContext(proxy.contextOptions),response=await live.request.get(origin+'/after-cancel')
  assert.equal(response.status(),200)
  assert.equal(requests.some(row=>row.path==='/cancel-before-upstream'),false)
  assert.equal(connections(),1,'Only the legitimate post-cancellation request may establish upstream TLS')
  await live.close()
 }finally{release();await proxy.close()}
}))

test('proxy closure waits for an upstream socket assigned after shutdown begins',{timeout:20000},async()=>fixture(async({browser,origin,resolveTarget})=>{
 let proxy,shutdown,started
 const beginning=new Promise(resolve=>{started=resolve})
 proxy=await startVerificationProxy({origin,resolveTarget,headersFor:async()=>{
  queueMicrotask(()=>queueMicrotask(()=>queueMicrotask(()=>{shutdown=proxy.close();started()})))
  return{}
 }})
 try{
  const context=await browser.newContext(proxy.contextOptions)
  const request=context.request.get(origin).catch(()=>null)
  await beginning;await shutdown
  assert.equal(proxy.stats().sockets,0,JSON.stringify(proxy.stats()))
  await request;await context.close()
 }finally{await proxy.close()}
}))

test('upstream TLS is still verified when the browser trusts only its local verification hop',{timeout:20000},async()=>fixture(async({browser,origin,tls,headersFor,resolveTarget})=>{
 let reached=0;const unknown=https.createServer(certificate(),(_req,res)=>{reached++;res.end('Must not be accepted')})
 await new Promise(resolve=>unknown.listen(0,'127.0.0.1',resolve))
 const unknownOrigin=`https://localhost:${unknown.address().port}`
 const proxy=await startVerificationProxy({origin,headersFor,resolveTarget:url=>url.origin===unknownOrigin?{address:'127.0.0.1',family:4,ca:tls.cert}:resolveTarget(url)})
 try{const context=await browser.newContext(proxy.contextOptions);const response=await context.request.get(unknownOrigin);assert.equal(response.status(),502);assert.equal(reached,0);await context.close()}
 finally{await proxy.close();unknown.closeAllConnections();await new Promise(resolve=>unknown.close(resolve))}
}))

test('native WebSocket upgrades preserve browser traffic and scoped identity',{timeout:20000},async()=>fixture(async({proxy,browser,origin,requests})=>{
 const context=await browser.newContext(proxy.contextOptions),page=await context.newPage();await proxy.assertContext(context);await page.goto(origin)
 const value=await page.evaluate(()=>new Promise((resolve,reject)=>{const socket=new WebSocket(location.origin.replace('https:','wss:')+'/socket');socket.onopen=()=>socket.send('synthetic websocket');socket.onmessage=event=>{resolve(event.data);socket.close()};socket.onerror=()=>reject(Error('Synthetic WebSocket failed'))}))
 assert.equal(value,'synthetic websocket');assert.equal(requests.find(row=>row.path==='/socket').header,fabricated);await context.close()
}))

test('a trusted certificate for the wrong hostname still fails upstream TLS',{timeout:20000},async()=>fixture(async({browser,origin,headersFor,resolveTarget})=>{
 const tls=certificate('wrong-host.invalid');let reached=0
 const upstream=https.createServer(tls,(_req,res)=>{reached++;res.end('Must not be accepted')})
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve))
 const target=`https://localhost:${upstream.address().port}`
 const proxy=await startVerificationProxy({origin,headersFor,resolveTarget:url=>url.origin===target?{address:'127.0.0.1',family:4,ca:tls.cert}:resolveTarget(url)})
 try{const context=await browser.newContext(proxy.contextOptions),response=await context.request.get(target);assert.equal(response.status(),502);assert.equal(reached,0);await context.close()}
 finally{await proxy.close();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve))}
}))

test('default transport rejects private upstream addresses before opening a tunnel',async()=>{
 const proxy=await startVerificationProxy({origin:'https://elite-dashboard-fixture-elitesaasc-5643.vercel.app',headersFor:async()=>({})})
 assert.ok(proxy&&typeof proxy.close==='function','Proxy must start an owned loopback server')
 try{
  const config=proxy.contextOptions.proxy,url=new URL(config.server)
  for(const[target,expected,password]of [['127.0.0.1:443',403,config.password],['169.254.169.254:443',403,config.password],['example.com:22',403,config.password],['user:pass@example.com:443',403,config.password],['example.com:443',407,'wrong-local-password']]){
   const status=await new Promise((resolve,reject)=>{const request=http.request({hostname:url.hostname,port:url.port,method:'CONNECT',path:target,headers:{'proxy-authorization':'Basic '+Buffer.from(config.username+':'+password).toString('base64')}});request.on('connect',(response,socket)=>{socket.destroy();resolve(response.statusCode)});request.on('error',reject);request.end()})
   assert.equal(status,expected)
  }
 }finally{await proxy.close()}
})

test('a Playwright contextOptions override cannot silently restore legacy hosted transport',{timeout:30000},async()=>{
 const rejectProxy=http.createServer((_req,res)=>{res.writeHead(403);res.end()})
 rejectProxy.on('connect',(_req,socket)=>socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'))
 await new Promise(resolve=>rejectProxy.listen(0,'127.0.0.1',resolve))
 const folder=mkdtempSync(path.resolve('supabase/.temp/native-context-override-')),marker=path.join(folder,'body-ran.txt')
 const fixture=path.relative(folder,path.resolve('e2e/preview-test.ts')).split(path.sep).join('/')
 const app='https://elite-dashboard-fixture-elitesaasc-5643.vercel.app'
 writeFileSync(path.join(folder,'override.spec.ts'),`import {test} from ${JSON.stringify(fixture)};import fs from 'node:fs';test.use({contextOptions:{proxy:{server:${JSON.stringify('http://127.0.0.1:'+rejectProxy.address().port)}}}});test('fixture must reject a context without its own proxy',async({page})=>{await page.setContent('<body>Synthetic only</body>');fs.writeFileSync(${JSON.stringify(marker)},'body ran')})`)
 writeFileSync(path.join(folder,'config.mjs'),`export default ${JSON.stringify({testDir:folder,outputDir:path.join(folder,'results'),workers:1,retries:0,reporter:'json',use:{baseURL:app,trace:'off',video:'off',screenshot:'off'}})}`)
 const env={BASE_URL:app,VERIFY_APP_URL:app,GITHUB_ACTIONS:'false',CI:'false'}
 for(const key of ['PATH','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','HOME','HOMEDRIVE','HOMEPATH'])if(process.env[key])env[key]=process.env[key]
 try{
  const run=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[require.resolve('@playwright/test/cli'),'test','--config',path.join(folder,'config.mjs')],{env,windowsHide:true,stdio:['ignore','pipe','ignore']});let stdout=''
   const timer=setTimeout(()=>child.kill(),20000)
   child.stdout.on('data',part=>{stdout+=part.toString();if(stdout.length>2*1024*1024)child.kill()})
   child.once('error',error=>{clearTimeout(timer);reject(error)})
   child.once('close',status=>{clearTimeout(timer);resolve({status,stdout})})
  })
  let report;try{report=JSON.parse(run.stdout)}catch{}
  assert.ok(report,'Synthetic fixture report must parse')
  assert.notEqual(run.status,0,'Overriding contextOptions must fail closed before the test body')
  assert.equal(JSON.stringify(report).includes('Verification proxy context was not confirmed'),true,'The explicit transport proof must reject the overridden context')
  assert.equal(existsSync(marker),false)
 }finally{rejectProxy.closeAllConnections();await new Promise(resolve=>rejectProxy.close(resolve))}
})
