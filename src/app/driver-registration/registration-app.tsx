"use client"

import * as React from "react"
import { AnimatePresence, motion } from "framer-motion"
import { useDriverRegistration } from "@/contexts/driver-registration-context"
import { WelcomeHero } from "./components/welcome-hero"
import { Wizard, type PlatformOption } from "./components/wizard"

export function RegistrationApp() {
  const { locale } = useDriverRegistration()
  const [started, setStarted] = React.useState(false)
  const [platformOptions, setPlatformOptions] = React.useState<PlatformOption[]>([])

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
          <WelcomeHero onStart={() => setStarted(true)} />
        </motion.div>
      ) : (
        <motion.div
          key="wizard"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <Wizard platformOptions={platformOptions} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
