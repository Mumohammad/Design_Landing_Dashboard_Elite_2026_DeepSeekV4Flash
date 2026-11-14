import test from 'node:test'
import assert from 'node:assert/strict'
import { requirePristineExpenseScope, verifyExpensesOverview } from './verify-local-expenses.mjs'
function scope(result) {
  const reads=[]
  const admin={supabaseUrl:'http://127.0.0.1:58321',from(table) {
    assert.equal(table,'expenses')
    return {select(fields,options) {
      reads.push({table,fields,options})
      return {eq(key,value) {
        reads.at(-1).tenant={key,value}
        return {is(key,value) {reads.at(-1).active={key,value};return Promise.resolve(result)}}
      }}
    }}
  }}
  return {admin,reads}
}
test('fresh expense scope requires a complete tenant-bound active count',async()=>{
  const {admin,reads}=scope({count:0,error:null})
  await requirePristineExpenseScope(admin,'owned-tenant')
  assert.deepEqual(reads,[{table:'expenses',fields:'id',options:{count:'exact',head:true},tenant:{key:'tenant_id',value:'owned-tenant'},active:{key:'deleted_at',value:null}}])
})
test('retained approval fixtures stop acceptance before UI or fixture writes',async()=>{
  const {admin,reads}=scope({count:105,error:null})
  const page=new Proxy({}, {get(){assert.fail('No UI or fixture setup permitted in a contaminated scope')}})
  await assert.rejects(verifyExpensesOverview(page,admin,'owned-tenant','http://127.0.0.1:3107'),/pristine synthetic tenant/)
  assert.equal(reads.length,1)
})
test('unknown or failed counts cannot be accepted as an empty expense scope',async()=>{
  for(const result of [{count:null,error:null},{count:undefined,error:null},{count:0,error:{message:'unavailable'}}]) {
    const {admin}=scope(result)
    await assert.rejects(requirePristineExpenseScope(admin,'owned-tenant'),/pristine synthetic tenant/)
  }
})
test('missing tenant fails before an administrator read',async()=>{
  const admin={from(){assert.fail('Unscoped administrator read')}}
  await assert.rejects(requirePristineExpenseScope(admin,''),/Synthetic tenant required/)
})
