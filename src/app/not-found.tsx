import Link from "next/link"
import { Button } from "@/components/ui/button"
import { FileQuestion } from "lucide-react"

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50">
          <FileQuestion className="h-8 w-8 text-muted-foreground" />
        </div>
        <h1 className="text-4xl font-bold">404</h1>
        <p className="text-muted-foreground mt-2">
          {/* Note: This is a static Server Component — it cannot use client hooks.
              The text is intentionally generic; localized pages use the client error pages. */}
          Page not found
        </p>
        <Button asChild className="mt-4">
          <Link href="/dashboard" aria-label="Go to Dashboard">
            Go to Dashboard
          </Link>
        </Button>
      </div>
    </div>
  )
}
