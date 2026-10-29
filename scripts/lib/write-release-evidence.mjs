import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'

const unsafe=()=>Error('Safe regular release evidence path required')
const singleLink=stat=>stat.nlink===1n||stat.nlink===1
const sameNode=(left,right)=>left?.dev===right?.dev&&left?.ino===right?.ino
function inspectDestination(file,io){
 const parent=path.dirname(file),root=path.parse(parent).root,parts=path.relative(root,parent).split(path.sep).filter(Boolean),parents=[]
 let current=root
 for(const part of ['',...parts]){
  if(part)current=path.join(current,part)
  const stat=io.lstatSync(current,{bigint:true})
  if(stat.isSymbolicLink()||!stat.isDirectory())throw unsafe()
  parents.push({file:current,stat})
 }
 let target
 try{target=io.lstatSync(file,{bigint:true})}catch(error){if(error.code!=='ENOENT')throw error}
 if(target&&(target.isSymbolicLink()||!target.isFile()||!singleLink(target)))throw unsafe()
 return {parents,target}
}

/** Preserve the previous complete JSON until an fsynced same-directory temp is renamed. */
export function writeReleaseEvidence(filePath,value,{fsImpl=fs,randomId=randomUUID}={}){
 if(typeof filePath!=='string'||!path.isAbsolute(filePath))throw unsafe()
 const file=path.resolve(filePath),body=JSON.stringify(value,null,2)
 if(typeof body!=='string')throw Error('JSON release evidence required')
 const before=inspectDestination(file,fsImpl),id=randomId()
 if(!/^[0-9a-f-]{36}$/i.test(id))throw unsafe()
 const temporary=path.join(path.dirname(file),'.'+path.basename(file)+'.'+id+'.tmp')
 let descriptor,created=false,temporaryStat
 try{
  descriptor=fsImpl.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW??0),0o600)
  created=true
  temporaryStat=fsImpl.fstatSync(descriptor,{bigint:true})
  if(!temporaryStat.isFile()||!singleLink(temporaryStat))throw unsafe()
  fsImpl.writeFileSync(descriptor,body,'utf8')
  fsImpl.fsyncSync(descriptor)
  fsImpl.closeSync(descriptor);descriptor=undefined
  const after=inspectDestination(file,fsImpl),ready=fsImpl.lstatSync(temporary,{bigint:true})
  if(before.parents.length!==after.parents.length||before.parents.some((entry,index)=>entry.file!==after.parents[index].file||!sameNode(entry.stat,after.parents[index].stat))||
      Boolean(before.target)!==Boolean(after.target)||(before.target&&!sameNode(before.target,after.target))||
      ready.isSymbolicLink()||!ready.isFile()||!singleLink(ready)||!sameNode(temporaryStat,ready))throw unsafe()
  fsImpl.renameSync(temporary,file)
  created=false
 }finally{
  if(descriptor!==undefined)try{fsImpl.closeSync(descriptor)}catch{/* Preserve the original write failure. */}
  if(created)try{
   const remaining=fsImpl.lstatSync(temporary,{bigint:true})
   if(!remaining.isSymbolicLink()&&remaining.isFile()&&(temporaryStat?sameNode(temporaryStat,remaining):singleLink(remaining)))fsImpl.unlinkSync(temporary)
  }catch(error){if(error.code!=='ENOENT')throw error}
 }
}
