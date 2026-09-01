"use client"

import { useEffect } from "react"
import { TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function ModuleError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[module-error]", error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-destructive/30 bg-card p-8 text-center shadow-lg">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <TriangleAlert className="h-7 w-7" aria-hidden />
        </span>
        <h2 className="text-lg font-bold text-foreground">تعذّر تحميل هذه الوحدة</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          حدث خطأ غير متوقع أثناء عرض البيانات. بياناتك محفوظة — جرّب إعادة التحميل.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground/70">ref: {error.digest}</p>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button onClick={reset} className="rounded-xl">إعادة المحاولة</Button>
          <Button variant="outline" className="rounded-xl" onClick={() => (window.location.href = "/dashboard")}>
            العودة للوحة
          </Button>
        </div>
      </div>
    </div>
  )
}
