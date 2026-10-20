"use client"

import { useSyncExternalStore } from "react"
import { businessDateKey } from "@/lib/formatting/business-date"

const readDay = () => businessDateKey(new Date())
// Static HTML and its first hydration render must share a stable placeholder.
// A build-time date would become stale, even with matching host timezones.
const readServerDay = (): string | null => null
function subscribe(onChange: () => void) {
  const timer = window.setInterval(onChange, 60_000)
  window.addEventListener("focus", onChange)
  return () => { window.clearInterval(timer); window.removeEventListener("focus", onChange) }
}

export function useBusinessDate(): string | null {
  return useSyncExternalStore(subscribe, readDay, readServerDay)
}
