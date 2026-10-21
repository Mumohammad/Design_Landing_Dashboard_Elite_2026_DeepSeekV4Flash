"use client"

import { useCallback, useEffect, useState } from "react"

type PageResult = { data: unknown[] | null; count: number | null; error: unknown }
type PageQuery = PromiseLike<PageResult> & {
  range: (from: number, to: number) => PageQuery
  abortSignal: (signal: AbortSignal) => PageQuery
}
export const TABLE_PAGE_SIZE = 25

/** RLS-scoped reads, bounded rendering, debounced search, and stale-request cancellation. */
export function useTablePage<T>(buildQuery: ((search: string) => PageQuery) | null) {
  const [search, setSearchValue] = useState("")
  const [page, setPageValue] = useState(1)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ rows: T[]; count: number; loading: boolean; error: boolean }>({
    rows: [], count: 0, loading: true, error: false,
  })
  const pending = useCallback(() => setResult((old) => ({ ...old, rows: [], loading: true, error: false })), [])
  const setSearch = useCallback((value: string) => {
    const next = value.slice(0, 200)
    if (next === search && page === 1) return
    setSearchValue(next); setPageValue(1); pending()
  }, [search, page, pending])
  const setPage = useCallback((value: number) => {
    const next = Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1
    if (next === page) return
    setPageValue(next); pending()
  }, [page, pending])
  const reload = useCallback(() => { setRevision((value) => value + 1); pending() }, [pending])

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      if (!buildQuery) { setResult({ rows: [], count: 0, loading: false, error: false }); return }
      pending()
      try {
        const { data, error, count } = await buildQuery(search)
          .range((page - 1) * TABLE_PAGE_SIZE, page * TABLE_PAGE_SIZE - 1)
          .abortSignal(controller.signal)
        if (controller.signal.aborted) return
        if (error || !Array.isArray(data) || count === null || !Number.isSafeInteger(count) || count < 0 || data.length > TABLE_PAGE_SIZE) throw new Error("Read failed")
        const lastPage = Math.max(1, Math.ceil(count / TABLE_PAGE_SIZE))
        if (page > lastPage) { setPage(lastPage); return }
        if (data.length !== Math.min(TABLE_PAGE_SIZE, Math.max(0, count - (page - 1) * TABLE_PAGE_SIZE))) throw new Error("Incomplete page")
        setResult({ rows: data as T[], count, loading: false, error: false })
      } catch {
        if (!controller.signal.aborted) setResult({ rows: [], count: 0, loading: false, error: true })
      }
    }, search ? 250 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [buildQuery, search, page, revision, setPage, pending])

  return {
    ...result, search, setSearch, reload,
    pagination: { totalRecords: result.count, currentPage: page, totalPages: Math.max(1, Math.ceil(result.count / TABLE_PAGE_SIZE)), onPageChange: setPage },
  }
}
