"use client"

import { useCallback, useEffect, useState } from "react"

/** Keep a result tied to its driver/query and discard cancelled refreshes. */
export function useDriverPanelRead<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{
    source: typeof load; revision: number; data: T | null; error: boolean
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => load(controller.signal)).then(
      data => { if (!controller.signal.aborted) setResult({ source: load, revision, data, error: false }) },
      () => { if (!controller.signal.aborted) setResult({ source: load, revision, data: null, error: true }) },
    )
    return () => controller.abort()
  }, [load, revision])

  const current = result?.source === load && result.revision === revision ? result : null
  const reload = useCallback(() => setRevision(value => value + 1), [])
  return { data: current?.data ?? null, error: current?.error ?? false, loading: current === null, reload }
}
