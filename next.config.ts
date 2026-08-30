import type { NextConfig } from "next"
import { withSentryConfig } from "@sentry/nextjs"


const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react", "@radix-ui/react-icons"],
  },
  turbopack: {
    // Fix for Turbopack on Windows: multiple lockfiles in parent dirs make
    // Next infer the wrong workspace root, which breaks the PostCSS worker
    // (node exits 0xc0000142 during CSS compile). Pin the project root.
    root: process.platform === 'win32' ? '.' : undefined,
  },


  // NOTE: Locale is handled client-side via LocaleProvider (localStorage +
  // lang/dir attributes). The legacy `i18n` config block was removed — it is
  // unsupported in App Router and generated bogus /ar/* prerender routes.


  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ui.shadcn.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
    formats: ['image/webp', 'image/avif'],
  },


  // Headers for better security and performance
  async headers() {
    const headers = [
      {
        key: 'X-Frame-Options',
        value: 'DENY',
      },
      {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
      },
      {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin',
      },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), payment=()',
      },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          // React dev mode + Turbopack HMR need eval() (source-map
          // reconstruction) — allow it only outside production. The
          // production CSP below stays strict, same as the HSTS gate.
          `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https://ui.shadcn.com https://images.unsplash.com",
          "font-src 'self'",
          "connect-src 'self' https://*.supabase.co https://api.resend.com https://api.emailjs.com https://zatca.gov.sa https://*.ingest.sentry.io",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; '),
      },
    ];


    // HSTS is only safe over real HTTPS deployments; skip it on localhost.
    if (process.env.NODE_ENV === 'production') {
      headers.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      });
    }


    return [
      {
        source: '/(.*)',
        headers,
      },
    ];
  },


  // Redirects for better SEO
  async redirects() {
    return [
      {
        // The landing page is the site's public homepage — serve it at the
        // root with a permanent (308) server-side redirect instead of the
        // old client-side replace, so crawlers and social bots never see a
        // JS-only spinner page.
        source: '/',
        destination: '/landing',
        permanent: true,
      },
      {
        // Legacy URLs kept from the Phase 1 middleware.
        source: '/login',
        destination: '/auth/sign-in',
        permanent: false,
      },
      {
        // Legacy URLs kept from the Phase 1 middleware.
        source: '/register',
        destination: '/auth/accept-invite',
        permanent: false,
      },
      {
        source: '/home',
        destination: '/dashboard',
        permanent: true,
      },
    ];
  },
};


export default withSentryConfig(nextConfig, {
  // Automatically tree-shake Sentry logger to reduce bundle size
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Auth token for source map uploads (CI only — never commit)
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Upload source maps in production builds
  widenClientFileUpload: true,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
  // Automatically inject Sentry in all pages and error handlers
  webpack: {
    automaticVercelMonitors: true,
  },
})
