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
import { withCacheBust } from "@/lib/drivers/photo"

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
    const { data: signed, error: signError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(nextPath, SIGNED_TTL_SECONDS)
    if (signError) {
      console.error("[photo-provider] createSignedUrl failed:", signError.message, nextPath)
    }
    signCountRef.current += 1
    // Prefer drivers.updated_at as the bust version; fall back to a monotonic
    // signing counter so re-signed URLs never collide with cached ones.
    const version = nextUpdatedAt ?? `s${signCountRef.current}`
    setPhotoUrl(signed?.signedUrl ? withCacheBust(signed.signedUrl, version) : null)
  }, [driverId])

  useEffect(() => {
    // Initial sign — StrictMode-safe by construction. The previous shape
    // (one-shot ref guard + setTimeout(0)) was eaten by StrictMode's
    // double-invoke: mount scheduled the timer, cleanup cancelled it, the
    // remount hit the guard and returned — nothing ever signed and every
    // avatar stuck on initials after a hard refresh. The correct pattern is
    // to run the work on EVERY effect invocation with per-invocation
    // cancellation: the discarded first run's state writes are suppressed,
    // the second run completes and lands the signed URL. This also re-signs
    // when the caller supplies a different initial path (list refetch).
    let cancelled = false
    void (async () => {
      try {
        if (initialPhotoPath) {
          if (!/^https?:\/\//i.test(initialPhotoPath)) {
            const { data: signed, error: signError } = await createClient()
              .storage.from(PHOTO_BUCKET)
              .createSignedUrl(initialPhotoPath, SIGNED_TTL_SECONDS)
            if (signError) {
              // Was silent before — a failing sign must be diagnosable.
              console.error("[photo-provider] createSignedUrl failed:", signError.message, initialPhotoPath)
            }
            signCountRef.current += 1
            if (!cancelled) {
              setPhotoUrl(signed?.signedUrl ? withCacheBust(signed.signedUrl, `s${signCountRef.current}`) : null)
            }
            return
          }
          if (!cancelled) setPhotoUrl(initialPhotoPath)
          return
        }
        await selectAndSign()
      } catch (err) {
        console.error("[photo-provider] initial sign failed:", err)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
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
