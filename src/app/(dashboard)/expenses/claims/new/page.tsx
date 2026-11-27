"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ClaimEditor } from "@/components/expense-claims/claim-editor"
import { Notice, useBi } from "@/components/expense-claims/shared"
import { getClaimSettings, getExpenseAccess, type ExpenseAccess } from "@/lib/expense-claims/actions"
import type { ClaimSettings } from "@/lib/expense-claims/constants"

export default function NewExpenseClaimPage() {
  const { t } = useBi()
  const [access, setAccess] = useState<ExpenseAccess | null | undefined>(undefined)
  const [settings, setSettings] = useState<ClaimSettings | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const permissions = await getExpenseAccess()
        if (cancelled) return
        setAccess(permissions)
        if (!permissions?.create) { setLoadError(false); return }
        const policy = await getClaimSettings()
        if (!cancelled) { setSettings(policy); setLoadError(false) }
      } catch { if (!cancelled) setLoadError(true) }
    })()
    return () => { cancelled = true }
  }, [reload])

  if (loadError) return <div role="alert" className="space-y-3 p-6"><p>{t("Could not verify expense settings. Try again before submitting.", "تعذر التحقق من إعدادات المصروفات. أعد المحاولة قبل التقديم.")}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>{t("Try again", "أعد المحاولة")}</Button></div>
  if (access !== undefined && !access?.create) return <div className="p-6"><Notice tone="warn">{t("You do not have permission to submit expense claims.", "ليس لديك صلاحية تقديم مطالبات المصروفات.")}</Notice></div>

  if (access === undefined || !settings) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("Loading…", "جارٍ التحميل…")}</div>

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm"><Link href="/expenses/claims"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Claims", "المطالبات")}</Link></Button>
        <h1 className="text-lg font-semibold">{t("New expense", "مصروف جديد")}</h1>
      </div>
      <ClaimEditor settings={settings} tenantId={access.tenantId} />
    </div>
  )
}
