import * as React from "react"

const MOBILE_BREAKPOINT = 768

function getServerMobileSnapshot() {
  return false
}

export function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
  const media = `(max-width: ${breakpoint - 1}px)`
  const subscribe = React.useCallback((onChange: () => void) => {
    const query = window.matchMedia(media)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [media])
  const getSnapshot = React.useCallback(() => window.matchMedia(media).matches, [media])
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerMobileSnapshot)
}
