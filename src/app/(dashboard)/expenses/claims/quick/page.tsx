"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { QuickUpload } from "@/components/expense-claims/quick-upload"
import { Notice, useBi } from "@/components/expense-claims/shared"
import { getClaimSettings, getExpenseAccess, type ExpenseAccess } from "@/lib/expense-claims/actions"
import type { ClaimSettings } from "@/lib/expense-claims/constants"

export default function QuickExpensePage() {
  const { t } = useBi()
  const [access, setAccess] = useState<ExpenseAccess | null | undefined>(undefined)
  const [settings, setSettings] = useState<ClaimSettings | null>(null)
  useEffect(() => { void getExpenseAccess().then(setAccess); void getClaimSettings().then(setSettings) }, [])

  if (access === undefined || !settings) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("Loading…", "جارٍ التحميل…")}</div>
  if (!access?.create) return <div className="p-6"><Notice tone="warn">{t("You do not have permission to submit expense claims.", "ليس لديك صلاحية تقديم مطالبات المصروفات.")}</Notice></div>
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm"><Link href="/expenses/claims"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Claims", "المطالبات")}</Link></Button>
        <h1 className="text-lg font-semibold">{t("Quick receipt upload", "رفع إيصال سريع")}</h1>
      </div>
      <QuickUpload tenantId={access.tenantId} />
    </div>
  )
}
