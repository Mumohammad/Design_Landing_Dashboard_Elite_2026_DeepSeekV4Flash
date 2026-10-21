"use client"

import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useTranslation } from "@/hooks/use-translation"
import type { PaginationData } from "@/components/dashboard/enterprise-module-page"

export function LedgerToolbar({ search, onSearchChange, pagination, loading, error, onRefresh, journal }: {
  search: string
  onSearchChange: (value: string) => void
  pagination: PaginationData
  loading: boolean
  error: boolean
  onRefresh: () => void
  journal: boolean
}) {
  const { locale } = useTranslation()
  const ar = locale === "ar"
  return (
    <div data-testid="ledger-toolbar" className="mt-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Input type="search" maxLength={200} value={search} onChange={event => onSearchChange(event.target.value)}
        aria-label={ar ? "بحث في السجل" : "Search ledger"}
        placeholder={journal ? (ar ? "ابحث بالمرجع أو وصف القيد" : "Search reference or journal description") : (ar ? "ابحث بمرجع الفاتورة" : "Search invoice reference")}
        className="w-full min-w-0 sm:max-w-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {loading ? (ar ? "جارٍ التحميل…" : "Loading…") : error ? "—" : ar
            ? `${pagination.totalRecords} سجل · الصفحة ${pagination.currentPage} من ${pagination.totalPages}`
            : `${pagination.totalRecords} ${pagination.totalRecords === 1 ? "record" : "records"} · Page ${pagination.currentPage} of ${pagination.totalPages}`}
        </p>
        <Button variant="outline" size="icon" disabled={loading || error || pagination.currentPage <= 1}
          aria-label={ar ? "الصفحة السابقة" : "Previous page"} onClick={() => pagination.onPageChange(pagination.currentPage - 1)}>
          <ChevronLeft aria-hidden="true" className={`h-4 w-4 ${ar ? "rotate-180" : ""}`} />
        </Button>
        <Button variant="outline" size="icon" disabled={loading || error || pagination.currentPage >= pagination.totalPages}
          aria-label={ar ? "الصفحة التالية" : "Next page"} onClick={() => pagination.onPageChange(pagination.currentPage + 1)}>
          <ChevronRight aria-hidden="true" className={`h-4 w-4 ${ar ? "rotate-180" : ""}`} />
        </Button>
        <Button variant="outline" size="icon" disabled={loading} aria-label={ar ? "تحديث السجل" : "Refresh ledger"} onClick={onRefresh}>
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
