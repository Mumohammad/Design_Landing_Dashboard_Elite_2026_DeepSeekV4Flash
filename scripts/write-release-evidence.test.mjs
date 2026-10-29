import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {writeReleaseEvidence} from './lib/write-release-evidence.mjs'

const id='15000000-0000-4000-8000-000000000099'
function fixture(t){
 const base=path.resolve(os.tmpdir()),folder=fs.mkdtempSync(path.join(base,'atomic-release-evidence-')),file=path.join(folder,'fixture-proof.json')
 t.after(()=>{
  assert.equal(path.dirname(folder),base)
  assert.match(path.basename(folder),/^atomic-release-evidence-[A-Za-z0-9]+$/)
  fs.rmSync(folder,{recursive:true,force:true})
 })
 return {folder,file,temporary:path.join(folder,'.fixture-proof.json.'+id+'.tmp')}
}
function oldProof(file){
 const value={runId:id,result:'FAIL',results:[],extraFixtures:[],pendingAuxiliary:[]}
 const text=JSON.stringify(value,null,2);fs.writeFileSync(file,text);return text
}

test('atomic proof creation keeps the identical JSON schema and formatting',t=>{
 const {file,folder}=fixture(t),proof={runId:id,result:'RUNNING',results:[],extraFixtures:[],pendingAuxiliary:[]}
 writeReleaseEvidence(file,proof)
 assert.equal(fs.readFileSync(file,'utf8'),JSON.stringify(proof,null,2))
 assert.deepEqual(fs.readdirSync(folder),['fixture-proof.json'])
})

test('atomic replacement exposes old complete JSON until the new fsynced file is renamed',t=>{
 const {file,temporary,folder}=fixture(t),old=oldProof(file),next={runId:id,result:'PASS',results:['owned-module']},events=[]
 writeReleaseEvidence(file,next,{randomId:()=>id,fsImpl:{...fs,
  openSync(name,flags,mode){assert.equal(name,temporary);assert.ok(flags&fs.constants.O_EXCL);assert.ok(flags&fs.constants.O_CREAT);assert.equal(mode,0o600);events.push('open');return fs.openSync(name,flags,mode)},
  writeFileSync(fd,body,encoding){events.push('write');assert.equal(fs.readFileSync(file,'utf8'),old);return fs.writeFileSync(fd,body,encoding)},
  fsyncSync(fd){events.push('fsync');return fs.fsyncSync(fd)},
  closeSync(fd){events.push('close');return fs.closeSync(fd)},
  renameSync(from,to){events.push('rename');assert.equal(path.dirname(from),path.dirname(to));assert.equal(fs.readFileSync(file,'utf8'),old);assert.deepEqual(JSON.parse(fs.readFileSync(from,'utf8')),next);return fs.renameSync(from,to)},
 }})
 assert.deepEqual(events,['open','write','fsync','close','rename'])
 assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),next)
 assert.deepEqual(fs.readdirSync(folder),['fixture-proof.json'])
})

for(const operation of ['fstat','write','fsync','close','rename'])test('atomic '+operation+' failure preserves the prior valid proof and removes its temp',t=>{
 const {file,temporary,folder}=fixture(t),old=oldProof(file)
 const io={...fs}
 if(operation==='fstat')io.fstatSync=()=>{throw Error('Synthetic fstat failure')}
 if(operation==='write')io.writeFileSync=(fd,body)=>{fs.writeSync(fd,body.slice(0,8));throw Error('Synthetic write failure')}
 if(operation==='fsync')io.fsyncSync=()=>{throw Error('Synthetic fsync failure')}
 if(operation==='close')io.closeSync=fd=>{fs.closeSync(fd);throw Error('Synthetic close failure')}
 if(operation==='rename')io.renameSync=()=>{throw Error('Synthetic rename failure')}
 assert.throws(()=>writeReleaseEvidence(file,{result:'PASS'},{randomId:()=>id,fsImpl:io}),/Synthetic/)
 assert.equal(fs.readFileSync(file,'utf8'),old)
 assert.doesNotThrow(()=>JSON.parse(fs.readFileSync(file,'utf8')))
 assert.equal(fs.existsSync(temporary),false)
 assert.deepEqual(fs.readdirSync(folder),['fixture-proof.json'])
})

test('serialization failure does not open or alter the prior proof',t=>{
 const {file}=fixture(t),old=oldProof(file),value={};value.self=value;let opens=0
 assert.throws(()=>writeReleaseEvidence(file,value,{fsImpl:{...fs,openSync(){opens++;throw Error('Unexpected open')}}}),/circular/i)
 assert.equal(opens,0);assert.equal(fs.readFileSync(file,'utf8'),old)
})

test('exclusive temp collision leaves the colliding file and previous proof untouched',t=>{
 const {file,temporary}=fixture(t),old=oldProof(file)
 fs.writeFileSync(temporary,'Foreign existing temp')
 assert.throws(()=>writeReleaseEvidence(file,{result:'PASS'},{randomId:()=>id}),{code:'EEXIST'})
 assert.equal(fs.readFileSync(file,'utf8'),old)
 assert.equal(fs.readFileSync(temporary,'utf8'),'Foreign existing temp')
})

test('a hard-linked destination is rejected before any temp is opened',t=>{
 const {file,folder}=fixture(t),old=oldProof(file),alias=path.join(folder,'alias.json');fs.linkSync(file,alias);let opens=0
 assert.throws(()=>writeReleaseEvidence(file,{result:'PASS'},{fsImpl:{...fs,openSync(){opens++;throw Error('Unexpected open')}}}),/Safe regular/)
 assert.equal(opens,0);assert.equal(fs.readFileSync(file,'utf8'),old);assert.equal(fs.readFileSync(alias,'utf8'),old)
})

test('a symlink-like destination is rejected before any temp is opened on every OS',t=>{
 const {file}=fixture(t),old=oldProof(file);let opens=0
 const actual=fs.lstatSync(file)
 assert.throws(()=>writeReleaseEvidence(file,{result:'PASS'},{fsImpl:{...fs,lstatSync(name){if(name===file)return{...actual,isSymbolicLink:()=>true,isFile:()=>false};return fs.lstatSync(name)},openSync(){opens++;throw Error('Unexpected open')}}}),/Safe regular/)
 assert.equal(opens,0);assert.equal(fs.readFileSync(file,'utf8'),old)
})

test('a directory junction in any parent component is rejected before writing',t=>{
 const {folder}=fixture(t),real=path.join(folder,'real'),junction=path.join(folder,'linked')
 fs.mkdirSync(real);fs.symlinkSync(real,junction,'junction');const file=path.join(junction,'fixture-proof.json');let opens=0
 assert.throws(()=>writeReleaseEvidence(file,{result:'PASS'},{fsImpl:{...fs,openSync(){opens++;throw Error('Unexpected open')}}}),/Safe regular/)
 assert.equal(opens,0);assert.equal(fs.existsSync(path.join(real,'fixture-proof.json')),false)
})

test('directory and non-directory-parent targets are rejected without replacement',t=>{
 const {file,folder}=fixture(t);fs.mkdirSync(file)
 assert.throws(()=>writeReleaseEvidence(file,{result:'PASS'}),/Safe regular/)
 const parentFile=path.join(folder,'parent-file');fs.writeFileSync(parentFile,'Owned sentinel')
 assert.throws(()=>writeReleaseEvidence(path.join(parentFile,'proof.json'),{}),/Safe regular/)
 assert.equal(fs.readFileSync(parentFile,'utf8'),'Owned sentinel')
})

test('an unsafe created temp is closed and the previous proof is preserved',t=>{
 const {file}=fixture(t),old=oldProof(file);let renames=0
 assert.throws(()=>writeReleaseEvidence(file,{}, {randomId:()=>id,fsImpl:{...fs,fstatSync(fd){const actual=fs.fstatSync(fd);return{...actual,isFile:()=>true,nlink:2}},renameSync(){renames++;throw Error('Unexpected rename')}}}),/Safe regular/)
 assert.equal(renames,0);assert.equal(fs.readFileSync(file,'utf8'),old)
})

test('a destination changed before commit is not overwritten',t=>{
 const {file}=fixture(t),old=oldProof(file);let checks=0,renames=0
 assert.throws(()=>writeReleaseEvidence(file,{}, {randomId:()=>id,fsImpl:{...fs,lstatSync(name,options){const actual=fs.lstatSync(name,options);if(name===file&&++checks>1)return{...actual,isFile:()=>true,isSymbolicLink:()=>false,ino:actual.ino+1n};return actual},renameSync(){renames++;throw Error('Unexpected rename')}}}),/Safe regular/)
 assert.equal(renames,0);assert.equal(fs.readFileSync(file,'utf8'),old)
})

test('relative destinations and unsafe random temporary names are rejected',t=>{
 const {file}=fixture(t)
 assert.throws(()=>writeReleaseEvidence('relative-proof.json',{}),/Safe regular/)
 assert.throws(()=>writeReleaseEvidence(file,{}, {randomId:()=> '../foreign'}),/Safe regular/)
 assert.equal(fs.existsSync(file),false)
})

test('atomic identity checks retain large inode precision on every platform',t=>{
 const {file}=fixture(t);oldProof(file);let observed=0
 writeReleaseEvidence(file,{result:'PASS'},{fsImpl:{...fs,lstatSync(name,options){assert.equal(options.bigint,true);observed++;return fs.lstatSync(name,options)},fstatSync(fd,options){assert.equal(options.bigint,true);observed++;return fs.fstatSync(fd,options)}}})
 assert.ok(observed>2);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).result,'PASS')
})
