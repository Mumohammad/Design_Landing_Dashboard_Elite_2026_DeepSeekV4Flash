"use client"

// Fallback only — since the `next.config.ts` redirect (`/` → `/landing`,
// permanent 308) handles the root URL server-side, this page normally never
// renders. It stays as a safe client-side fallback if the redirect is ever
// removed. The server redirect is preferred for SEO (no JS-only spinner
// page for crawlers).

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/landing")
  }, [router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
        <p className="text-muted-foreground mt-2">Redirecting to Elite Development...</p>
      </div>
    </div>
  )
}
