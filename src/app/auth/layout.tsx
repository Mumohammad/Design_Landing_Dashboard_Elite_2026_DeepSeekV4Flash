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
    <div className="min-h-screen flex">
      {/* Left brand panel — hidden on mobile */}
      <div
        className="hidden lg:flex lg:w-1/2 relative bg-cover bg-center"
        style={{
          backgroundImage:
            "url('/Banner.png')",
          backgroundSize: "cover",
          backgroundPosition: "center center",
        }}
      >
        <div aria-hidden className="absolute inset-0 bg-elite-blue-950/45" />
        {/* Logo top-left — rendered by sign-in page via LogoMark */}
        <div className="absolute top-8 left-8">
          {/* LogoMark will be rendered here by the sign-in page or a shared component */}
        </div>
      </div>
      {/* Right form panel */}
      <div className="relative flex-1 flex items-center justify-center p-6 pt-20 bg-background">
        <div className="absolute end-6 top-6"><LanguageToggle /></div>
        <div className="w-full max-w-[420px]">
          {children}
        </div>
      </div>
    </div>
  )
}
