"use client"

import * as React from "react"
import { AnimatePresence, motion } from "framer-motion"
import { useDriverRegistration } from "@/contexts/driver-registration-context"
import { WelcomeHero } from "./components/welcome-hero"
import { Wizard, type PlatformOption } from "./components/wizard"
import {
  discardSavedApplication,
  loadSavedApplication,
} from "@/lib/driver-registration/saved-application-actions"
import type { StepKey } from "@/lib/driver-registration/schema"

export function RegistrationApp({ tenantSlug }: { tenantSlug: string }) {
  const { locale, hydrate, reset } = useDriverRegistration()
  const [started, setStarted] = React.useState(false)
  const [platformOptions, setPlatformOptions] = React.useState<PlatformOption[]>([])
  const [saved, setSaved] = React.useState<Awaited<ReturnType<typeof loadSavedApplication>>>(null)
  const [startStep, setStartStep] = React.useState<StepKey>("personal")

  // Offer to resume progress sealed in this browser's httpOnly cookie.
  React.useEffect(() => {
    let cancelled = false
    loadSavedApplication(tenantSlug)
      .then((found) => {
        if (!cancelled) setSaved(found)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [tenantSlug])

  const resume = () => {
    if (!saved) return
    hydrate(saved.data)
    setStartStep(saved.step)
    setStarted(true)
  }

  const startOver = () => {
    reset()
    setSaved(null)
    setStartStep("personal")
    void discardSavedApplication().catch(() => undefined)
  }

  // Load the platform list from Supabase config (driver_application_platforms).
  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { createClient } = await import("@/lib/supabase/client")
        const supabase = createClient()
        const { data } = await supabase
          .from("driver_application_platforms")
          .select("code, name_en, name_ar, name_ur, name_bn, emoji, sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
        if (!cancelled && data && data.length) {
          setPlatformOptions(
            data.map((p) => ({
              code: p.code,
              label:
                locale === "ar"
                  ? p.name_ar
                  : locale === "ur"
                    ? p.name_ur ?? p.name_en
                    : locale === "bn"
                      ? p.name_bn ?? p.name_en
                      : p.name_en,
              emoji: p.emoji ?? undefined,
            }))
          )
        }
      } catch {
        /* DB unavailable — fall back to built-in defaults */
        if (!cancelled) {
          setPlatformOptions([
            { code: "hungerstation", label: locale === "ar" ? "هنقرستيشن" : "HungerStation", emoji: "🍔" },
            { code: "keeta", label: locale === "ar" ? "كيتا" : "Keeta", emoji: "🍽️" },
            { code: "noon", label: locale === "ar" ? "نون" : "Noon", emoji: "🟡" },
            { code: "ninja", label: locale === "ar" ? "نينجا" : "Ninja", emoji: "🥷" },
          ])
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [locale])

  return (
    <AnimatePresence mode="wait">
      {!started ? (
        <motion.div
          key="welcome"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, y: -24 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <WelcomeHero
            onStart={() => setStarted(true)}
            saved={saved ? { savedAt: saved.savedAt } : null}
            onResume={resume}
            onStartOver={startOver}
          />
        </motion.div>
      ) : (
        <motion.div
          key="wizard"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <Wizard platformOptions={platformOptions} tenantSlug={tenantSlug} initialStep={startStep} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
