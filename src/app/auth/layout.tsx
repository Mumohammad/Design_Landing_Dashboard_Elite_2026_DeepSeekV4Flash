import type { Metadata } from "next"
import { LanguageToggle } from "@/components/language-toggle"

export const metadata: Metadata = {
  title: "Sign In | Elite Development",
  description: "Sign in to the Elite Development logistics platform",
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh flex bg-background">
      {/* Left brand panel — hidden on mobile */}
      <div
        className="hidden lg:flex lg:w-1/2 relative bg-muted bg-cover bg-center"
        style={{
          backgroundImage:
            "url('/Banner.png')",
          backgroundSize: "cover",
          backgroundPosition: "center center",
        }}
      />
      {/* Form panel */}
      <div className="relative flex-1 flex items-center justify-center px-5 py-12 pt-24 sm:px-8 bg-background">
        <div className="absolute end-6 top-6"><LanguageToggle /></div>
        <div className="w-full max-w-[420px]">
          {children}
        </div>
      </div>
    </div>
  )
}
