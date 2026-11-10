import type { Metadata } from "next"
import { bengali, nastaliq } from "@/lib/registration-fonts"
import { DriverRegistrationProvider } from "@/contexts/driver-registration-context"

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
