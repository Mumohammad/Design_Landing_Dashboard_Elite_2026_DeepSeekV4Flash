import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "حالة الخدمة | System status",
  description: "Live availability of the EliteDev application, database and authentication.",
  robots: { index: true, follow: true },
}

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return children
}
