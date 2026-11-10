"use client"

import { useEffect, useRef, useState } from "react"

/** Animate a number from 0 → value on mount. Jumps instantly when the user
 *  prefers reduced motion. All updates happen inside the rAF callback so the
 *  effect never sets state synchronously. */
export function useCountUp(value: number, duration = 700): number {
  const [display, setDisplay] = useState(0)
  const from = useRef(0)
  const frame = useRef(0)

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const durationMs = reduced ? 0 : duration
    const start = performance.now()
    const fromValue = from.current

    const tick = (now: number) => {
      const t = durationMs <= 0 ? 1 : Math.min((now - start) / durationMs, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(fromValue + (value - fromValue) * eased))
      if (t < 1) {
        frame.current = requestAnimationFrame(tick)
      } else {
        from.current = value
      }
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [value, duration])

  return display
}
