import test from 'node:test'
import assert from 'node:assert/strict'
import {verifyDriverEvidence} from './verify-driver-evidence.mjs'
import {assertNativeEvidenceTarget} from './verify-driver-evidence-concurrency.mjs'
const app='https://elite-dashboard-fixture-elitesaasc-5643.vercel.app',stage='https://viowrovartosrkqukjxy.supabase.co'
for(const[name,backend,url]of[
 ['production backend','https://wwfnsbilmyxeawgzicmv.supabase.co',app],
 ['production alias',stage,'https://elite-dashboard-blush.vercel.app'],
 ['unapproved backend','https://other.supabase.co',app],
])test('evidence browser helper rejects '+name+' before fixture access',async()=>{
 let writes=0,requests=0
 const admin={supabaseUrl:backend,from(){writes++;throw Error('Unexpected fixture access')}},page={request:{async get(){requests++;throw Error('Unexpected app request')}}}
 await assert.rejects(()=>verifyDriverEvidence(page,admin,'14400000-0000-4000-8000-000000000001',url),/production is forbidden/)
 assert.equal(writes,0);assert.equal(requests,0)
})
for(const[description,policy]of[
 ['mixed production CSP',"connect-src 'self' "+stage+' https://wwfnsbilmyxeawgzicmv.supabase.co'],
 ['wildcard CSP',"connect-src 'self' "+stage+' https://*.supabase.co'],
])test('evidence browser helper rejects '+description+' before fixture access',async()=>{
 let writes=0
 const page={request:{async get(){return{status:()=>200,headers:()=>({'content-security-policy':policy})}}}},admin={supabaseUrl:stage,from(){writes++;throw Error('Unexpected fixture access')}}
 await assert.rejects(()=>verifyDriverEvidence(page,admin,'14400000-0000-4000-8000-000000000001',app),/Staging CSP/);assert.equal(writes,0)
})
const owned={host:'127.0.0.1',port:59463,schemaOnly:true,database:'driver_evidence_0123456789abcdef0123456789abcdef'}
test('native concurrency helper accepts only the explicit owned schema-only loopback target',()=>assert.equal(assertNativeEvidenceTarget(owned),owned.database))
for(const[label,change]of[
 ['production host',{host:'wwfnsbilmyxeawgzicmv.supabase.co'}],['staging host',{host:'viowrovartosrkqukjxy.supabase.co'}],['other port',{port:5432}],['shared archive clone',{database:'modules_release_0123456789abcdef0123456789abcdef'}],['shared clean database',{database:'modules_clean_0123456789abcdef0123456789abcdef'}],['default database',{database:'postgres'}],['unproven schema-only source',{schemaOnly:false}],['injected database name',{database:owned.database+';DROP DATABASE postgres'}],
])test('native concurrency helper rejects '+label,()=>assert.throws(()=>assertNativeEvidenceTarget({...owned,...change}),/Only an owned schema-only/))
