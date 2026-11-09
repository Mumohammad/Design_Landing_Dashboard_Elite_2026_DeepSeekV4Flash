import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks=vi.hoisted(()=>({user:vi.fn(),can:vi.fn(),caller:vi.fn(),admin:vi.fn(),claims:vi.fn(),names:vi.fn(),settings:{data:null as unknown,error:null as unknown},from:vi.fn(),filters:[] as unknown[][]}))
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}))
vi.mock('@/lib/auth/authorization',()=>({getCurrentUser:mocks.user,can:mocks.can}))
vi.mock('@/lib/auth/rate-limit',()=>({rateLimit:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createClient:mocks.caller}))
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:mocks.admin}))
vi.mock('./attachments',()=>({registerStoredAttachment:vi.fn()}))
vi.mock('./telegram',()=>({getBotUsername:vi.fn(),telegramConfigured:vi.fn(),tg:vi.fn(),webhookUrl:vi.fn()}))
vi.mock('./complete-reads',()=>({readCompleteClaims:mocks.claims,readClaimDisplayNames:mocks.names,readCompleteAttachments:vi.fn()}))
import {getClaimSettings,getTenantUserNames} from './actions'
import {DEFAULT_SETTINGS} from './constants'

beforeEach(()=>{
 vi.clearAllMocks();mocks.filters=[];mocks.settings={data:null,error:null}
 mocks.user.mockResolvedValue({authUserId:'caller-id',tenantId:'tenant-id'})
 mocks.can.mockResolvedValue({allowed:true});mocks.claims.mockResolvedValue([]);mocks.names.mockResolvedValue({'caller-id':'Caller'})
 const q={select(){return q},eq(...args:unknown[]){mocks.filters.push(args);return q},maybeSingle:async()=>mocks.settings}
 mocks.from.mockReturnValue(q);mocks.caller.mockResolvedValue({from:mocks.from});mocks.admin.mockReturnValue({privileged:true})
})
describe('expense read authorization and settings failure boundaries',()=>{
 it('no session opens neither caller queries nor privileged directory access',async()=>{
  mocks.user.mockResolvedValue(null);expect(await getTenantUserNames()).toEqual({})
  await expect(getClaimSettings()).rejects.toThrow('unavailable');expect(mocks.admin).not.toHaveBeenCalled();expect(mocks.caller).not.toHaveBeenCalled()
 })
 it('denied permission or assurance stops before either database client',async()=>{
  mocks.can.mockResolvedValue({allowed:false});expect(await getTenantUserNames()).toEqual({})
  await expect(getClaimSettings()).rejects.toThrow('unavailable');expect(mocks.admin).not.toHaveBeenCalled();expect(mocks.caller).not.toHaveBeenCalled()
 })
 it('privileged names are bound only to actors from the caller RLS read and caller identity',async()=>{
  mocks.claims.mockResolvedValue([{submitter_id:'visible-submitter',reviewer_id:'visible-reviewer',verified_by:null}])
  expect(await getTenantUserNames()).toEqual({'caller-id':'Caller'})
  expect(mocks.names).toHaveBeenCalledWith({privileged:true},'tenant-id',['caller-id','visible-submitter','visible-reviewer'])
  expect(mocks.can.mock.calls.every(call=>call[0]==='expense_claims')).toBe(true)
 })
 it('a failed caller-visible claim read prevents privileged name access',async()=>{
  mocks.claims.mockRejectedValue(Error('unavailable'));await expect(getTenantUserNames()).rejects.toThrow('unavailable')
  expect(mocks.admin).not.toHaveBeenCalled();expect(mocks.names).not.toHaveBeenCalled()
 })
 it('settings error does not return default policy or initialize a row',async()=>{
  mocks.settings={data:null,error:{message:'sensitive database detail'}}
  await expect(getClaimSettings()).rejects.toThrow('Expense settings are unavailable')
  expect(mocks.admin).not.toHaveBeenCalled();expect(mocks.filters).toEqual([['tenant_id','tenant-id']])
 })
 it('successful authorized empty settings read uses initial defaults without a write',async()=>{
  expect(await getClaimSettings()).toEqual(DEFAULT_SETTINGS);expect(mocks.admin).not.toHaveBeenCalled()
 })
 it('returns the stored approval policy rather than replacing it with defaults',async()=>{
  mocks.settings.data={allow_self_approval:true,default_currency:'USD'}
  expect(await getClaimSettings()).toMatchObject({allow_self_approval:true,default_currency:'USD'});expect(mocks.admin).not.toHaveBeenCalled()
 })
})
