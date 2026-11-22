import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"

// A native link starts a fresh document even when the app router has failed.
export function RecoveryLink({ href, children }: {
  href: "/" | "/dashboard" | "/users"
  children: ReactNode
}) {
  return (
    <Button asChild variant="outline" className="rounded-xl">
      <a href={href}>{children}</a>
    </Button>
  )
}
