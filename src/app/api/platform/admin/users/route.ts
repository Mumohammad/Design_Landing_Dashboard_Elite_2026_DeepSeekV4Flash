import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { z } from 'zod';
import { verifyPlatformAdmin } from '@/lib/platform/admin-guard';
import { fetchAllRows } from '@/lib/supabase/all-rows';
import { authCallbackUrlWithReturn } from '@/lib/redirects';
import { isValidNewPassword } from '@/lib/auth/password-policy';
import { hashInviteToken } from '@/lib/auth/invite-tokens';
import { sendInviteEmail } from '@/lib/auth/invite-email';

type UserRow={id:string;auth_user_id:string;tenant_id:string;email:string;full_name_en:string|null;full_name_ar:string|null;role:string;status:string;version:string|number;created_at:string;last_login_at:string|null};
type TenantRow={id:string;name_en:string;status:string;deleted_at:string|null};
type AdminRow={user_id:string};
type RoleRow={tenant_id:string;name:string};
const roles = ['admin','accountant','supervisor','hr_officer','operations_officer','payroll_officer','platform_coordinator','readonly_auditor'] as const;
const version = z.union([z.string().regex(/^[1-9][0-9]*$/),z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]).transform(String);
const reason = z.string().trim().min(5).max(500);
const createSchema = z.object({ request_id:z.uuid(),tenant_id:z.uuid(),email:z.email().max(254).transform(v=>v.toLowerCase()),full_name:z.string().trim().max(150).optional(),role:z.enum(roles),password:z.string().optional() }).strict();
const patchSchema = z.object({user_id:z.uuid(),expected_version:version,reason,role:z.enum(roles).optional(),status:z.enum(['active','inactive','locked','terminated']).optional(),reset_password:z.literal(true).optional()}).strict().refine(v=>[v.role,v.status,v.reset_password].filter(v=>v!==undefined).length===1);
const archiveSchema = z.object({user_id:z.uuid(),expected_version:version,reason}).strict();
const failure = (error:string,status=503,errorAr='تعذر إكمال العملية. تحقق من الحالة ثم حاول مجدداً.') => NextResponse.json({error,error_ar:errorAr},{status});
function dbFailure(error:{code?:string;message?:string}|null) {
  if(error?.code==='42501')return failure('This account is protected or you no longer have permission.',403,'هذا الحساب محمي أو لم تعد لديك صلاحية لإجراء العملية.');
  if(error?.code==='40001')return failure('This record changed. Reload before saving.',409,'تم تعديل السجل. أعد تحميل البيانات قبل الحفظ.');
  if(error?.message==='PUM_LAST_OWNER')return failure('The last active general manager must remain available.',409,'يجب الإبقاء على مدير عام نشط واحد على الأقل.');
  if(error?.message==='PUM_DEACTIVATE_FIRST')return failure('Deactivate the account before archiving it.',409,'أوقف تفعيل الحساب قبل أرشفته.');
  if(error?.code==='23505')return failure('An account or pending invitation already uses this email.',409,'يوجد حساب أو دعوة سارية بهذا البريد.');
  if(error?.code==='P0002')return failure('The account or creation request was not found.',404,'لم يتم العثور على الحساب أو طلب الإنشاء.');
  if(error?.code==='22023')return failure('Select an active supported role and enter valid operation details.',400,'اختر دوراً مدعوماً ونشطاً وأدخل تفاصيل صحيحة للعملية.');
  if(error?.code==='55000')return failure('The tenant or account is not available for this operation.',409,'حالة المنشأة أو الحساب لا تسمح بهذه العملية.');
  return failure('The result could not be confirmed. Reload or retry the same request.');
}

export async function GET(req:NextRequest) {
  const guard=await verifyPlatformAdmin(req);
  if(!guard.ok)return failure('Forbidden',guard.status);
  try {
    const results=await Promise.all([
      fetchAllRows<UserRow>(()=>guard.service.from('users').select('id,auth_user_id,tenant_id,email,full_name_en,full_name_ar,role,status,version,created_at,last_login_at').is('deleted_at',null).order('created_at',{ascending:false}).order('id')),
      fetchAllRows<TenantRow>(()=>guard.service.from('tenants').select('id,name_en,status,deleted_at').order('id')),
      fetchAllRows<AdminRow>(()=>guard.service.from('platform_admins').select('user_id').order('user_id')),
      fetchAllRows<RoleRow>(()=>guard.service.from('roles').select('tenant_id,name').is('deleted_at',null).order('tenant_id').order('name')),
    ]);
    if(results.some(r=>r.error))return failure('The user roster could not be loaded. Retry.');
    const users=results[0].data??[],tenants=results[1].data??[],admins=results[2].data??[],configuredRoles=results[3].data??[];
    const companies=new Map(tenants.map(t=>[t.id,t]));
    const protectedIds=new Set(admins.map(a=>a.user_id));
    return NextResponse.json({users:users.map(u=>({...u,version:String(u.version),company_name:companies.get(u.tenant_id)?.name_en??'—',protected:u.auth_user_id===guard.userId||protectedIds.has(u.auth_user_id),tenant_active:companies.get(u.tenant_id)?.status==='active'&&!companies.get(u.tenant_id)?.deleted_at})),active_roles:configuredRoles.filter(r=>r.name!=='general_manager')});
  }catch{return failure('The user roster could not be loaded. Retry.');}
}

export async function POST(req:NextRequest) {
  const guard=await verifyPlatformAdmin(req);
  if(!guard.ok)return failure('Forbidden',guard.status);
  try {
    const parsed=createSchema.safeParse(await req.json());
    if(!parsed.success)return failure('Enter valid user details and keep the creation request ID.',400);
    const input=parsed.data;
    if(input.password!==undefined&&!isValidNewPassword(input.password))return failure('Use 10–128 characters, including at least one English letter and one number.',400);
    if(input.password===undefined) {
      // Validate the configured HTTPS callback origin before persisting an invitation.
      authCallbackUrlWithReturn();
      const token=crypto.randomUUID(),tokenId=crypto.randomUUID();
      const args={p_request_id:input.request_id,p_tenant_id:input.tenant_id,p_email:input.email,p_role:input.role,p_full_name:input.full_name??null,p_token_id:tokenId,p_token_hash:await hashInviteToken(token),p_expires_at:new Date(Date.now()+7*86400000).toISOString()};
      let issued=await guard.caller.rpc('issue_platform_user_invite',args);
      if(issued.error||!issued.data?.id)issued=await guard.caller.rpc('issue_platform_user_invite',args);
      const {data,error}=issued;
      if(error||!data?.id)return dbFailure(error);
      if(data.replayed&&!data.send_current_token)return NextResponse.json({success:true,kind:'invitation',delivery:'unconfirmed',notice:'This invitation already exists. Its original link is unchanged; check delivery before sending another.'});
      let queued=false;try{queued=await sendInviteEmail(input.email,token,tokenId);}catch{ /* Keep the pending invitation; never claim email delivery. */ }
      return NextResponse.json({success:true,kind:'invitation',delivery:queued?'queued':'unavailable'});
    }
    const {data:reserved,error:reserveError}=await guard.caller.rpc('reserve_platform_user',{p_request_id:input.request_id,p_tenant_id:input.tenant_id,p_email:input.email,p_role:input.role,p_full_name:input.full_name??null});
    if(reserveError||!z.uuid().safeParse(reserved?.auth_user_id).success)return dbFailure(reserveError);
    const authId=reserved.auth_user_id as string;
    const bound=(user:User|null)=>!!user&&user.id===authId&&user.email?.trim().toLowerCase()===input.email&&!!user.email_confirmed_at&&user.app_metadata?._invite_provisioned===true&&user.app_metadata?._platform_provision_request===input.request_id&&user.app_metadata?._platform_provision_tenant===input.tenant_id&&user.app_metadata?._platform_provision_actor===guard.userId;
    const lookup=async()=>{const result=await guard.service.auth.admin.getUserById(authId);if(result.error&&result.error.status!==404)throw new Error('Identity outcome unconfirmed');return result.data.user;};
    let user=await lookup(),recovered=!!user;
    if(!user) {
      try {
        const result=await guard.service.auth.admin.createUser({id:authId,email:input.email,password:input.password,email_confirm:true,app_metadata:{_invite_provisioned:true,_platform_provision_request:input.request_id,_platform_provision_tenant:input.tenant_id,_platform_provision_actor:guard.userId}});
        user=result.data.user;
        if(result.error||!user){user=await lookup();recovered=true;}
      }catch{user=await lookup();recovered=true;}
    }
    if(!bound(user))return failure('Creation could not be confirmed. Retry this same request; do not change the initial password.');
    // This database finalization is idempotent; Auth creation is a separate service.
    let finalized=await guard.caller.rpc('finalize_platform_user',{p_request_id:input.request_id});
    if(finalized.error||!finalized.data?.id)finalized=await guard.caller.rpc('finalize_platform_user',{p_request_id:input.request_id});
    if(finalized.error||!finalized.data?.id)return dbFailure(finalized.error);
    return NextResponse.json({success:true,kind:'user',id:finalized.data.id,...(recovered||finalized.data.replayed?{notice:'The original password is preserved. Use the original password or Forgot password; this retry did not replace it.'}:{})});
  }catch{return failure('Creation could not be confirmed. Retry this same request; no existing password was changed.');}
}

export async function PATCH(req:NextRequest) {
  const guard=await verifyPlatformAdmin(req);
  if(!guard.ok)return failure('Forbidden',guard.status);
  try {
    const parsed=patchSchema.safeParse(await req.json());
    if(!parsed.success)return failure('Choose one operation, a current record version, and a reason of 5–500 characters.',400);
    const v=parsed.data;
    const redirectTo=v.reset_password?authCallbackUrlWithReturn():undefined;
    const action=v.role!==undefined?'role':v.status!==undefined?'status':'reset_request';
    const {data,error}=await guard.caller.rpc('mutate_platform_user',{p_action:action,p_user_id:v.user_id,p_expected_version:v.expected_version,p_input:{reason:v.reason,...(v.role!==undefined?{role:v.role}:{}),...(v.status!==undefined?{status:v.status}:{})}});
    if(error||!data?.id)return dbFailure(error);
    if(v.reset_password) {
      if(typeof data.email!=='string')return failure('Password recovery could not be requested.');
      const result=await guard.service.auth.resetPasswordForEmail(data.email,{redirectTo});
      if(result.error)return failure('The password recovery provider did not accept the request. No delivery is confirmed.');
      return NextResponse.json({success:true,delivery:'requested',notice:'Password recovery was requested. Email delivery is not confirmed.'});
    }
    return NextResponse.json({success:true,id:data.id,version:data.version});
  }catch{return failure('The operation could not be confirmed. Reload before retrying.');}
}

export async function DELETE(req:NextRequest) {
  const guard=await verifyPlatformAdmin(req);
  if(!guard.ok)return failure('Forbidden',guard.status);
  try {
    const parsed=archiveSchema.safeParse(await req.json());
    if(!parsed.success)return failure('Provide the current record version and a reason of 5–500 characters.',400);
    const v=parsed.data;
    const {data,error}=await guard.caller.rpc('mutate_platform_user',{p_action:'archive',p_user_id:v.user_id,p_expected_version:v.expected_version,p_input:{reason:v.reason}});
    if(error||!data?.id)return dbFailure(error);
    return NextResponse.json({success:true,id:data.id,version:data.version});
  }catch{return failure('Archive could not be confirmed. Reload before retrying.');}
}
