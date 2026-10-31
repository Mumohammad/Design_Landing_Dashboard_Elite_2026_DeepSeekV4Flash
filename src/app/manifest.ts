import type { MetadataRoute } from "next"

// Installable web app (Add to Home Screen) for supervisors on mobile.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EliteDev — نخبة التطوير",
    short_name: "EliteDev",
    description: "Saudi 3PL operations: drivers, fleet, payroll, invoicing and accounting.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    dir: "rtl",
    lang: "ar",
    background_color: "#ffffff",
    theme_color: "#1E5A99",
    icons: [
      { src: "/favicon.png", sizes: "64x64", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  }
}
