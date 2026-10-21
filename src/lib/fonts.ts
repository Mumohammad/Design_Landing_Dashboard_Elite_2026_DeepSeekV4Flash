import localFont from 'next/font/local'

// Inter: primary Latin (LTR) font. Applied via html[dir="ltr"] in globals.css.
export const inter = localFont({
  src: '../assets/fonts/inter.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-inter',
  preload: true,
})

// Cairo: primary Arabic (RTL) font. Applied via html[dir="rtl"] in globals.css.
export const cairo = localFont({
  src: '../assets/fonts/cairo.woff2',
  weight: '200 1000',
  style: 'normal',
  display: 'swap',
  variable: '--font-cairo',
  preload: true,
})
