"use client"
import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { readMasterPage, type MasterKind, type MasterPage } from "@/lib/accounting/master-contract"

export function useAccountingMasterPage<T>(kind: MasterKind) {
  const [search, setSearchValue] = useState("")
  const [page, setPageValue] = useState(1)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<MasterPage<T> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const pending = useCallback(() => { setLoading(true); setError(false); setResult(null) }, [])
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
        const value = await readMasterPage<T>(createClient(), kind, { search, page, pageSize: 25, signal: controller.signal })
        if (!active || controller.signal.aborted) return
        const lastPage = Math.max(1, Math.ceil(value.total / 25))
        if (page > lastPage) { setPage(lastPage); return }
        setResult(value); setLoading(false)
      } catch {
        if (active) { setResult(null); setLoading(false); setError(true) }
      } finally { clearTimeout(deadline) }
    }, search ? 250 : 0)
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [kind, search, page, revision, pending, setPage])
  return { rows: result?.rows ?? [], summary: result?.summary ?? null, loading, error, search, setSearch, reload,
    pagination: { totalRecords: result?.total ?? 0, currentPage: page, totalPages: Math.max(1, Math.ceil((result?.total ?? 0) / 25)), onPageChange: setPage } }
}
