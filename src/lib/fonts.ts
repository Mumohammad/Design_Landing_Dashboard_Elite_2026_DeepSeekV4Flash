import { Cairo, Inter } from 'next/font/google'

// Inter: primary Latin (LTR) font. Applied via html[dir="ltr"] in globals.css.
export const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  preload: true,
})

// Cairo: primary Arabic (RTL) font. Applied via html[dir="rtl"] in globals.css.
export const cairo = Cairo({
  subsets: ['arabic'],
  display: 'swap',
  variable: '--font-cairo',
  preload: true,
})
