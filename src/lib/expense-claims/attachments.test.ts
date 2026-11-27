import {createHash} from 'node:crypto'
import {beforeEach,describe,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({admin:vi.fn(),rpc:vi.fn(),from:vi.fn(),remove:vi.fn(),download:vi.fn(),upload:vi.fn(),filters:[] as unknown[][],attachment:{data:null as unknown,error:null as unknown},claim:{data:null as unknown,error:null as unknown}}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:mocks.admin}))
import {registerStoredAttachment} from './attachments'

const tenant='11111111-1111-4111-8111-111111111111',claim='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444'
const storagePath=`${tenant}/${claim}/55555555-5555-4555-8555-555555555555.jpg`,bytes=Uint8Array.from([255,216,255,1,2,3])
const args={actor,tenantId:tenant,claimId:claim,path:storagePath,originalName:'receipt.jpg',source:'web' as const,bytes}
const row=()=>({id,tenant_id:tenant,claim_id:claim,storage_path:storagePath,uploaded_by:actor,source:'web',original_filename:'receipt.jpg',sha256:createHash('sha256').update(bytes).digest('hex'),size_bytes:bytes.length,mime_type:'image/jpeg',doc_kind:'photo'})
beforeEach(()=>{
 vi.clearAllMocks();mocks.filters=[];mocks.attachment={data:null,error:null};mocks.claim={data:{id:claim,tenant_id:tenant,duplicate_status:'none'},error:null}
 mocks.remove.mockResolvedValue({error:null});mocks.download.mockResolvedValue({data:new Blob([bytes]),error:null});mocks.rpc.mockResolvedValue({data:{id,duplicate_status:'possible'},error:null})
 mocks.from.mockImplementation((table:string)=>{const q={select:()=>q,eq:(...filter:unknown[])=>{mocks.filters.push([table,...filter]);return q},maybeSingle:async()=>table==='expense_claim_attachments'?mocks.attachment:mocks.claim};return q})
 mocks.admin.mockReturnValue({rpc:mocks.rpc,from:mocks.from,storage:{from:()=>({remove:mocks.remove,download:mocks.download,upload:mocks.upload})}})
})
describe('receipt registration outcome recovery',()=>{
 it('returns a valid committed response without a recovery read or deletion',async()=>{
  expect(await registerStoredAttachment(args)).toEqual({ok:true,id,duplicateStatus:'possible'});expect(mocks.from).not.toHaveBeenCalled();expect(mocks.remove).not.toHaveBeenCalled()
 })
 it.each([{code:'',message:'synthetic lost response'},{code:'23505',message:'synthetic unique-path retry'}])('recovers only the exact already registered receipt after $code',async error=>{
  mocks.rpc.mockResolvedValue({data:null,error});mocks.attachment.data=row()
  expect(await registerStoredAttachment(args)).toEqual({ok:true,id,duplicateStatus:'none'});expect(mocks.remove).not.toHaveBeenCalled()
  for(const filter of [['tenant_id',tenant],['claim_id',claim],['storage_path',storagePath],['uploaded_by',actor]])expect(mocks.filters).toContainEqual(['expense_claim_attachments',...filter])
 })
 it('retains the original and recovers when the RPC throws after committing',async()=>{
  mocks.rpc.mockRejectedValue(Error('synthetic transport detail'));mocks.attachment.data=row()
  expect(await registerStoredAttachment(args)).toEqual({ok:true,id,duplicateStatus:'none'});expect(mocks.remove).not.toHaveBeenCalled()
 })
 it.each(['tenant_id','claim_id','storage_path','uploaded_by','source','sha256','size_bytes','mime_type','doc_kind','original_filename'])('rejects a mismatching %s without removing another original',async field=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:'',message:'unknown'}});mocks.attachment.data={...row(),[field]:field==='size_bytes'?999:'different'}
  expect(await registerStoredAttachment(args)).toMatchObject({ok:false});expect(mocks.remove).not.toHaveBeenCalled()
 })
 it('failed recovery reads are failure, not proof that an original can be deleted',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:'',message:'sensitive provider detail'}});mocks.attachment={data:null,error:{message:'sensitive read detail'}}
  const result=await registerStoredAttachment(args);expect(result).toMatchObject({ok:false});expect(JSON.stringify(result)).not.toContain('sensitive');expect(mocks.remove).not.toHaveBeenCalled()
 })
 it.each(['AUTH007','EXC004','EXC014'])('does not turn a definite %s rejection into a recovered success',async code=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:'P0001',message:code}});mocks.attachment.data=row()
  expect(await registerStoredAttachment(args)).toMatchObject({ok:false});expect(mocks.from).not.toHaveBeenCalled();expect(mocks.remove).not.toHaveBeenCalled()
 })
 it('invalid content remains rejected without speculative object deletion',async()=>{
  expect(await registerStoredAttachment({...args,bytes:Uint8Array.from([1,2,3])})).toMatchObject({ok:false});expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.remove).not.toHaveBeenCalled()
 })
 it('rejects an invalid successful RPC result instead of fabricating an attachment',async()=>{
  mocks.rpc.mockResolvedValue({data:{id:'invalid',duplicate_status:'unknown'},error:null})
  expect(await registerStoredAttachment(args)).toMatchObject({ok:false});expect(mocks.remove).not.toHaveBeenCalled()
 })
 it('rejects an unscoped path before opening a privileged client',async()=>{
  expect(await registerStoredAttachment({...args,path:`${tenant}/66666666-6666-4666-8666-666666666666/file.jpg`})).toMatchObject({ok:false});expect(mocks.admin).not.toHaveBeenCalled()
 })
 it('a thrown definite permission rejection cannot recover an older receipt',async()=>{
  mocks.rpc.mockRejectedValue(Object.assign(Error('synthetic permission detail'),{code:'42501'}));mocks.attachment.data=row()
  expect(await registerStoredAttachment(args)).toMatchObject({ok:false});expect(mocks.from).not.toHaveBeenCalled();expect(mocks.remove).not.toHaveBeenCalled()
 })
 it('a failed object read stays a safe failure without registration or deletion',async()=>{
  mocks.download.mockRejectedValue(Error('sensitive object read detail'))
  const result=await registerStoredAttachment({...args,bytes:undefined});expect(result).toMatchObject({ok:false});expect(JSON.stringify(result)).not.toContain('sensitive');expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.remove).not.toHaveBeenCalled()
 })
 it.each([{id:claim,tenant_id:tenant,duplicate_status:'invalid'},{id:actor,tenant_id:tenant,duplicate_status:'none'},{id:claim,tenant_id:actor,duplicate_status:'none'},null])('cannot recover an unavailable or mismatching claim status',async data=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:'',message:'unknown'}});mocks.attachment.data=row();mocks.claim.data=data
  expect(await registerStoredAttachment(args)).toMatchObject({ok:false});expect(mocks.remove).not.toHaveBeenCalled()
 })
 it('recovers a committed receipt even when the success response is malformed',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:null});mocks.attachment.data=row()
  expect(await registerStoredAttachment(args)).toEqual({ok:true,id,duplicateStatus:'none'});expect(mocks.remove).not.toHaveBeenCalled()
 })
 it('does not trust an invalid ID in the recovered attachment',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:'',message:'unknown'}});mocks.attachment.data={...row(),id:'invalid'}
  expect(await registerStoredAttachment(args)).toMatchObject({ok:false});expect(mocks.remove).not.toHaveBeenCalled()
 })
})
