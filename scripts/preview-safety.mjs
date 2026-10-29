// Build-time environment isolation. Fixed errors must never include configuration values.
export const STAGING_REF = "viowrovartosrkqukjxy"
const variables = {
  NEXT_PUBLIC_SUPABASE_URL: "STAGING_SUPABASE_URL",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "STAGING_SUPABASE_ANON_KEY",
  SUPABASE_SERVICE_ROLE_KEY: "STAGING_SUPABASE_SERVICE_KEY",
}

export function verifyPreviewEnvironment(env, pulled) {
  for (const name of Object.values(variables)) {
    if (!env[name]?.trim()) throw new Error(`MISSING: ${name}`)
  }
  let url
  try { url = new URL(env.STAGING_SUPABASE_URL) } catch { /* fail below */ }
  if (!url || url.href !== `https://${STAGING_REF}.supabase.co/`) {
    throw new Error("Staging URL must identify the explicitly approved staging project")
  }
  // Opaque new-style keys cannot be project-bound by decoding. Real API/E2E
  // verification is still required. Legacy JWT metadata catches obvious mixups,
  // but is not signature verification or proof of credential validity.
  for (const [name, role, prefix] of [
    ["STAGING_SUPABASE_ANON_KEY", "anon", "sb_publishable_"],
    ["STAGING_SUPABASE_SERVICE_KEY", "service_role", "sb_secret_"],
  ]) {
    const value = env[name]
    if (!value.startsWith(prefix)) {
      let payload
      try { payload = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString()) } catch { /* fail below */ }
      if (!payload || payload.ref !== STAGING_REF || payload.role !== role) {
        throw new Error(`${name} does not match the staging project/key role`)
      }
    }
  }
  if (pulled) {
    for (const [name, stagingName] of Object.entries(variables)) {
      if (pulled[name] !== env[stagingName]) {
        throw new Error(`Vercel Preview ${name} differs from approved staging configuration`)
      }
    }
    try { previewOrigin(pulled.NEXT_PUBLIC_APP_URL) } catch {
      throw new Error("Vercel Preview NEXT_PUBLIC_APP_URL must be a same-project preview origin")
    }
    if (["DEPLOYMENT_ROLE", "PUBLIC_DASHBOARD_URL", "PUBLIC_LANDING_URL",
      "NEXT_PUBLIC_DASHBOARD_URL", "NEXT_PUBLIC_LANDING_URL"].some(name => pulled[name])) {
      throw new Error("Preview must use single-host routing without production auth origins")
    }
    if (pulled.NEXT_PUBLIC_SITE_URL && pulled.NEXT_PUBLIC_SITE_URL !== pulled.NEXT_PUBLIC_APP_URL) {
      throw new Error("Preview must not inherit a foreign site/email origin")
    }
    if (pulled.ZATCA_MODE && pulled.ZATCA_MODE !== "mock") {
      throw new Error("Preview must use offline ZATCA mock mode")
    }
    if (pulled.ZATCA_API_BASE_URL || pulled.ZATCA_PRODUCTION_ENABLED === "true") {
      throw new Error("Preview must not enable external ZATCA submission")
    }
  }
}

// Native Vercel Git builds bypass Actions' pull/config guard. Validate their
// actual build environment too, before Next compiles public values into JS.
// This does not authenticate opaque keys or inspect Supabase Auth URL settings.
export function verifyNativePreviewEnvironment(env) {
  if (env.VERCEL_ENV !== "preview" && env.VERCEL_TARGET_ENV !== "staging") return
  verifyPreviewEnvironment({
    STAGING_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    STAGING_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    STAGING_SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  }, env)
}


export function previewOrigin(value) {
  let url
  try { url = new URL(value) } catch { /* fail below */ }
  if (!url || url.protocol !== "https:" || url.username || url.password || url.port ||
    url.pathname !== "/" || url.search || url.hash ||
    !/^elite-dashboard-[a-z0-9-]+-elitesaasc-5643\.vercel\.app$/.test(url.hostname) ||
    url.hostname === "elite-dashboard-git-master-elitesaasc-5643.vercel.app") {
    throw new Error("PREVIEW_URL must identify an elite-dashboard preview origin")
  }
  return url.origin
}

