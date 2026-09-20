const DRIVER_DATA_CHANGED = "elite:driver-data-changed"

export type DriverChangedDetail = { driverId?: string }

/**
 * Broadcast that a driver's data changed (photo, status, profile fields…).
 * Any surface holding driver state (list, profile, compliance card) subscribes
 * via subscribeDriverChanged and refetches — no shared context needed.
 */
export function emitDriverChanged(driverId?: string): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<DriverChangedDetail>(DRIVER_DATA_CHANGED, {
      detail: { driverId },
    }),
  )
}

/** Subscribe to driver-data changes. Returns an unsubscribe function. */
export function subscribeDriverChanged(
  handler: (detail: DriverChangedDetail) => void,
): () => void {
  if (typeof window === "undefined") return () => {}
  const listener = (event: Event) => {
    handler((event as CustomEvent<DriverChangedDetail>).detail ?? {})
  }
  window.addEventListener(DRIVER_DATA_CHANGED, listener)
  return () => window.removeEventListener(DRIVER_DATA_CHANGED, listener)
}
