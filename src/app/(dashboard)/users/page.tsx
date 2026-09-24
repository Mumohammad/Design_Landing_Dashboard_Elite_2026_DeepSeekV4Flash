"use client"

// Users module list surface (Module 14) — real data via fetchUsersPageData()
// (admin client behind requirePermission), following the drivers-module
// surface pattern (#44–#49): EnterpriseModulePage shell, KPI chips, filters,
// CSV export, row actions, bilingual AR/EN.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  EnterpriseModulePage,
  type KpiCardData,
  type TableColumn,
} from "@/components/dashboard/enterprise-module-page"
import { fetchUsersPageData, type UserListItem } from "@/lib/users/queries"
import {
  ROLE_META,
  STATUS_META,
  userInitial,
  usersToCsv,
  ALLOWED_STATUS_TRANSITIONS,
  type UserStatus,
} from "@/lib/users/user-utils"
import { InviteUserDialog } from "./components/user-form-dialog"
import { UserStatusDialog } from "./components/user-status-dialog"
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  KeyRound,
  MoreHorizontal,
  ShieldCheck,
  UserX,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/use-translation"

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

export default function UsersPage() {
  const { t, locale } = useTranslation()
  const router = useRouter()
  const isAr = locale === "ar"

  const [users, setUsers] = useState<UserListItem[]>([])
  const [kpis, setKpis] = useState({
    total: 0,
    active: 0,
    pendingInvite: 0,
    lockedOrTerminated: 0,
    twoFactorEnabled: 0,
    saudiSharePct: null as number | null,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | UserStatus>("all")
  const [roleFilter, setRoleFilter] = useState<string>("all")
  const [inviteOpen, setInviteOpen] = useState(false)
  const [statusTarget, setStatusTarget] = useState<{ user: UserListItem; status: UserStatus } | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true)
    try {
      const result = await fetchUsersPageData()
      setUsers(result.users)
      setKpis(result.kpis)
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
      if (!silent) {
        setUsers([])
        setKpis({
          total: 0,
          active: 0,
          pendingInvite: 0,
          lockedOrTerminated: 0,
          twoFactorEnabled: 0,
          saudiSharePct: null,
        })
      }
    }
    if (!silent) setIsLoading(false)
  }, [])

  useEffect(() => {
    const id = setTimeout(() => void load(), 0)
    return () => clearTimeout(id)
  }, [load])

  const roles = useMemo(() => Array.from(new Set(users.map((u) => u.role))), [users])

  const filtered = useMemo(() => {
    let rows = users
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (u) =>
          (u.full_name_ar ?? "").toLowerCase().includes(q) ||
          (u.full_name_en ?? "").toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.employee_code ?? "").toLowerCase().includes(q)
      )
    }
    if (statusFilter !== "all") rows = rows.filter((u) => u.status === statusFilter)
    if (roleFilter !== "all") rows = rows.filter((u) => u.role === roleFilter)
    return rows
  }, [users, search, statusFilter, roleFilter])

  const kpiCards: KpiCardData[] = [
    { label: t.nav.users, value: kpis.total, icon: Users, color: "#1E5A99" },
    { label: t.common.active, value: kpis.active, icon: CheckCircle2, color: "#10B981" },
    {
      label: t.common.pending,
      value: kpis.pendingInvite,
      icon: Clock,
      color: "#F59E0B",
    },
    {
      label: isAr ? "مقفل/منهى" : "Locked / terminated",
      value: kpis.lockedOrTerminated,
      icon: UserX,
      color: kpis.lockedOrTerminated > 0 ? "#EF4444" : "#64748B",
    },
    {
      label: isAr ? "التحقق الثنائي مفعّل" : "2FA enabled",
      value: kpis.twoFactorEnabled,
      icon: ShieldCheck,
      color: "#1E5A99",
    },
    {
      label: isAr ? "ملفات عربية" : "Arabic profiles",
      value: kpis.saudiSharePct === null ? "—" : `${kpis.saudiSharePct}%`,
      icon: AlertTriangle,
      color: "#E87D3E",
    },
  ]

  const exportCsv = () => {
    const csv = usersToCsv(
      ["Code", "Name (AR)", "Name (EN)", "Email", "Role", "Status", "2FA", "Last login"],
      filtered.map((u) => [
        u.employee_code,
        u.full_name_ar,
        u.full_name_en,
        u.email,
        u.role,
        u.status,
        u.two_factor_enabled ? "yes" : "no",
        u.last_login_at,
      ])
    )
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const columns: TableColumn<UserListItem>[] = [
    {
      key: "full_name_ar",
      header: isAr ? "المستخدم" : "User",
      render: (u) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-elite-blue-500 to-elite-orange-500 text-xs font-semibold text-white">
            {userInitial(u.full_name_ar ?? u.full_name_en)}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">
              {u.full_name_ar ?? u.full_name_en ?? u.email}
            </div>
            {u.employee_code && (
              <div dir="ltr" className="truncate font-mono text-xs text-muted-foreground">
                {u.employee_code}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "email",
      header: "Email",
      render: (u) => (
        <span dir="ltr" className="text-xs text-muted-foreground">
          {u.email}
        </span>
      ),
    },
    {
      key: "role",
      header: isAr ? "الدور" : "Role",
      render: (u) => (
        <span className="text-sm">{isAr ? ROLE_META[u.role]?.ar ?? u.role : ROLE_META[u.role]?.en ?? u.role}</span>
      ),
    },
    {
      key: "status",
      header: t.common.status,
      render: (u) => {
        const s = STATUS_META[u.status] ?? STATUS_META.inactive
        return (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
              s.className
            )}
          >
            {isAr ? s.ar : s.en}
          </span>
        )
      },
    },
    {
      key: "two_factor_enabled",
      header: isAr ? "التحقق الثنائي" : "2FA",
      render: (u) =>
        u.two_factor_enabled ? (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">✓</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "last_login_at",
      header: isAr ? "آخر دخول" : "Last login",
      render: (u) => (
        <span dir="ltr" className="text-xs tabular-nums text-muted-foreground">
          {fmtDateTime(u.last_login_at)}
        </span>
      ),
    },
  ]

  const noResults = !isLoading && users.length > 0 && filtered.length === 0

  return (
    <div
      className="px-4 py-4 lg:px-6"
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement
        if (target.closest("[data-row-actions]")) return
        const tr = target.closest("tr")
        if (!tr || tr.parentElement?.tagName !== "TBODY") return
        const idx = Array.from(tr.parentElement.children).indexOf(tr)
        const row = filtered[idx]
        if (row) router.push(`/users/${row.id}`)
      }}
    >
      {loadFailed && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {isAr ? "تعذر تحميل قائمة المستخدمين — حاول التحديث." : "Could not load the user roster — try refreshing."}
        </div>
      )}

      {/* Filter + export toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border/50 bg-card/60 px-4 py-3 backdrop-blur-sm">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | UserStatus)}>
          <SelectTrigger className="h-9 w-36 rounded-xl bg-muted/30 text-xs">
            <SelectValue placeholder={t.common.status} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isAr ? "كل الحالات" : "All statuses"}</SelectItem>
            {(Object.keys(STATUS_META) as UserStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {isAr ? STATUS_META[s].ar : STATUS_META[s].en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-9 w-44 rounded-xl bg-muted/30 text-xs">
            <SelectValue placeholder={isAr ? "الدور" : "Role"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isAr ? "كل الأدوار" : "All roles"}</SelectItem>
            {roles.map((r) => (
              <SelectItem key={r} value={r}>
                {isAr ? ROLE_META[r]?.ar ?? r : ROLE_META[r]?.en ?? r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ms-auto flex items-center gap-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {isAr ? `${filtered.length} من ${users.length}` : `${filtered.length} of ${users.length}`}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-xl"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            {isAr ? "تصدير CSV" : "Export CSV"}
          </Button>
        </div>
      </div>

      <EnterpriseModulePage<UserListItem>
        title={t.nav.users}
        subtitle={
          isAr
            ? "إدارة حسابات الفريق والأدوار وحالات الحساب"
            : "Manage team accounts, roles, and account status"
        }
        primaryCtaLabel={isAr ? "دعوة مستخدم" : "Invite user"}
        onPrimaryCta={() => setInviteOpen(true)}
        kpiCards={kpiCards}
        searchPlaceholder={t.common.searchPlaceholder}
        searchValue={search}
        onSearchChange={setSearch}
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        onRowClick={(u) => router.push(`/users/${u.id}`)}
        rowActions={(u) => {
          const targets = ALLOWED_STATUS_TRANSITIONS[u.status]
          return (
            <div data-row-actions onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg">
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">{t.common.actions}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {isAr ? "حالة الحساب" : "Account status"}
                  </DropdownMenuLabel>
                  {targets.length === 0 ? (
                    <DropdownMenuItem disabled className="text-xs">
                      {isAr ? "حالة نهائية — لا تحويلات" : "Terminal status — no transitions"}
                    </DropdownMenuItem>
                  ) : (
                    targets.map((s) => (
                      <DropdownMenuItem
                        key={s}
                        className={cn("text-xs", (s === "locked" || s === "terminated") && "text-destructive")}
                        onClick={() => setStatusTarget({ user: u, status: s })}
                      >
                        {isAr ? `تغيير إلى: ${STATUS_META[s].ar}` : `Set to: ${STATUS_META[s].en}`}
                      </DropdownMenuItem>
                    ))
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-xs"
                    onClick={() => router.push(`/users/${u.id}`)}
                  >
                    <KeyRound className="mr-2 h-3.5 w-3.5" />
                    {isAr ? "فتح الملف" : "Open profile"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }}
        emptyStateMessage={
          noResults
            ? isAr
              ? "لا توجد نتائج مطابقة للفلاتر"
              : "No users match the current filters"
            : isAr
              ? "لا يوجد مستخدمون بعد — ابدأ بدعوة عضو فريق"
              : "No users yet — start by inviting a team member"
        }
        emptyStateAction={
          noResults
            ? undefined
            : {
                label: isAr ? "دعوة مستخدم" : "Invite user",
                onClick: () => setInviteOpen(true),
              }
        }
      >
        <InviteUserDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          onInvited={() => void load(true)}
        />
        <UserStatusDialog
          userId={statusTarget?.user.id ?? null}
          userName={
            statusTarget
              ? statusTarget.user.full_name_ar ??
                statusTarget.user.full_name_en ??
                statusTarget.user.email
              : ""
          }
          target={statusTarget?.status ?? null}
          open={statusTarget !== null}
          onOpenChange={(o) => {
            if (!o) setStatusTarget(null)
          }}
          onDone={() => void load(true)}
        />
      </EnterpriseModulePage>
    </div>
  )
}
