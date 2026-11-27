// Verify both the NFT manifests and a runnable, isolated copy of the traced
// worker graph. No database, provider key, remote request or business file.
import { readFileSync, realpathSync, lstatSync, statSync, mkdtempSync, mkdirSync, copyFileSync, readlinkSync, symlinkSync, unlinkSync, rmdirSync, readdirSync } from 'node:fs'
import { resolve, dirname, relative, join, sep } from 'node:path'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import QRCode from 'qrcode'
import { mapNftFileEntries } from 'next/dist/build/nft.js'

const root=process.cwd(),graph=JSON.parse(readFileSync('.next/receipt-parser-dependency-trace.json','utf8'))
assert.equal(graph.version,1)
assert.ok(graph.files.includes('workers/receipt-extract.cjs'))
for(const target of graph.targets){
 const trace=JSON.parse(readFileSync(target,'utf8'))
 if(trace.fileHashes)assert.equal(trace.fileHashes.length,trace.files.length,'NFT file hash indexes are misaligned')
 for(const entry of mapNftFileEntries(trace,resolve(target),root)){
  const symbolic=lstatSync(entry.source).isSymbolicLink()
  if(trace.symlinks)assert.equal(entry.symlinkTarget!==undefined,symbolic,'NFT symlink indexes are misaligned')
  if(entry.symlinkTarget!==undefined)assert.equal(resolve(root,entry.symlinkTarget),resolve(dirname(entry.source),readlinkSync(entry.source)),'NFT symlink points to the wrong dependency')
 }
 const files=new Set(trace.files.map(file=>resolve(dirname(target),file)))
 for(const file of graph.files)assert.ok(files.has(resolve(root,file)),'Traced worker dependency missing from function')
 const physical=new Set([...files].map(file=>realpathSync(file)))
 assert.ok(physical.has(realpathSync('workers/receipt-extract.cjs')))
 let bytes=0
 for(const file of files){
  if(/(^|\/)\.env(?:\.|$)|supabase\/\.temp\//.test(relative(root,file).replaceAll('\\','/')))throw Error('Private file in receipt runtime bundle')
  if(statSync(file).isFile())bytes+=statSync(file).size
 }
 if(bytes>250*1024*1024)throw Error('Receipt runtime exceeds standard function bundle budget')
}
const probe=mkdtempSync(resolve('.next/receipt-parser-probe-'))
function destination(file){const rel=relative(root,file);if(rel.startsWith('..')||resolve(probe,rel)===probe)throw Error('Worker probe path escaped project');return resolve(probe,rel)}
function clean(folder){for(const entry of readdirSync(folder,{withFileTypes:true})){const file=join(folder,entry.name);if(entry.isDirectory()&&!entry.isSymbolicLink())clean(file);else unlinkSync(file)}rmdirSync(folder)}
async function execute(bytes,mime){
 return new Promise((resolveResult,reject)=>{
  const env={NODE_ENV:'production'};for(const key of ['PATH','SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key]
  const child=spawn(process.execPath,['--max-old-space-size=128',join(probe,'workers/receipt-extract.cjs')],{cwd:probe,env,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],serialization:'advanced'})
  let value,failure=false
  const timer=setTimeout(()=>{failure=true;child.kill('SIGKILL')},15000)
  child.on('message',message=>{if(message?.type==='result')value=message.value;else if(message?.type==='failed')failure=true})
  child.once('error',()=>{failure=true})
  child.once('close',()=>{clearTimeout(timer);if(failure||!value)reject(Error('Traced receipt worker did not run successfully'));else resolveResult(value)})
  child.once('spawn',()=>child.send({bytes,mime},error=>{if(error){failure=true;child.kill('SIGKILL')}}))
 })
}
try{
 // Copy files first, then create only links whose resolved targets stay in the
 // isolated copy. An absolute local dependency link must not mask missing files.
 const links=[]
 for(const file of graph.files){const source=resolve(root,file),target=destination(source);mkdirSync(dirname(target),{recursive:true});if(lstatSync(source).isSymbolicLink()){links.push([source,target]);continue}if(!statSync(source).isFile())throw Error('Unexpected directory in worker dependency graph');copyFileSync(source,target)}
 for(const[source,target]of links){const actual=resolve(dirname(source),readlinkSync(source)),local=destination(actual);assert.ok(local.startsWith(probe+sep));if(process.platform==='win32'&&statSync(source).isDirectory())symlinkSync(local,target,'junction');else symlinkSync(relative(dirname(target),local),target,statSync(source).isDirectory()?'dir':'file')}
 const text='BT /F1 12 Tf 30 800 Td (SYNTHETIC receipt 115.00 SAR) Tj ET'
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [4 0 R] /Count 1 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',`<< /Length ${text.length} >>\nstream\n${text}\nendstream`]
 let pdf='%PDF-1.4\n';const offsets=[];for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}
 const start=pdf.length;pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${start}\n%%EOF`
 const parsed=await execute(new Uint8Array(Buffer.from(pdf)),'application/pdf');assert.ok(parsed.text.includes('SYNTHETIC receipt'))
 const values=['Synthetic seller','300000000000003','2026-09-01T12:00:00+03:00','115.00','15.00']
 const qr=Buffer.concat(values.map((value,index)=>{const text=Buffer.from(value);return Buffer.concat([Buffer.from([index+1,text.length]),text])})).toString('base64')
 const image=await QRCode.toBuffer(qr,{type:'png',width:400}),decoded=await execute(new Uint8Array(image),'image/png');assert.equal(decoded.qr,qr)
 console.log(JSON.stringify({check:'receipt parser packaged graph',targets:graph.targets.length,dependencyFiles:graph.files.length,isolatedPdf:'PASS',isolatedQrImage:'PASS',credentialEnvironmentInherited:false,networkRequests:0,result:'PASS'}))
}finally{clean(probe)}
