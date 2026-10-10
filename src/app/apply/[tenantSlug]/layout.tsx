import type { Metadata } from "next"
import { Noto_Sans_Bengali, Noto_Nastaliq_Urdu } from "next/font/google"
import { DriverRegistrationProvider } from "@/contexts/driver-registration-context"
import "../../driver-registration/print.css"

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
