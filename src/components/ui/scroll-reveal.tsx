"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/** Respect prefers-reduced-motion: skip animations entirely. */
// Lazy-initialise on first client render to avoid SSR/Node window issues
let reducedMotion = false
if (typeof window !== "undefined") {
  try {
    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    /* SSR or unsupported */
  }
}

type RevealDirection = "up" | "down" | "left" | "right" | "scale" | "fade"

interface ScrollRevealProps {
  children: ReactNode
  /** Animation direction when entering viewport */
  direction?: RevealDirection
  /** Delay in ms before animation starts (for staggered reveals) */
  delay?: number
  /** Duration in ms of the animation */
  duration?: number
  /** How far from the viewport edge the trigger fires (0–1) */
  threshold?: number
  /** Only animate once, or re-animate on re-entry */
  once?: boolean
  /** Additional CSS classes */
  className?: string
}

const directionStyles: Record<RevealDirection, { initial: string; visible: string }> = {
  up: {
    initial: "opacity-0 translate-y-8",
    visible: "opacity-100 translate-y-0",
  },
  down: {
    initial: "opacity-0 -translate-y-8",
    visible: "opacity-100 translate-y-0",
  },
  left: {
    initial: "opacity-0 translate-x-8",
    visible: "opacity-100 translate-x-0",
  },
  right: {
    initial: "opacity-0 -translate-x-8",
    visible: "opacity-100 translate-x-0",
  },
  scale: {
    initial: "opacity-0 scale-95",
    visible: "opacity-100 scale-100",
  },
  fade: {
    initial: "opacity-0",
    visible: "opacity-100",
  },
}

export function ScrollReveal({
  children,
  direction = "up",
  delay = 0,
  duration = 500,
  threshold = 0.15,
  once = true,
  className,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          if (once) observer.unobserve(el)
        } else if (!once) {
          setIsVisible(false)
        }
      },
      { threshold, rootMargin: "0px 0px -40px 0px" }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold, once])

  const styles = directionStyles[direction]

  // In reduced-motion mode, skip the hidden initial state entirely
  const forceVisible = reducedMotion

  return (
    <div
      ref={ref}
      className={cn(
        "transition-all will-change-[opacity,transform]",
        forceVisible || isVisible ? styles.visible : styles.initial,
        className
      )}
      style={{
        transitionDuration: `${duration}ms`,
        transitionDelay: isVisible ? `${delay}ms` : "0ms",
        transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {children}
    </div>
  )
}

/**
 * Staggered container — children animate in sequence.
 * Each direct child gets an auto-calculated delay.
 */
export function StaggerContainer({
  children,
  className,
  staggerDelay = 80,
  direction = "up",
  threshold = 0.1,
}: {
  children: ReactNode
  className?: string
  staggerDelay?: number
  direction?: RevealDirection
  threshold?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.unobserve(el)
        }
      },
      { threshold, rootMargin: "0px 0px -40px 0px" }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold])

  const styles = directionStyles[direction]
  const forceVisible = reducedMotion

  // Clone children to inject stagger delays
  const childrenArray = Array.isArray(children) ? children : [children]

  return (
    <div ref={ref} className={className}>
      {childrenArray.map((child, i) => (
        <div
          key={i}
          className={cn(
            "transition-all will-change-[opacity,transform]",
            forceVisible || isVisible ? styles.visible : styles.initial
          )}
          style={{
            transitionDuration: "500ms",
            transitionDelay: isVisible ? `${i * staggerDelay}ms` : "0ms",
            transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          {child}
        </div>
      ))}
    </div>
  )
}
