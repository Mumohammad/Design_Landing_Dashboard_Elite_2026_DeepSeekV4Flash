import {beforeEach,describe,expect,it,vi} from 'vitest'

const mocks=vi.hoisted(()=>({
  rpc:vi.fn(),permission:vi.fn(),user:vi.fn(),rate:vi.fn(),revalidate:vi.fn(),admin:vi.fn(),audit:vi.fn(),
}))
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc})}))
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:mocks.admin}))
vi.mock('@/lib/auth/authorization',()=>({requirePermission:mocks.permission,getCurrentUser:mocks.user}))
vi.mock('@/lib/auth/rate-limit',()=>({rateLimitExpenses:mocks.rate}))
vi.mock('@/lib/auth/sessions',()=>({writeAuditLog:mocks.audit}))
vi.mock('@/lib/accounting/dispatcher',()=>({runEventDispatcher:vi.fn()}))
vi.mock('@/lib/webhooks/events',()=>({emit:vi.fn()}))
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}))
import {createExpense} from './actions'

const request='11111111-1111-4111-8111-111111111111'
const id='22222222-2222-4222-8222-222222222222'
const valid={request_id:request,expense_type:'fuel' as const,amount:1.005,expense_date:'2026-10-19',vat_rate:15.555,category:'  Fuel  ',vendor:'  Vendor  ',description:'  Details  '}
beforeEach(()=>{
  vi.clearAllMocks()
  mocks.permission.mockResolvedValue(undefined)
  mocks.user.mockResolvedValue({id:'profile',tenantId:'tenant',authUserId:'actor'})
  mocks.rate.mockResolvedValue({success:true})
  mocks.rpc.mockResolvedValue({data:{id,replayed:false},error:null})
})
describe('pending expense transaction action',()=>{
  it('uses only the JWT-bound transaction with normalized inputs and confirmed identity',async()=>{
    expect(await createExpense(valid)).toEqual({success:true,id,replayed:false})
    expect(mocks.permission).toHaveBeenCalledWith('expenses','create')
    expect(mocks.rpc).toHaveBeenCalledWith('create_expense_atomic',{
      p_request_id:request,p_expense:{expense_type:'fuel',amount:1.01,expense_date:'2026-10-19',vat_rate:15.56,category:'Fuel',vendor:'Vendor',description:'Details'},
    })
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.revalidate).toHaveBeenCalledWith('/expenses')
  })
  it('returns the original identity on a replay',async()=>{
    mocks.rpc.mockResolvedValue({data:{id,replayed:true},error:null})
    expect(await createExpense(valid)).toEqual({success:true,id,replayed:true})
  })
  it.each([
    {request_id:''},{request_id:'invalid'},{expense_type:'unknown'},
    {amount:0},{amount:0.001},{amount:-1},{amount:NaN},{amount:Infinity},{amount:1e8},{amount:'1.00'},
    {expense_date:'2026-02-30'},{expense_date:'2026-1-1'},{expense_date:''},{expense_date:'0000-01-01'},
    {vat_rate:101},{vat_rate:-1},{vat_rate:Infinity},{vat_rate:'15'},
    {category:'x'.repeat(201)},{vendor:'x'.repeat(201)},{description:'x'.repeat(2001)},{vendor:{}},
  ])('rejects invalid input before any database mutation: %j',async patch=>{
    expect((await createExpense({...valid,...patch} as typeof valid)).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('accepts a real leap day and normalizes empty optional fields',async()=>{
    await createExpense({...valid,expense_date:'2028-02-29',category:' ',vendor:'',description:'',vat_rate:0})
    expect(mocks.rpc.mock.calls[0][1].p_expense).toMatchObject({expense_date:'2028-02-29',category:null,vendor:null,description:null,vat_rate:0})
  })
  it.each(['permission','session','rate'])('does not mutate after a denied %s',async kind=>{
    if(kind==='permission')mocks.permission.mockRejectedValue(Error('denied'))
    if(kind==='session')mocks.user.mockResolvedValue(null)
    if(kind==='rate')mocks.rate.mockResolvedValue({success:false})
    expect((await createExpense(valid)).success).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each(['EXP_RETRY: mismatch','EXP_RETRY_UNAVAILABLE: deleted'])('requires review for %s',async message=>{
    mocks.rpc.mockResolvedValue({data:null,error:{message}})
    const result=await createExpense(valid)
    expect(result.success).toBe(false);expect(result.error).toMatch(/review/);expect(result.errorAr).toBeTruthy()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it.each([null,{id:'invalid',replayed:false},{id,replayed:'false'}])('rejects unconfirmed RPC results',async data=>{
    mocks.rpc.mockResolvedValue({data,error:null})
    expect((await createExpense(valid)).error).toMatch(/Retry with unchanged details/)
  })
  it('contains transport/diagnostic failures without leaking their details',async()=>{
    mocks.rpc.mockRejectedValue(Error('sensitive internal diagnostics'))
    const result=await createExpense(valid)
    expect(result.success).toBe(false);expect(result.error).toMatch(/Retry with unchanged details/)
    expect(JSON.stringify(result)).not.toContain('sensitive')
  })
})
