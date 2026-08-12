import type { Metadata } from "next"

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
            "linear-gradient(135deg, rgba(12,45,74,0.45) 0%, rgba(30,90,153,0.35) 50%, rgba(232,125,62,0.25) 100%), url('/Banner.png')",
          backgroundSize: "cover",
          backgroundPosition: "center center",
        }}
      >
        {/* Logo top-left — rendered by sign-in page via LogoMark */}
        <div className="absolute top-8 left-8">
          {/* LogoMark will be rendered here by the sign-in page or a shared component */}
        </div>
      </div>
      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-[420px]">
          {children}
        </div>
      </div>
    </div>
  )
}
