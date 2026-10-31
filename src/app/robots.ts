import type { MetadataRoute } from "next"

const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/landing", "/help", "/privacy", "/terms", "/status", "/apply", "/platform/register"],
        disallow: ["/api/", "/dashboard", "/settings", "/platform/admin", "/auth/", "/verify-document", "/driver-application-status"],
      },
    ],
    ...(base ? { sitemap: `${base}/sitemap.xml` } : {}),
  }
}
