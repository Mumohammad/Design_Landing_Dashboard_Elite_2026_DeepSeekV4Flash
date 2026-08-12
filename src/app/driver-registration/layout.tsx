import type { Metadata } from "next"
import { Noto_Sans_Bengali, Noto_Nastaliq_Urdu } from "next/font/google"
import { DriverRegistrationProvider } from "@/contexts/driver-registration-context"

// Urdu needs Nastaliq; Bengali needs its own Sans. Loaded only on this route
// (next/font scopes them to this layout subtree — the rest of the app keeps
// Inter + Cairo only).
const nastaliq = Noto_Nastaliq_Urdu({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-urdu",
})

const bengali = Noto_Sans_Bengali({
  subsets: ["bengali"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-bengali",
})

export const metadata: Metadata = {
  title: "Driver Registration | Elite Development",
  description:
    "Apply to drive with Elite Development. Complete your driver application online — no account needed. Available in العربية, English, اردو and বাংলা.",
  alternates: {
    canonical: "/driver-registration",
  },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Driver Registration | Elite Development",
    description: "Start your journey with Elite Development — complete your driver application online.",
    type: "website",
    url: "/driver-registration",
  },
}

export default function DriverRegistrationLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <DriverRegistrationProvider>
      <div className={`${nastaliq.variable} ${bengali.variable}`}>{children}</div>
    </DriverRegistrationProvider>
  )
}
