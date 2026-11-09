import type { MetadataRoute } from "next"

const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")
const PUBLIC_PATHS = ["/landing", "/help", "/privacy", "/terms", "/status", "/apply", "/platform/register"]

export default function sitemap(): MetadataRoute.Sitemap {
  if (!base) return []
  return PUBLIC_PATHS.map((path) => ({ url: `${base}${path}`, changeFrequency: "monthly", priority: path === "/landing" ? 1 : 0.5 }))
}
