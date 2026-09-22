"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createClient } from "@/lib/supabase/client"
import { subscribeDriverChanged } from "@/lib/drivers/driver-events"

const PHOTO_BUCKET = "driver-photos"
/** Signed URLs are refreshed well before the Supabase default 1h expiry. */
const SIGNED_TTL_SECONDS = 600
const RESIGN_INTERVAL_MS = 5 * 60 * 1000

type PhotoState = {
  /** Storage path currently stored on drivers.photo_url (single source of truth). */
  photoPath: string | null
  /** Signed URL ready for <img src>, with ?v=<updated_at> cache-busting appended. */
  photoUrl: string | null
  isLoading: boolean
  /** Last-known drivers.updated_at — used as the cache-buster version. */
  updatedAt: string | null
  /** Re-reads photo_url from the DB and re-signs immediately. */
  refresh: () => void
}

const PhotoContext = createContext<PhotoState | null>(null)

function withBust(url: string, version: string | null): string {
  if (!version) return url
  try {
    const u = new URL(url)
    u.searchParams.set("v", version)
    return u.toString()
  } catch {
    return url
  }
}

export function DriverPhotoProvider({
  driverId,
  children,
  /**
   * Known photo path (e.g. from a list row that already selected photo_url).
   * Skips the initial DB select — refreshes still read the DB fresh.
   */
  initialPhotoPath,
}: {
  driverId: string
  children: React.ReactNode
  initialPhotoPath?: string | null
}) {
  const [photoPath, setPhotoPath] = useState<string | null>(initialPhotoPath ?? null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const signCountRef = useRef(0)
  const refreshRef = useRef<(() => void) | null>(null)

  const selectAndSign = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from("drivers")
      .select("photo_url, updated_at")
      .eq("id", driverId)
      .maybeSingle()
    const row = (data ?? null) as { photo_url: unknown; updated_at: unknown } | null
    const nextPath = typeof row?.photo_url === "string" && row.photo_url.trim() !== "" ? row.photo_url : null
    const nextUpdatedAt = typeof row?.updated_at === "string" ? row.updated_at : null
    setPhotoPath(nextPath)
    setUpdatedAt(nextUpdatedAt)

    if (!nextPath || /^https?:\/\//i.test(nextPath)) {
      // Full URL (legacy rows) renders directly; empty path clears the photo.
      setPhotoUrl(nextPath)
      return
    }
    const { data: signed } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(nextPath, SIGNED_TTL_SECONDS)
    signCountRef.current += 1
    // Prefer drivers.updated_at as the bust version; fall back to a monotonic
    // signing counter so re-signed URLs never collide with cached ones.
    const version = nextUpdatedAt ?? `s${signCountRef.current}`
    setPhotoUrl(signed?.signedUrl ? withBust(signed.signedUrl, version) : null)
  }, [driverId])

  const initialResolvedRef = useRef(false)

  useEffect(() => {
    // Skip the first DB select when the caller already knows the photo path —
    // sign it directly, then refreshes hit the DB for the live value.
    if (initialResolvedRef.current) return
    initialResolvedRef.current = true
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const run = () => {
      void (async () => {
        try {
          if (initialPhotoPath) {
            if (!/^https?:\/\//i.test(initialPhotoPath)) {
              const { data: signed } = await createClient()
                .storage.from(PHOTO_BUCKET)
                .createSignedUrl(initialPhotoPath, SIGNED_TTL_SECONDS)
              signCountRef.current += 1
              if (!cancelled) {
                setPhotoUrl(signed?.signedUrl ? withBust(signed.signedUrl, `s${signCountRef.current}`) : null)
              }
              return
            }
            if (!cancelled) setPhotoUrl(initialPhotoPath)
            return
          }
          await selectAndSign()
        } finally {
          if (!cancelled) setIsLoading(false)
        }
      })()
    }
    timer = setTimeout(run, 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [initialPhotoPath, selectAndSign])

  // Re-sign when any surface reports a photo change for this driver.
  useEffect(() => {
    if (!driverId) return
    return subscribeDriverChanged((detail) => {
      if (detail.driverId && detail.driverId !== driverId) return
      if (detail.action && detail.action !== "photo") return
      refreshRef.current?.()
    })
  }, [driverId])

  // Periodically re-sign so URLs never outlive their TTL on long-lived tabs.
  useEffect(() => {
    const id = setInterval(() => {
      refreshRef.current?.()
    }, RESIGN_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  const refresh = useCallback(() => {
    void (async () => {
      try {
        await selectAndSign()
      } catch {
        // keep the previous signed URL on transient errors
      }
    })()
  }, [selectAndSign])

  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  const value = useMemo<PhotoState>(
    () => ({ photoPath, photoUrl, isLoading, updatedAt, refresh }),
    [photoPath, photoUrl, isLoading, updatedAt, refresh],
  )

  return <PhotoContext.Provider value={value}>{children}</PhotoContext.Provider>
}

/** Consumes the nearest DriverPhotoProvider. Outside a provider it degrades to nulls. */
export function useDriverPhoto(): PhotoState {
  const ctx = useContext(PhotoContext)
  if (ctx) return ctx
  return {
    photoPath: null,
    photoUrl: null,
    isLoading: false,
    updatedAt: null,
    refresh: () => {},
  }
}

export default DriverPhotoProvider
