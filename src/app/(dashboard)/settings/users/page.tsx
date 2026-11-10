"use client"

import { LocalizedText } from "@/components/localized-text"
import { useEffect, useState } from "react"
import { useActionState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { createInvite, revokeInvite, listPendingInvites, type PendingInvite } from "@/lib/auth/invites"
import { fetchUsersForSettings, type SafeUserRow } from "@/lib/auth/user-reads"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Users, Mail, Send, Ban, UserPlus, AlertTriangle } from "lucide-react"
import { LoadingSpinner } from "@/components/ui/loading-spinner"

const ROLE_AR: Record<string, string> = {
  general_manager: "مدير عام",
  admin: "مدير نظام",
  accountant: "محاسب",
  supervisor: "مشرف",
  hr_officer: "موارد بشرية",
  operations_officer: "عمليات",
  payroll_officer: "رواتب",
  platform_coordinator: "منسق منصات",
  readonly_auditor: "مدقق",
}

const ROLE_EN: Record<string, string> = {
  general_manager: "General Manager",
  admin: "Admin",
  accountant: "Accountant",
  supervisor: "Supervisor",
  hr_officer: "HR Officer",
  operations_officer: "Operations",
  payroll_officer: "Payroll",
  platform_coordinator: "Platform Coordinator",
  readonly_auditor: "Read-only Auditor",
}

const STATUS_META: Record<string, { ar: string; en: string; className: string }> = {
  active: { ar: "نشط", en: "Active", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  inactive: { ar: "غير نشط", en: "Inactive", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  locked: { ar: "مقفل", en: "Locked", className: "bg-red-500/15 text-red-600 border-red-500/20" },
  pending_invite: { ar: "دعوة معلقة", en: "Pending invite", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  terminated: { ar: "منهى", en: "Terminated", className: "bg-red-500/15 text-red-600 border-red-500/20" },
}

function fmtDate(date: string | null, locale: string): string {
  if (!date) return "—"
  try {
    return new Date(date).toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { day: "2-digit", month: "short", year: "numeric" })
  } catch {
    return date
  }
}

// Shared data fetch — used by the initial effect AND the invite/revoke
// handlers so both stay on one code path.
// Uses server actions instead of direct browser Supabase reads
// (migration 058: authenticated users should not read users table directly).
async function fetchUsersAndInvites(
  setUsers: (u: SafeUserRow[]) => void,
  setInvites: (i: PendingInvite[]) => void,
  setIsLoading: (b: boolean) => void,
  setLoadError: (b:boolean)=>void
): Promise<void> {
  setLoadError(false)
  try {
    const users = await fetchUsersForSettings()
    setUsers(users)
  } catch {
    setLoadError(true)
    setUsers([])
  }
  try {
    const pending = await listPendingInvites()
    setInvites(pending)
  } catch {
    setLoadError(true)
    setInvites([])
  }
  setIsLoading(false)
}

export default function UsersSettingsPage() {
  const { t, locale } = useTranslation()
  const ar = locale === "ar"

  const [loadError,setLoadError]=useState(false)
  const [search,setSearch]=useState("")
  const [page,setPage]=useState(1)
  const [users, setUsers] = useState<SafeUserRow[]>([])
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tab, setTab] = useState("users")
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [revokeError,setRevokeError]=useState<string|null>(null)

  useEffect(() => {
    void fetchUsersAndInvites(setUsers, setInvites, setIsLoading,setLoadError)
  }, [])

  const [inviteState, inviteAction, isInviting] = useActionState(
    async (_prev: { success: boolean; error?: string;errorAr?:string;delivery?:"queued"|"unavailable" } | null, form: FormData) => {
      const email = String(form.get("email") ?? "").trim()
      const role = String(form.get("role") ?? "readonly_auditor")
      const result = await createInvite(email, role)
      if (result.success) {
        setTab("invites")
        await fetchUsersAndInvites(setUsers, setInvites, setIsLoading,setLoadError)
      }
      return result
    },
    null
  )

  async function handleRevoke(inviteId: string) {
    setRevokingId(inviteId)
    setRevokeError(null)
    try {
      const result = await revokeInvite(inviteId)
      if (result.success) await fetchUsersAndInvites(setUsers, setInvites, setIsLoading,setLoadError)
      else setRevokeError(ar ? result.errorAr ?? "تعذر إلغاء الدعوة. أعد التحميل وحاول مجدداً." : result.error ?? "Could not revoke invitation. Reload and try again.")
    } catch { setRevokeError(ar ? "تعذر تأكيد إلغاء الدعوة. أعد التحميل للتحقق من حالتها." : "Revocation could not be confirmed. Reload to check its status.") }
    finally { setRevokingId(null) }
  }

  if (isLoading) {
    return (
      <div className="px-4 lg:px-6 py-4">
        <div className="flex items-center justify-center py-24">
          <LoadingSpinner className="h-6 w-6 text-elite-blue-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="page-enter px-4 lg:px-6 py-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t.nav.users}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {ar ? "إدارة المستخدمين وإرسال الدعوات (المدير العام فقط)" : "Manage users and send invites (GM only)"}
        </p>
      </div>

      {revokeError&&<p role="alert" className="rounded-xl border border-destructive/30 p-3 text-sm text-destructive">{revokeError}</p>}
      {loadError&&<div role="alert" className="rounded-xl border p-4"><p>{ar?"تعذر تحميل المستخدمين أو الدعوات. أعد المحاولة.":"Could not load users or invitations. Try again."}</p><Button variant="outline" onClick={()=>void fetchUsersAndInvites(setUsers,setInvites,setIsLoading,setLoadError)}>{t.common.retry}</Button></div>}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" />
            {ar ? "المستخدمون" : "Users"}
          </TabsTrigger>
          <TabsTrigger value="invites" className="gap-2">
            <Mail className="h-4 w-4" />
            {ar ? "الدعوات" : "Invites"}
            {invites.length > 0 && (
              <Badge className="ms-1 bg-elite-blue-600/15 text-elite-blue-700 border-elite-blue-500/20">{invites.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <Card className="rounded-2xl border border-border/50 bg-card shadow-sm overflow-hidden">
            <div className="p-4"><Input aria-label={ar?"بحث المستخدمين":"Search users"} value={search} onChange={e=>{setPage(1);setSearch(e.target.value)}} placeholder={t.common.searchPlaceholder}/></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-start text-xs text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{ar ? "الاسم" : "Name"}</th>
                    <th className="px-4 py-3 text-start font-medium"><LocalizedText text="Email" /></th>
                    <th className="px-4 py-3 text-start font-medium">{ar ? "الدور" : "Role"}</th>
                    <th className="px-4 py-3 text-start font-medium">{ar ? "الحالة" : "Status"}</th>
                    <th className="px-4 py-3 text-start font-medium">{ar ? "آخر دخول" : "Last login"}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                        {ar ? "لا يوجد مستخدمون." : "No users."}
                      </td>
                    </tr>
                  )}
                  {users.filter(u=>[u.email,u.full_name_ar??"",u.full_name_en??"",u.employee_code??""].some(v=>v.toLowerCase().includes(search.toLowerCase()))).slice((page-1)*25,page*25).map((u) => {
                    const s = STATUS_META[u.status] ?? STATUS_META.inactive
                    return (
                      <tr key={u.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3 font-medium">
                          {u.full_name_ar ?? u.full_name_en ?? u.email}
                          {u.employee_code && (
                            <span dir="ltr" className="ms-2 font-mono text-xs text-muted-foreground">
                              {u.employee_code}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3" dir="ltr">
                          <span className="text-xs text-muted-foreground">{u.email}</span>
                        </td>
                        <td className="px-4 py-3 text-xs">{ar ? ROLE_AR[u.role] : ROLE_EN[u.role] ?? u.role}</td>
                        <td className="px-4 py-3">
                          <Badge className={s.className}>{ar ? s.ar : s.en}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground" dir="ltr">
                          {fmtDate(u.last_login_at,locale)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-3 p-4"><Button variant="outline" size="sm" disabled={page===1} onClick={()=>setPage(p=>p-1)}>{ar?"السابق":"Previous"}</Button><span className="text-sm tabular-nums">{page}</span><Button variant="outline" size="sm" disabled={page*25>=users.filter(u=>[u.email,u.full_name_ar??"",u.full_name_en??"",u.employee_code??""].some(v=>v.toLowerCase().includes(search.toLowerCase()))).length} onClick={()=>setPage(p=>p+1)}>{ar?"التالي":"Next"}</Button></div>
          </Card>
        </TabsContent>

        <TabsContent value="invites" className="mt-4 space-y-4">
          <Card className="rounded-2xl border border-border/50 bg-card shadow-sm">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl text-elite-blue-600 dark:text-elite-blue-300">
                  <UserPlus className="h-5 w-5 text-elite-blue-600" />
                </div>
                <div>
                  <CardTitle className="text-base">{ar ? "دعوة مستخدم جديد" : "Invite a new user"}</CardTitle>
                  <CardDescription className="text-xs">
                    {ar ? "يصل للمدعو رابط قبول صالح لمدة 7 أيام" : "The invitee receives an acceptance link valid for 7 days"}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <form action={inviteAction} className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="inviteEmail"><LocalizedText text="Email" /></Label>
                  <Input
                    id="inviteEmail"
                    name="email"
                    type="email"
                    required
                    dir="ltr"
                    placeholder="name@company.com"
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inviteRole">{ar ? "الدور" : "Role"}</Label>
                  <select
                    id="inviteRole"
                    name="role"
                    className="h-9 rounded-xl border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {Object.keys(ROLE_AR).filter(r=>r!=="general_manager").map((r) => (
                      <option key={r} value={r}>
                        {ar ? ROLE_AR[r] : ROLE_EN[r] ?? r}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="submit"
                  disabled={isInviting}
                  className="bg-elite-blue-600 hover:bg-elite-blue-700"
                >
                  {isInviting ? <LoadingSpinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                  {ar ? "إرسال الدعوة" : "Send invite"}
                </Button>
              </form>
              {inviteState?.error && (
                <p className="mt-3 flex items-center gap-1.5 text-sm text-red-500">
                  <AlertTriangle className="h-4 w-4" /> {ar ? inviteState.errorAr ?? "تعذر إنشاء الدعوة. تحقق من البيانات والصلاحيات وحاول مجدداً." : inviteState.error}
                </p>
              )}
              {inviteState?.success && (
                <p className="mt-3 text-sm text-emerald-600">{inviteState.delivery==="queued"?(ar ? "أُنشئت الدعوة وقُبل البريد للإرسال." : "Invitation created; email queued for sending."):(ar?"أُنشئت الدعوة، لكن تعذر تأكيد إرسال البريد. تحقق من الإعدادات ووصول الدعوة قبل إلغائها وإعادة إرسالها.":"Invitation created, but sending could not be confirmed. Check email configuration and receipt before revoking and resending.")}</p>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-border/50 bg-card shadow-sm overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{ar ? "الدعوات المعلقة" : "Pending invites"}</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-start text-xs text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium"><LocalizedText text="Email" /></th>
                    <th className="px-4 py-3 text-start font-medium">{ar ? "الدور" : "Role"}</th>
                    <th className="px-4 py-3 text-start font-medium">{ar ? "تاريخ الإرسال" : "Sent"}</th>
                    <th className="px-4 py-3 text-start font-medium">{ar ? "ينتهي في" : "Expires"}</th>
                    <th className="px-4 py-3 text-start font-medium">{ar ? "إجراء" : "Action"}</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                        {ar ? "لا توجد دعوات معلقة." : "No pending invites."}
                      </td>
                    </tr>
                  )}
                  {invites.map((inv) => (
                    <tr key={inv.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3" dir="ltr">
                        <span className="text-xs">{inv.email}</span>
                      </td>
                      <td className="px-4 py-3 text-xs">{ar ? ROLE_AR[inv.role] : ROLE_EN[inv.role] ?? inv.role}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground" dir="ltr">
                        {fmtDate(inv.invited_at,locale)}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground" dir="ltr">
                        {fmtDate(inv.expires_at,locale)}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={revokingId === inv.id}
                          onClick={() => handleRevoke(inv.id)}
                          className="h-7 gap-1.5 text-xs text-red-600 hover:text-red-700"
                        >
                          <Ban className="h-3.5 w-3.5" />
                          {ar ? "إلغاء" : "Revoke"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
