import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {requireApplicationTenantSlug} from '../e2e/staging-target.ts'

for(const value of ['a','tenant-a','95200000-0000-4000-8000-000000000001','a'.repeat(64)])test('application fixture accepts a canonical public slug of length '+value.length,()=>assert.equal(requireApplicationTenantSlug(value),value))
for(const value of [undefined,null,'','TENANT','-tenant','tenant-','a b','a/b','a?x','a#x','https://foreign.invalid','%2e%2e','tenant\n','a'.repeat(65),42])test('application fixture fails closed for '+JSON.stringify(value),()=>assert.throws(()=>requireApplicationTenantSlug(value),error=>{assert.equal(error.message,'A canonical E2E_TENANT_SLUG for an active synthetic staging tenant is required');return true}))

test('hosted CI supplies and requires the public fixture without conditionally skipping its tests',()=>{
 const workflow=fs.readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8')
 const start=workflow.indexOf('  e2e:'),end=workflow.indexOf('  # Full synthetic acceptance',start),job=workflow.slice(start,end)
 assert.ok(start>=0&&end>start)
 assert.ok(job.includes('E2E_TENANT_SLUG: $'+'{{ vars.E2E_TENANT_SLUG }}'))
 assert.match(job,/for var in [^\n]*\bE2E_TENANT_SLUG\b/)
 const tests=fs.readFileSync(new URL('../e2e/public-surface.spec.ts',import.meta.url),'utf8')
 assert.equal(tests.includes('test.skip(!slug'),false)
 assert.equal((tests.match(/const slug = requireApplicationTenantSlug\(\)/g)??[]).length,2)
})
