"use client"
import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { readChartParentPage, type ChartMasterRow, type MasterPage } from "@/lib/accounting/master-contract"
import type { AccountType } from "@/lib/accounting/csv-utils"

export function useChartParentPage(accountType: AccountType, excludeId?: string) {
  const [search, setSearchValue] = useState("")
  const [page, setPageValue] = useState(1)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<MasterPage<ChartMasterRow> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const pending = useCallback(() => { setResult(null); setLoading(true); setError(false) }, [])
  const setSearch = useCallback((value: string) => { const next = value.slice(0, 200); if (next === search) return; setSearchValue(next); setPageValue(1); pending() }, [search, pending])
  const setPage = useCallback((value: number) => { const next = Math.max(1, Math.trunc(value)); if (next === page) return; setPageValue(next); pending() }, [page, pending])
  const reload = useCallback(() => { setRevision(value => value + 1); pending() }, [pending])
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timer = setTimeout(async () => {
      pending()
      const deadline = setTimeout(() => controller.abort(), 30_000)
      try {
        const value = await readChartParentPage(createClient(), accountType, { excludeId, search, page, pageSize: 25, signal: controller.signal })
        if (!active || controller.signal.aborted) return
        const lastPage = Math.max(1, Math.ceil(value.total / 25))
        if (page > lastPage) { setPage(lastPage); return }
        setResult(value); setLoading(false)
      } catch {
        if (active) { setResult(null); setLoading(false); setError(true) }
      } finally { clearTimeout(deadline) }
    }, search ? 250 : 0)
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [accountType, excludeId, search, page, revision, pending, setPage])
  return { rows: result?.rows ?? [], loading, error, search, setSearch, reload,
    pagination: { totalRecords: result?.total ?? 0, currentPage: page, totalPages: Math.max(1, Math.ceil((result?.total ?? 0) / 25)), onPageChange: setPage } }
}
