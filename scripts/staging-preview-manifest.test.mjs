import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import { previewFromManifest, readPreviewManifest, waitForPreviewManifest, assertTrustedPreviewEvent, PreviewManifestError, PREVIEW_REPOSITORY, PREVIEW_BRANCH, PREVIEW_BACKEND, PREVIEW_PROJECT, PREVIEW_TEAM, PREVIEW_REGISTRY_URL } from './lib/staging-preview-manifest.mjs'
import { configureStagingPreview } from './resolve-staging-preview.mjs'
const commit='a'.repeat(40),other='b'.repeat(40),appUrl='https://elite-dashboard-tested123-elitesaasc-5643.vercel.app',token='fabricated-ci-token'
const entry=(sha=commit)=>({commit:sha,appUrl,deploymentId:'dpl_fabricated12345',projectId:PREVIEW_PROJECT,teamId:PREVIEW_TEAM,backendProject:PREVIEW_BACKEND,environment:'preview',branch:PREVIEW_BRANCH,verifiedAt:'2026-11-10T00:00:00.000Z'})
const manifest=()=>({schemaVersion:1,repository:PREVIEW_REPOSITORY,previews:{[commit]:entry()}})
const event=()=>({pull_request:{head:{sha:commit,ref:PREVIEW_BRANCH,repo:{full_name:PREVIEW_REPOSITORY}},base:{ref:'master',repo:{full_name:PREVIEW_REPOSITORY}}}})
const env=()=>({GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'pull_request',GITHUB_REPOSITORY:PREVIEW_REPOSITORY,STAGING_MANIFEST_COMMIT:commit,GH_TOKEN:token,GITHUB_ENV:path.resolve('synthetic-runner-env')})
const code=wanted=>error=>error instanceof PreviewManifestError&&error.code===wanted&&!error.message.includes(token)

test('selects only the exact immutable commit entry',()=>{const m=manifest();m.previews[other]=entry(other);assert.equal(previewFromManifest(m,commit),appUrl);assert.throws(()=>previewFromManifest(m,'c'.repeat(40)),code('PREVIEW_MANIFEST_PENDING'))})
for(const value of [undefined,'',commit.toUpperCase(),commit.slice(1),42])test('rejects invalid expected commit '+String(value),()=>assert.throws(()=>previewFromManifest(manifest(),value),code('PREVIEW_MANIFEST_INVALID')))
for(const [name,change] of [
 ['schema version',m=>m.schemaVersion=2],['foreign repository',m=>m.repository='foreign/repository'],['extra root field',m=>m.private='private'],['missing previews',m=>delete m.previews],['array previews',m=>m.previews=[]],['too many entries',m=>m.previews=Object.fromEntries(Array.from({length:129},(_,i)=>[i.toString(16).padStart(40,'0'),entry(i.toString(16).padStart(40,'0'))]))],
 ['different keyed commit',m=>m.previews[commit].commit=other],['foreign project',m=>m.previews[commit].projectId='foreign'],['foreign team',m=>m.previews[commit].teamId='foreign'],['Production backend',m=>m.previews[commit].backendProject='wwfnsbilmyxeawgzicmv'],['Production environment',m=>m.previews[commit].environment='production'],['different branch',m=>m.previews[commit].branch='master'],['missing entry field',m=>delete m.previews[commit].deploymentId],['extra credential field',m=>m.previews[commit].token='private'],['bad deployment id',m=>m.previews[commit].deploymentId='bad'],['bad verification timestamp',m=>m.previews[commit].verifiedAt='not-a-date'],['malformed unused entry',m=>m.previews[other]={}],
])test('manifest fails closed for '+name,()=>{const m=manifest();change(m);assert.throws(()=>previewFromManifest(m,commit),code('PREVIEW_MANIFEST_INVALID'))})
for(const url of ['http://localhost:3000','https://elite-dashboard-blush.vercel.app','https://elite-dashboard-git-feature-elitesaasc-5643.vercel.app','https://elite-dashboard-tested123-foreign.vercel.app',appUrl+'/',appUrl+'/landing',appUrl+'?token=private',appUrl+'#private',appUrl.replace('https://','https://user:private@'),appUrl+':8443',appUrl.toUpperCase(),'https://foreign.invalid'])test('rejects noncanonical or foreign target '+url,()=>{const m=manifest();m.previews[commit].appUrl=url;assert.throws(()=>previewFromManifest(m,commit),code('PREVIEW_MANIFEST_INVALID'))})
test('validates same-repository release PR context',()=>assert.doesNotThrow(()=>assertTrustedPreviewEvent(event(),commit,PREVIEW_REPOSITORY)))
for(const [name,change] of [['fork',e=>e.pull_request.head.repo.full_name='foreign/fork'],['wrong branch',e=>e.pull_request.head.ref='feature'],['stale SHA',e=>e.pull_request.head.sha=other],['wrong base',e=>e.pull_request.base.ref='other'],['foreign base',e=>e.pull_request.base.repo.full_name='foreign/repo']])test('denies '+name+' before registry access',()=>{const e=event();change(e);assert.throws(()=>assertTrustedPreviewEvent(e,commit,PREVIEW_REPOSITORY),code('PREVIEW_CONTEXT'))})

test('sends only GitHub read identity to a fixed API URL and never follows redirects',async()=>{
 const result=await readPreviewManifest(commit,token,{fetchImpl:async(url,options)=>{assert.equal(url,PREVIEW_REGISTRY_URL);assert.equal(new URL(url).origin,'https://api.github.com');assert.equal(options.redirect,'manual');assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'Bearer '+token);assert.ok(options.signal instanceof AbortSignal);assert.deepEqual(Object.keys(options.headers).sort(),['Accept','Authorization','X-GitHub-Api-Version']);return new Response(JSON.stringify(manifest()))}})
 assert.equal(result,appUrl)
})
for(const [status,wanted] of [[404,'PREVIEW_MANIFEST_PENDING'],[401,'PREVIEW_REGISTRY_AUTH'],[403,'PREVIEW_REGISTRY_AUTH'],[500,'PREVIEW_REGISTRY_UNAVAILABLE'],[302,'PREVIEW_MANIFEST_INVALID'],[307,'PREVIEW_MANIFEST_INVALID'],[204,'PREVIEW_MANIFEST_INVALID']])test('registry HTTP '+status+' cannot select a target',async()=>assert.rejects(()=>readPreviewManifest(commit,token,{fetchImpl:async()=>new Response(null,{status})}),code(wanted)))
for(const value of [undefined,'','private\nheader','x'.repeat(4097)])test('rejects absent/unsafe registry identity without a request '+String(value?.length),async()=>assert.rejects(()=>readPreviewManifest(commit,value,{fetchImpl:async()=>assert.fail('No request permitted')}),code('PREVIEW_CONTEXT')))
test('network and JSON errors never expose supplied private diagnostic text',async()=>{
 await assert.rejects(()=>readPreviewManifest(commit,token,{fetchImpl:async()=>{throw Error(token)}}),code('PREVIEW_REGISTRY_UNAVAILABLE'))
 await assert.rejects(()=>readPreviewManifest(commit,token,{fetchImpl:async()=>new Response(token)}),code('PREVIEW_MANIFEST_INVALID'))
})
test('oversized streamed manifest is cancelled at 64 KiB',async()=>{
 let cancelled=false
 const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(65537))},cancel(){cancelled=true}})
 await assert.rejects(()=>readPreviewManifest(commit,token,{fetchImpl:async()=>new Response(body)}),code('PREVIEW_MANIFEST_INVALID'));assert.equal(cancelled,true)
})
test('waits for exact publication without using any stale environment URL',async()=>{
 let clock=0,reads=0;const sleeps=[]
 const result=await waitForPreviewManifest(commit,token,{read:async(c,t)=>{assert.equal(c,commit);assert.equal(t,token);if(++reads<3)throw new PreviewManifestError('PREVIEW_MANIFEST_PENDING');return appUrl},now:()=>clock,sleep:async ms=>{clock+=ms;sleeps.push(ms)}})
 assert.equal(result,appUrl);assert.deepEqual(sleeps,[5000,5000]);assert.equal(reads,3)
})
test('bounded publication wait fails and authentication is not retried',async()=>{
 let clock=0,reads=0
 await assert.rejects(()=>waitForPreviewManifest(commit,token,{read:async()=>{reads++;throw new PreviewManifestError('PREVIEW_MANIFEST_PENDING')},now:()=>clock,sleep:async ms=>{clock+=ms},timeoutMs:6000}),code('PREVIEW_MANIFEST_PENDING'));assert.equal(clock,6000);assert.equal(reads,2)
 await assert.rejects(()=>waitForPreviewManifest(commit,token,{read:async()=>{throw new PreviewManifestError('PREVIEW_REGISTRY_AUTH')},sleep:async()=>assert.fail('Authentication cannot be retried')}),code('PREVIEW_REGISTRY_AUTH'))
})
for(const timeoutMs of [0,300001,NaN,Infinity])test('rejects unbounded/invalid publication wait '+String(timeoutMs),async()=>assert.rejects(()=>waitForPreviewManifest(commit,token,{timeoutMs,read:async()=>assert.fail('No request with invalid deadline')}),code('PREVIEW_CONTEXT')))
test('only writes public future-step URLs after unchanged live preflight passes',async()=>{
 const calls=[],gate=Promise.withResolvers();let written=''
 const work=configureStagingPreview({env:env(),event:event(),resolve:async(c,t)=>{assert.equal(c,commit);assert.equal(t,token);calls.push('resolve');return appUrl},preflight:async target=>{assert.deepEqual(target,{backendUrl:'https://'+PREVIEW_BACKEND+'.supabase.co',appUrl,expectedCommit:commit});calls.push('preflight');await gate.promise},writeEnv:value=>{calls.push('write');written=value}})
 await new Promise(resolve=>setImmediate(resolve));assert.equal(written,'');gate.resolve();const result=await work
 assert.deepEqual(calls,['resolve','preflight','write']);assert.equal(written,'BASE_URL='+appUrl+'\nVERIFY_APP_URL='+appUrl+'\n');assert.equal(written.includes(token),false);assert.equal(result.result,'PASS')
})
test('failed preflight or foreign resolver output cannot write environment or create fixtures',async()=>{
 for(const target of [appUrl,'https://foreign.invalid'])await assert.rejects(()=>configureStagingPreview({env:env(),event:event(),resolve:async()=>target,preflight:async()=>{throw Error('Synthetic preflight unavailable')},writeEnv:()=>assert.fail('No environment write before verified preflight')}))
})
test('wrong job event is denied before any network access',async()=>{
 for(const [key,value] of [['GITHUB_ACTIONS','false'],['GITHUB_EVENT_NAME','push'],['GITHUB_REPOSITORY','foreign/repo'],['GITHUB_ENV','relative'],['GITHUB_ENV','/tmp/name\ninjected']])await assert.rejects(()=>configureStagingPreview({env:{...env(),[key]:value},event:event(),resolve:async()=>assert.fail('No request for untrusted context')}),code('PREVIEW_CONTEXT'))
})
test('both hosted jobs resolve their immutable target before configuration/fixture allocation',()=>{
 const workflow=fs.readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8')
 const e2e=workflow.slice(workflow.indexOf('  e2e:'),workflow.indexOf('  # Full synthetic acceptance'))
 const acceptance=workflow.slice(workflow.indexOf('  staging_acceptance:'))
 assert.ok(e2e.includes('timeout-minutes: 25'))
 for(const [job,later] of [[e2e,'    - name: Verify E2E configuration'],[acceptance,'    - name: Validate isolated configuration and allocate owned run']]){
  const selector=job.indexOf('    - name: Select exact-commit staging Preview')
  assert.ok(selector>=0&&selector<job.indexOf(later));assert.ok(job.includes('run: node scripts/resolve-staging-preview.mjs'));assert.ok(job.includes('GH_TOKEN: $'+'{{ github.token }}'));assert.ok(job.includes('STAGING_MANIFEST_COMMIT: $'+'{{ github.event.pull_request.head.sha }}'))
 }
})
