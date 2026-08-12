import type { Metadata } from "next"
import "./globals.css"

import { ThemeProvider } from "@/components/theme-provider"
import { SidebarConfigProvider } from "@/contexts/sidebar-context"
import { LocaleProvider } from "@/contexts/locale-context"
import { cairo, inter } from "@/lib/fonts"

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://elitedev.com.sa"),
  title: "Elite Development | نخبة التطوير",
  description: "منصة Elite Development لتشغيل وإدارة الأسطول اللوجستي المؤسسي.",
  icons: {
    icon: [
      { url: "/favicon.png?v=2", media: "(prefers-color-scheme: light)" },
      { url: "/favicon-dark.png?v=2", media: "(prefers-color-scheme: dark)" },
    ],
    apple: "/apple-icon.png",
  },
}

// Inline script to prevent flash of wrong lang/dir before hydration.
// Runs synchronously before React hydrates, reading the saved locale from localStorage.
const localeInitScript = `
(function() {
  try {
    var locale = localStorage.getItem('elite-locale');
    if (locale === 'en' || locale === 'ar') {
      document.documentElement.lang = locale;
      document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    } else {
      document.documentElement.lang = 'ar';
      document.documentElement.dir = 'rtl';
    }
  } catch (e) {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
  }
})();
`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning className={`${inter.variable} ${cairo.variable} antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: localeInitScript }} />
      </head>
      <body className={`${inter.className} ${cairo.className}`}>
        <ThemeProvider defaultTheme="system" storageKey="elite-ui-theme">
          <LocaleProvider>
            <SidebarConfigProvider>{children}</SidebarConfigProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
