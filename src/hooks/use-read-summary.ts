"use client"

import { useCallback, useEffect, useState } from "react"

/** Keep failed/missing metrics unknown; never turn a failed count into zero. */
export function useReadSummary<T>(read: (signal: AbortSignal) => Promise<T>) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ value: T | null; error: boolean }>({ value: null, error: false })
  const reload = useCallback(() => {
    setState({ value: null, error: false })
    setRevision(value => value + 1)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setState({ value: null, error: false })
      try {
        const value = await read(controller.signal)
        if (!controller.signal.aborted) setState({ value, error: false })
      } catch {
        if (!controller.signal.aborted) setState({ value: null, error: true })
      }
    }, 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [read, revision])
  return { ...state, reload }
}
