// Test-only native browser transport. No app responses, keys or state are saved.
import http from 'node:http'
import https from 'node:https'
import {lookup} from 'node:dns/promises'
import {BlockList} from 'node:net'
import {generateKeyPairSync,randomBytes,timingSafeEqual} from 'node:crypto'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),{KEYUTIL,KJUR}=require('jsrsasign')
const HEADER='x-vercel-trusted-oidc-idp-token'
const blocked=new BlockList()
for(const[address,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(address,prefix)

function ephemeralTls(){
 const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),key=pair.privateKey.export({type:'pkcs8',format:'pem'}),pub=pair.publicKey.export({type:'spki',format:'pem'})
 const stamp=date=>date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z').replace('T','')
 const cert=KJUR.asn1.x509.X509Util.newCertPEM({serial:{hex:'01'+randomBytes(15).toString('hex')},sigalg:'SHA256withECDSA',issuer:{str:'/CN=Owned local verification proxy'},subject:{str:'/CN=Owned local verification proxy'},notbefore:stamp(new Date(Date.now()-60000)),notafter:stamp(new Date(Date.now()+86400000)),sbjpubkey:KEYUTIL.getKey(pub),cakey:KEYUTIL.getKey(key),ext:[{extname:'basicConstraints',cA:false}]})
 return{key,cert}
}
async function publicTarget(url){
 if(url.port&&url.port!=='443')throw Error('Upstream port denied')
 const addresses=await lookup(url.hostname,{family:4,all:true})
 if(!addresses.length||addresses.some(row=>row.family!==4||blocked.check(row.address,'ipv4')))throw Error('Upstream address denied')
 return addresses[0]
}
function authority(value){
 if(typeof value!=='string'||value.length>300||/[\s\\/?#@]/.test(value))throw Error('Invalid authority')
 const url=new URL('https://'+value)
 if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Invalid authority')
 return url
}
function filteredHeaders(initial){
 const headers={}
 for(const[key,value]of Object.entries(initial))if(value!==undefined)headers[key]=Array.isArray(value)?value.join(key==='cookie'?'; ':', '):value
 for(const key of String(headers.connection??'').split(',').map(row=>row.trim().toLowerCase()).filter(Boolean))delete headers[key]
 for(const key of ['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade',HEADER])delete headers[key]
 return headers
}

/** resolveTarget is a trusted in-process synthetic-test capability, never env or
 * request input. The real caller uses public DNS and default upstream TLS trust. */
export async function startVerificationProxy({origin,headersFor,resolveTarget=publicTarget}){
 const approved=new URL(origin)
 if(approved.origin!==origin||approved.protocol!=='https:'||approved.username||approved.password||typeof headersFor!=='function')throw Error('Exact verification proxy origin required')
 const tls=ephemeralTls(),username='verification',password=randomBytes(32).toString('base64url'),auth=Buffer.from('Basic '+Buffer.from(username+':'+password).toString('base64'))
 const probe='/_verification_transport_'+randomBytes(24).toString('hex'),proof=randomBytes(24).toString('hex'),sockets=new Set(),upstreams=new Set(),timers=new Set()
 let closing=false,active=0,closePromise
 const track=socket=>{if(socket.closed)return socket;sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.on('error',()=>{});if(closing)socket.destroy();return socket}
 function deadline(promise,ms){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{timers.delete(timer);reject(Error('Verification operation timed out'))},ms);timers.add(timer);promise.then(value=>{clearTimeout(timer);timers.delete(timer);resolve(value)},()=>{clearTimeout(timer);timers.delete(timer);reject(Error('Verification operation failed'))})})}
 function authorized(request){const supplied=Buffer.from(request.headers['proxy-authorization']??'');return supplied.length===auth.length&&timingSafeEqual(supplied,auth)}
 const server=http.createServer((_req,res)=>{res.writeHead(405);res.end('HTTPS verification proxy required')})
 server.maxHeadersCount=128
 server.on('connection',socket=>{if(closing||sockets.size>=128){socket.destroy();return}track(socket);socket.setTimeout(120000,()=>socket.destroy())})
 server.on('clientError',(_error,socket)=>socket.destroy())
 server.on('connect',async(request,socket,head)=>{
  if(!authorized(request)){socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="owned-verification"\r\nContent-Length: 0\r\n\r\n');return}
  let target,resolved
  try{target=authority(request.url);resolved=await deadline(Promise.resolve(resolveTarget(target)),10000);if(!resolved||typeof resolved.address!=='string'||resolved.family!==4)throw Error('Invalid target resolution')}
  catch{if(!socket.destroyed)socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');return}
  if(closing||socket.destroyed)return
  // This TLS server owns one CONNECT tunnel, so Host cannot change its authority.
  const tunnel=https.createServer({...tls,handshakeTimeout:10000,maxHeaderSize:65536},(req,res)=>{void forward(target,resolved,req,res)})
  tunnel.on('tlsClientError',(_error,client)=>client.destroy())
  tunnel.on('clientError',(_error,client)=>client.destroy())
  tunnel.on('upgrade',(req,client,upgradeHead)=>{void forward(target,resolved,req,null,{client,head:upgradeHead})})
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
  if(head.length)socket.unshift(head)
  tunnel.emit('connection',socket)
 })
 async function forward(target,resolved,req,res,upgrade){
  const fail=status=>{if(upgrade){upgrade.client.end(`HTTP/1.1 ${status} Verification transport failure\r\nContent-Length: 0\r\n\r\n`)}else if(!res.headersSent){res.writeHead(status,{'cache-control':'no-store'});res.end('Verification transport request failed')}else res.destroy()}
  try{
   if(closing||active>=64){fail(503);return}
   if(authority(req.headers.host).origin!==target.origin||typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//')){fail(400);return}
   if(!upgrade&&target.origin===origin&&req.url===probe&&req.method==='GET'){res.writeHead(204,{'x-verification-context':proof,'cache-control':'no-store'});res.end();return}
   active++;let finished=false
   const finish=()=>{if(!finished){finished=true;active--}}
   const client=upgrade?.client??res
   client.once('close',finish)
   let headers
   try{headers=await deadline(Promise.resolve(headersFor(target.origin+req.url,filteredHeaders(req.headers))),20000)}catch{finish();fail(502);return}
   if(closing||finished||client.destroyed||client.writableEnded||req.destroyed&&!req.complete){finish();return}
   headers=Object.fromEntries(new Headers(headers));delete headers['proxy-authorization'];delete headers['proxy-authenticate'];delete headers.connection;delete headers['transfer-encoding'];delete headers.upgrade
   if(target.origin!==origin)delete headers[HEADER]
   headers.host=target.host
   if(upgrade){if(req.headers.upgrade?.toLowerCase()!=='websocket'){finish();fail(400);return}headers.connection='Upgrade';headers.upgrade='websocket'}
   const upstream=https.request({hostname:target.hostname,port:target.port||443,servername:target.hostname,path:req.url,method:req.method,headers,rejectUnauthorized:true,...(resolved.ca?{ca:resolved.ca}:{}),lookup:(_hostname,options,callback)=>{if(options?.all)callback(null,[{address:resolved.address,family:resolved.family}]);else callback(null,resolved.address,resolved.family)},agent:false})
   // Register the request before its asynchronous socket assignment. Shutdown
   // must also retire requests whose socket event has not arrived yet.
   upstreams.add(upstream);upstream.once('close',()=>upstreams.delete(upstream))
   upstream.on('socket',track)
   upstream.setTimeout(120000,()=>upstream.destroy())
   upstream.on('error',()=>{finish();if(!client.destroyed)fail(502)})
   client.once('close',()=>upstream.destroy())
   req.once('aborted',()=>upstream.destroy())
   upstream.once('response',response=>{
    if(upgrade){upgrade.client.write(`HTTP/1.1 ${response.statusCode} Verification upstream response\r\nContent-Length: 0\r\n\r\n`);response.resume();upgrade.client.end();finish();return}
    const responseHeaders={...response.headers};for(const name of ['connection','keep-alive','proxy-authenticate','proxy-authorization','transfer-encoding'])delete responseHeaders[name]
    res.writeHead(response.statusCode??502,responseHeaders);response.on('error',()=>res.destroy());response.once('end',finish);response.pipe(res)
   })
   upstream.once('upgrade',(response,remote,upstreamHead)=>{
    if(!upgrade){remote.destroy();finish();fail(502);return}
    track(remote)
    const responseHeaders=[];for(let i=0;i<response.rawHeaders.length;i+=2)if(!['proxy-authorization','proxy-authenticate',HEADER].includes(response.rawHeaders[i].toLowerCase()))responseHeaders.push(response.rawHeaders[i]+': '+response.rawHeaders[i+1])
    upgrade.client.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n${responseHeaders.join('\r\n')}\r\n\r\n`)
    if(upstreamHead.length)upgrade.client.write(upstreamHead)
    if(upgrade.head.length)remote.write(upgrade.head)
    remote.on('error',()=>upgrade.client.destroy());remote.once('close',()=>{finish();upgrade.client.destroy()});upgrade.client.once('close',()=>remote.destroy());remote.pipe(upgrade.client).pipe(remote)
   })
   req.pipe(upstream)
  }catch{if(!res?.destroyed&&!upgrade?.client.destroyed)fail(502)}
 }
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
 const contextOptions={proxy:{server:'http://127.0.0.1:'+server.address().port,username,password},ignoreHTTPSErrors:true}
 return{
  contextOptions,
  async assertContext(context){let response;try{response=await context.request.get(origin+probe,{maxRedirects:0,timeout:10000});if(response.status()!==204||response.headers()['x-verification-context']!==proof)throw Error()}catch{throw Error('Verification proxy context was not confirmed')}finally{await response?.dispose?.()}},
  stats:()=>({sockets:sockets.size,active,requests:upstreams.size,closedSockets:[...sockets].filter(socket=>socket.closed).length}),
  // A socket may report .closed before emitting close. Set membership means
  // that event has not run yet; await it rather than resolving from the flag.
  close(){closePromise??=(async()=>{
   closing=true
   const requestEnds=[...upstreams].map(request=>new Promise(resolve=>request.once('close',resolve)))
   for(const request of upstreams)request.destroy()
   const listenerClosed=new Promise(resolve=>server.close(resolve))
   for(const socket of sockets)socket.destroy()
   for(const timer of timers)clearTimeout(timer);timers.clear()
   await Promise.all([listenerClosed,...requestEnds])
   // Pending socket assignments are destroyed by track() during closing. Drain
   // the live set after request closure, rather than only the initial snapshot.
   while(sockets.size){const owned=[...sockets],ended=owned.map(socket=>new Promise(resolve=>socket.once('close',resolve)));for(const socket of owned)socket.destroy();await Promise.all(ended)}
  })();return closePromise},
 }
}
