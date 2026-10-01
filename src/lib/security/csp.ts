/**
 * Content-Security-Policy builder — single source of truth for next.config.ts.
 *
 * Kept pure (no next imports) so vitest can parse the produced header and
 * regress-test the origins that keep the private-storage photo pipeline
 * renderable (Prompt M2): if `img-src` ever loses the Supabase origin again,
 * every signed storage <img> is blocked after refresh and avatars fall back
 * to initials.
 */

export type CspOptions = {
  /** dev builds allow Turbopack eval() and the local Supabase stack. */
  isDev: boolean
  /**
   * NEXT_PUBLIC_SUPABASE_URL — its origin is allowlisted for BOTH connect-src
   * (REST/auth/storage API) and img-src (private-bucket signed URLs render
   * from exactly this origin).
   */
  supabaseUrl?: string | null
}

/** Local Supabase stack origin (supabase start defaults). */
export const LOCAL_SUPABASE_ORIGIN = "http://127.0.0.1:54321"

/** Resolve the Supabase origin defensively — an unset/empty env must not crash the build. */
export function supabaseOriginFromEnv(supabaseUrl?: string | null): string {
  try {
    return new URL(supabaseUrl || "https://localhost").origin
  } catch {
    return "https://localhost"
  }
}

export function buildCsp({ isDev, supabaseUrl }: CspOptions): string {
  const supabaseOrigin = supabaseOriginFromEnv(supabaseUrl)

  return [
    "default-src 'self'",
    // React dev mode + Turbopack HMR need eval() (source-map reconstruction) —
    // allow it only outside production. Production CSP stays strict.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // The Supabase project origin MUST stay img-src-allowlisted: driver photos
    // render from PRIVATE-bucket signed URLs on exactly this origin
    // (https://<ref>.supabase.co/storage/v1/object/sign/...). Without it prod
    // blocks the <img> after refresh and every avatar falls back to initials,
    // while the optimistic blob: preview keeps working — the exact "photo
    // vanishes after refresh" incident (Prompt M / M2).
    `img-src 'self' data: blob: ${supabaseOrigin} https://*.supabase.co https://ui.shadcn.com https://images.unsplash.com`,
    // Fonts are self-hosted via next/font (no googleapis/gstatic anywhere) —
    // font-src stays 'self' only. See src/lib/font-policy.test.ts.
    "font-src 'self'",
    // The local Supabase stack origin is allowlisted ONLY in development so
    // `next dev` against `supabase start` can reach REST/auth/storage.
    // Production connect-src stays strict.
    "connect-src 'self' https://*.supabase.co" +
      (isDev ? ` ${LOCAL_SUPABASE_ORIGIN} ws://127.0.0.1:54321` : "") +
      " https://api.resend.com https://api.emailjs.com https://zatca.gov.sa https://*.ingest.sentry.io",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ")
}
