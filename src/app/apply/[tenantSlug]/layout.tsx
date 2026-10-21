import type { Metadata } from "next"
import { bengali, nastaliq } from "@/lib/registration-fonts"
import { DriverRegistrationProvider } from "@/contexts/driver-registration-context"
import "../../driver-registration/print.css"

export const metadata: Metadata = {
  title: "Driver Registration | Elite Development",
  description: "Submit a driver application to the company that shared this link.",
  robots: { index: false, follow: false },
}

export default function TenantApplicationLayout({ children }: { children: React.ReactNode }) {
  return (
    <DriverRegistrationProvider>
      <div className={`${nastaliq.variable} ${bengali.variable}`}>{children}</div>
    </DriverRegistrationProvider>
  )
}
