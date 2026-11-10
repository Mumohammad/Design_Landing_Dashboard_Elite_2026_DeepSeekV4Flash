"use server"

// Invite Server Actions for the EliteDev Phase 2 application layer.
//
// Implements the invite flow described in docs/phase-2-auth-plan.md section 6:
//   - createInvite        (GM-only)         issues a hashed-token invite + email
//   - acceptInvite        (public, token)   creates auth.users + users + memberships
//   - revokeInvite        (GM-only)         cancels a pending invite
//   - listPendingInvites  (read)            lists pending invites for the tenant
//
// Token storage: the plaintext token is generated with crypto.randomUUID()
// and stored as a bcrypt hash (cost 10) — salted, so an equality lookup on
// `token_hash` is impossible. The accept-invite link carries a NON-secret
// `tid` (token_id, O(1) index lookup — migration 057) alongside the `token`
// (secret); accept verifies with bcrypt.compare (auth plan 6.3/6.7/6.8).
// Legacy pre-057 invites (SHA-256) still verify via the format-detecting
// verifyInviteToken fallback. The plaintext token NEVER touches the DB.
//
// Server-side only. Uses the service-role admin client for operations that
// bypass RLS (invite acceptance — a public flow with no session, plus
// atomic audit writes) and the cookie-bound server client for
// GM-scoped operations (create / revoke / list) where RLS enforces tenancy.

import crypto from "crypto"
import {z} from "zod"
import {fetchAllRows} from "@/lib/supabase/all-rows"
import {createClient} from "@/lib/supabase/server"
import { sendInviteEmail } from "@/lib/auth/invite-email"
import {USER_ROLES} from "@/lib/users/user-utils"

import { requirePermission, getCurrentUser } from "@/lib/auth/authorization"
import { rateLimit, getClientIp } from "@/lib/auth/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { hashInviteToken, verifyInviteToken } from "@/lib/auth/invite-tokens"
import { isValidNewPassword, newPasswordHint } from "@/lib/auth/password-policy"

/** One week in milliseconds — invite expiry window (auth plan 6.3 step 9). */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// TODO: replace `string` with the proper `user_role` enum type from the
// schema-generated types once @/lib/types is available. The DB enforces the
// enum at the column level; this loose `string` is for simplicity only.

type InviteRow = {
  id: string
  email: string
  role: string
  tenant_id: string
}

type IdRow = { id: string }

export type PendingInvite = {
  id: string
  email: string
  role: string
  invited_at: string
  expires_at: string
}

type ActionResult = { success: boolean; error?: string; errorAr?: string; delivery?:"queued"|"unavailable"; passwordPreserved?:true;notice?:string;noticeAr?:string }



function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Issue a new invite. GM-only (`users.manage`).
 *
 * Generates a UUID token, stores only its bcrypt hash, inserts the invite
 * row scoped to the current user's tenant, sends the acceptance email via
 * Resend, and writes an audit_log row.
 */
export async function createInvite(email:string,role:string):Promise<ActionResult>{
 try{
  await requirePermission("users","manage")
  const me=await getCurrentUser()
  if(!me||me.role!=="general_manager")return{success:false,error:"Only the general manager can invite team members.",errorAr:"يمكن للمدير العام فقط دعوة أعضاء الفريق."}
  const values=z.object({email:z.email().max(254).transform(v=>v.toLowerCase()),role:z.enum(USER_ROLES.filter(r=>r!=="general_manager"))}).safeParse({email:email.trim(),role})
  if(!values.success)return{success:false,error:"Enter a valid email and choose a supported non-owner role.",errorAr:"أدخل بريداً إلكترونياً صالحاً واختر دوراً مدعوماً غير دور المدير العام."}
  const token=crypto.randomUUID(),tokenId=crypto.randomUUID(),tokenHash=await hashInviteToken(token)
  const client=await createClient()
  const{data,error}=await client.rpc("issue_managed_invite",{p_email:values.data.email,p_role:values.data.role,p_token_id:tokenId,p_token_hash:tokenHash,p_expires_at:new Date(Date.now()+INVITE_TTL_MS).toISOString()})
  if(error||!data?.id)return{success:false,error:error?.message?.startsWith("USR")?error.message:"The invitation could not be created. Try again.",errorAr:"تعذر إنشاء الدعوة. تحقق من الدور ومن عدم وجود دعوة سارية لهذا البريد، ثم أعد المحاولة."}
  let delivered=false
  try{delivered=await sendInviteEmail(values.data.email,token,tokenId)}catch{console.error("[invites] email delivery failed")}
  return{success:true,delivery:delivered?"queued":"unavailable"}
 }catch{return{success:false,error:"The invitation could not be created. Check your permissions and try again.",errorAr:"تعذر إنشاء الدعوة. تحقق من صلاحياتك وحاول مجدداً."}}
}

/**
 * Accept an invite and provision the new user. Public flow (no session) —
 * the token is the sole proof of authorization.
 *
 * Looks up the invite by `token_id` (O(1) — migration 057; the `tid` is
 * non-secret, the `token` is the secret), verifies with bcrypt.compare
 * (legacy SHA-256 invites still verify via format detection), creates the
 * auth.users entry (email confirmed by invite construction), creates the
 * custom `users` row, the `tenant_memberships` row, and the
 * `user_role_assignments` row, then marks the invite accepted.
 *
 * CAVEAT: the admin client does not provide a transaction across
 * `auth.admin.createUser` and the custom-table inserts (auth plan 6.5). If
 * an external Auth response is lost, the durable invite-bound identity allows
 * exact-ID recovery. Database profile, membership, role assignment, consumption
 * and audit are atomic. No uncertain or concurrent operation deletes a login.
 */
export async function acceptInvite(
  token: string,
  tid: string,
  fullName: string,
  password: string
): Promise<ActionResult> {
  try {
    // 0. Per-IP rate limit to slow invite-brute-force attempts (auth plan
    //    6.5 step 1).
    const ip = await getClientIp()
    const rate = await rateLimit(`accept_invite:${ip}`, 10, "minute")
    if (!rate.success) {
      return {
        success: false,
        error: "Too many attempts. Please try again later.",
      }
    }

    if (!isValidNewPassword(password)) {
      return { success: false, error: newPasswordHint("en"), errorAr: newPasswordHint("ar") }
    }
    const parsedIdentity=z.object({tid:z.uuid(),token:z.string().min(16).max(512),fullName:z.string().trim().min(1).max(150)}).safeParse({tid,token,fullName})
    if(!parsedIdentity.success)return{success:false,error:"Invalid or expired invite token."}
    fullName=parsedIdentity.data.fullName
    const admin = createAdminClient()

    // 1. Lookup by token_id (O(1) index). Generic error on miss to avoid
    //    enumeration (auth plan 6.5 step 2).
    const { data: invite, error: lookupError } = await admin
      .from("invites")
      .select("id, email, role, tenant_id, token_hash")
      .eq("token_id", tid)
      .eq("status", "pending")
      .gt("expires_at", nowIso())
      .is("deleted_at", null)
      .maybeSingle<InviteRow & { token_hash: string }>()

    if (lookupError) throw lookupError
    if (!invite) {
      return { success: false, error: "Invalid or expired invite token." }
    }

    // 2. Verify the secret token against the stored hash (bcrypt for new
    //    invites, legacy SHA-256 fallback for pre-057 rows). Same generic
    //    error on mismatch (anti-enumeration).
    const match = await verifyInviteToken(token, invite.token_hash)
    if (!match) {
      return { success: false, error: "Invalid or expired invite token." }
    }

    // Reject legacy owner invitations and archived/unconfigured presets before
    // external Auth creation. The atomic RPC repeats this check under locks.
    if(!USER_ROLES.includes(invite.role as typeof USER_ROLES[number])||invite.role==="general_manager")return{success:false,error:"Invalid or expired invite token."}
    const roleCheck=await admin.from("roles").select("id").eq("tenant_id",invite.tenant_id).eq("name",invite.role).is("deleted_at",null).maybeSingle<IdRow>()
    const tenantCheck=await admin.from("tenants").select("id").eq("id",invite.tenant_id).eq("status","active").is("deleted_at",null).maybeSingle<IdRow>()
    if(roleCheck.error||!roleCheck.data||tenantCheck.error||!tenantCheck.data)return{success:false,error:"Invalid or expired invite token."}
    const uncertain=():ActionResult=>({success:false,error:"Account setup could not be confirmed. Retry this invitation using the password from your first attempt, or contact your administrator. No password has been reset.",errorAr:"تعذر تأكيد إعداد الحساب. أعد محاولة قبول الدعوة باستخدام كلمة المرور من المحاولة الأولى، أو تواصل مع مسؤول النظام. لم تتم إعادة تعيين كلمة المرور."})
    // Persist one random identity before the external Auth call. Concurrent and
    // later token-verified attempts receive the same identity under a row lock.
    const candidate=crypto.randomUUID()
    const reserve=async()=>{try{const result=await admin.rpc("reserve_managed_invite_identity",{p_invite_id:invite.id,p_candidate_auth_user_id:candidate});return !result.error&&z.uuid().safeParse(result.data?.auth_user_id).success?result.data.auth_user_id as string:null}catch{return null}}
    const authUserId=await reserve()??await reserve()
    if(!authUserId)return uncertain()
    type BoundIdentity={id:string;email?:string;email_confirmed_at?:string;app_metadata?:Record<string,unknown>}
    const matches=(user:BoundIdentity)=>user.id===authUserId&&user.email?.trim().toLowerCase()===invite.email.trim().toLowerCase()&&!!user.email_confirmed_at&&user.app_metadata?._invite_provisioned===true&&user.app_metadata?._invite_id===invite.id&&user.app_metadata?._invite_tenant_id===invite.tenant_id
    const exactIdentity=async():Promise<{user:BoundIdentity|null;missing:boolean}>=>{
      try{const result=await admin.auth.admin.getUserById(authUserId);return{user:result.data?.user??null,missing:!result.data?.user&&(result.error?.code==="user_not_found"||result.error?.status===404)}}catch{return{user:null,missing:false}}
    }
    let passwordPreserved=false
    const existing=await exactIdentity()
    if(existing.user){
      if(!matches(existing.user))return uncertain()
      passwordPreserved=true
    }else{
      if(!existing.missing)return uncertain()
      let created:BoundIdentity|null=null
      try{const result=await admin.auth.admin.createUser({
        id:authUserId,email:invite.email,password,email_confirm:true,
        app_metadata:{_invite_provisioned:true,_invite_id:invite.id,_invite_tenant_id:invite.tenant_id},
        user_metadata:{full_name:fullName},
      });if(!result.error)created=result.data?.user??null}catch{/* Reconcile a lost creation response by exact bound ID. */}
      if(created){if(!matches(created))return uncertain()}
      else{
        const recovered=await exactIdentity()
        if(!recovered.user||!matches(recovered.user))return uncertain()
        // A duplicate race or lost response may have used an earlier password.
        // Never reset that password or adopt an unrelated existing email.
        passwordPreserved=true
      }
    }
    const completed=():ActionResult=>passwordPreserved?{success:true,passwordPreserved:true,notice:"Your account is ready. Use the password from your first invitation attempt. If you do not remember it, use Forgot password on the sign-in page. Your password was not changed by this retry.",noticeAr:"حسابك جاهز. استخدم كلمة المرور من أول محاولة لقبول الدعوة. إذا لم تتذكرها، استخدم «نسيت كلمة المرور» في صفحة تسجيل الدخول. لم تغيّر هذه المحاولة كلمة المرور."}:{success:true}

    // A response may be lost after commit. Both attempts finalize the same
    // bound identity; no failure deletes an identity another request may use.
    const args={p_invite_id:invite.id,p_auth_user_id:authUserId,p_full_name:fullName}
    type ProvisionResult={data:{id?:string}|null;error:unknown}
    const provision=async():Promise<ProvisionResult>=>{try{return await admin.rpc("accept_managed_invite",args)}catch{return{data:null,error:null}}}
    const first=await provision()
    if(first.data?.id&&!first.error)return completed()
    const retry=await provision()
    if(!retry.error&&retry.data?.id)return completed()
    console.error("[invites] provisioning outcome needs reconciliation")
    return uncertain()

  } catch {
    return { success: false, error: "The invitation could not be completed. Reload and try again.", errorAr: "تعذر إكمال الدعوة. أعد تحميل الصفحة وحاول مجدداً." }
  }
}

/**
 * Revoke a pending invite. GM-only (`users.manage`). Sets `status='revoked'`
 * so the accept-invite flow rejects it with the same generic error.
 */
export async function revokeInvite(inviteId: string): Promise<ActionResult> {
  try {
    await requirePermission("users", "manage")
    const me=await getCurrentUser()
    if(!me||me.role!=="general_manager"||!z.uuid().safeParse(inviteId).success) return {success:false,error:"Only the general manager can revoke a valid pending invitation.",errorAr:"يمكن للمدير العام فقط إلغاء دعوة صالحة قيد الانتظار."}
    const caller=await createClient()
    const {data,error}=await caller.rpc("revoke_managed_invite",{p_id:inviteId})
    if(error||!data?.id)return{success:false,error:"The invitation could not be revoked. Reload to check whether it was already accepted or revoked.",errorAr:"تعذر إلغاء الدعوة. أعد التحميل للتحقق مما إذا كانت قد قُبلت أو أُلغيت بالفعل."}
    return{success:true}
  }catch{return{success:false,error:"The invitation could not be revoked. Reload and try again.",errorAr:"تعذر إلغاء الدعوة. أعد التحميل وحاول مجدداً."}}
}

/**
 * List pending invites for the current user's tenant. Requires `users.read`.
 */
export async function listPendingInvites(): Promise<PendingInvite[]> {
  try {
    await requirePermission("users", "read")

    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return []
    }

    // Use admin client for consistency with other invite operations.
    const admin = createAdminClient()
    const { data, error } = await fetchAllRows<{id:string;email:string;role:string;created_at:string;expires_at:string}>(()=>admin
      .from("invites")
      .select("id, email, role, created_at, expires_at")
      .eq("status", "pending")
      .eq("tenant_id", currentUser.tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }).order("id"))

    if (error) throw error

    const rows = (data ?? []) as unknown as Array<{
      id: string
      email: string
      role: string
      created_at: string
      expires_at: string
    }>

    // Map the table's `created_at` to the API contract's `invited_at`.
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      invited_at: row.created_at,
      expires_at: row.expires_at,
    }))
  } catch {throw new Error("Could not load invitations. Try again.")}
}
