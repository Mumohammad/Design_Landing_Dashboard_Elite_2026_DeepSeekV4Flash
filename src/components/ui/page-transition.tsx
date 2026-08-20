"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"

const pageVariants = {
  initial: {
    opacity: 0,
    y: 8,
    filter: "blur(4px)",
  },
  enter: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
  },
  exit: {
    opacity: 0,
    y: -4,
    filter: "blur(4px)",
  },
}

const pageTransition = {
  type: "tween",
  ease: [0.4, 0, 0.2, 1],
  duration: 0.35,
}

/** Instant variants when reduced motion is preferred. */
const instantVariants = {
  initial: { opacity: 1 },
  enter: { opacity: 1 },
  exit: { opacity: 1 },
}

const instantTransition = { duration: 0 }

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  })

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  return reduced
}

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [isFirst, setIsFirst] = useState(true)
  const reducedMotion = useReducedMotion()

  // Skip animation on initial mount — only animate route changes
  useEffect(() => {
    const timer = requestAnimationFrame(() => setIsFirst(false))
    return () => cancelAnimationFrame(timer)
  }, [])

  const v = reducedMotion ? instantVariants : pageVariants
  const t = reducedMotion ? instantTransition : pageTransition

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        variants={isFirst ? undefined : v}
        initial={isFirst ? undefined : "initial"}
        animate={isFirst ? undefined : "enter"}
        exit={isFirst ? undefined : "exit"}
        transition={isFirst ? undefined : t}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
