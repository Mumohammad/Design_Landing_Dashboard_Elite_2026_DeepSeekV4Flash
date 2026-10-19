import localFont from "next/font/local"

// Imported by the registration layouts only, preserving route-scoped loading.
export const nastaliq = localFont({
  src: "../assets/fonts/notonastaliqurdu.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-urdu",
})

export const bengali = localFont({
  src: "../assets/fonts/notosansbengali.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-bengali",
})
