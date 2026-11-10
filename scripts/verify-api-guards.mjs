#!/usr/bin/env node
/**
 * FX-10 — API route guard verification.
 *
 * Fails the build unless every API route file under src/app/api
 * (any "route.ts" file in that tree) either:
 *   1. calls a recognized auth/verification guard, OR
 *   2. is listed in src/lib/public-endpoints.ts (public by design).
 *
 * Dependency-free (Node core only) so it can run as an early CI gate.
 *
 * Recognized guards are evidence-based — they map 1:1 to helpers actually
 * used by this codebase. If you add a new guard helper, register it here.
 *
 * The allowlist is parsed from src/lib/public-endpoints.ts by reading the
 * PUBLIC_ENDPOINTS string-literal array — no TS runtime needed.
 *
 * Usage: node scripts/verify-api-guards.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const ROOT = process.cwd();
const API_DIR = join(ROOT, "src", "app", "api");
const ALLOWLIST_FILE = join(ROOT, "src", "lib", "public-endpoints.ts");

/**
 * Recognized guard call sites. A route passes if its source contains any of
 * these tokens. Evidence per token:
 *   - verifyPlatformAdmin        → src/lib/platform/admin-guard.ts (Bearer + platform_admins check)
 *   - requirePlatformAdmin       → src/lib/platform/admin.ts (server-side platform admin ctx)
 *   - requirePermission          → server actions / routes permission helper (P0 invariant #5)
 *   - getCurrentUser             → src/lib/auth/authorization.ts (session → user row)
 *   - getSessionUser             → session-based user helper
 *   - getAuthenticatedUser       → authenticated-user helper
 *   - supabase.auth.getUser      → direct Supabase session validation (e.g. platform/me)
 *   - signInWithPassword         → auth credential exchange (sign-in route itself)
 *   - resetPasswordForEmail      → Supabase auth flow (forgot-password)
 *   - rateLimitSignIn            → J1 limiter (auth-flow routes)
 *   - rateLimitForgotPassword    → J1 limiter (auth-flow routes)
 *   - rateLimitRegister          → FX-08/J7 limiter (public registration)
 *   - verifyIncomingWebhookWithFreshness → HMAC-SHA256 + replay-window verification
 *   - verifyWebhookSignature     → webhook HMAC verification helper
 *   - CRON_SECRET                → fail-closed secret bearer (webhooks/cron)
 *   - LOAD_TEST_SECRET           → fail-closed secret bearer (load-test)
 */
const GUARD_TOKENS = [
  "verifyPlatformAdmin",
  "requirePlatformAdmin",
  "requirePermission",
  "getCurrentUser",
  "getSessionUser",
  "getAuthenticatedUser",
  "supabase.auth.getUser",
  "signInWithPassword",
  "resetPasswordForEmail",
  "rateLimitSignIn",
  "rateLimitForgotPassword",
  "rateLimitRegister",
  "verifyIncomingWebhookWithFreshness",
  "verifyWebhookSignature",
  "CRON_SECRET",
  "LOAD_TEST_SECRET",
];

/** Recursively collect all route.ts files under src/app/api. */
function collectRouteFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectRouteFiles(full));
    } else if (entry === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

/** Extract the string-literal entries of PUBLIC_ENDPOINTS from the TS source. */
function parseAllowlist(source) {
  const m = source.match(/PUBLIC_ENDPOINTS(?::[^=]+)?=\s*\[([\s\S]*?)\]/);
  if (!m) {
    console.error(`❌ Could not find PUBLIC_ENDPOINTS array in ${ALLOWLIST_FILE}`);
    process.exit(1);
  }
  const entries = [...m[1].matchAll(/["'`](\/[^"'`]+)["'`]/g)].map((x) => x[1]);
  if (entries.length === 0) {
    console.error(`❌ PUBLIC_ENDPOINTS parsed as empty — parsing error or drained allowlist?`);
    process.exit(1);
  }
  return entries;
}

/** Route file path → endpoint path: src/app/api/health/route.ts → /api/health. */
function routeToEndpoint(routeFile) {
  const rel = routeFile.slice(ROOT.length + 1).split(sep).join("/");
  return "/" + rel.replace(/\/route\.ts$/, "").replace(/^src\/app\//, "");
}

const allowlist = parseAllowlist(readFileSync(ALLOWLIST_FILE, "utf8"));
const allowlistSet = new Set(allowlist);

const routeFiles = collectRouteFiles(API_DIR);
if (routeFiles.length === 0) {
  console.error("❌ No route.ts files found under src/app/api — unexpected repo state");
  process.exit(1);
}

const unguarded = [];
const guarded = [];

for (const file of routeFiles) {
  const endpoint = routeToEndpoint(file);
  const src = readFileSync(file, "utf8");
  if (GUARD_TOKENS.some((token) => src.includes(token))) {
    guarded.push(endpoint);
  } else if (allowlistSet.has(endpoint)) {
    guarded.push(`${endpoint} (allowlisted)`);
  } else {
    unguarded.push(endpoint);
  }
}

// Allowlist hygiene: every entry must point at a real route file.
const routeEndpoints = new Set(routeFiles.map(routeToEndpoint));
const orphaned = allowlist.filter((e) => !routeEndpoints.has(e));

console.log(`FX-10 guard check — ${routeFiles.length} API routes scanned`);
console.log(`  ✅ guarded/allowlisted: ${guarded.length}`);
if (orphaned.length > 0) {
  console.error(`\n❌ Allowlist entries with no matching route file (stale entries):`);
  for (const e of orphaned) console.error(`   - ${e}`);
}

if (unguarded.length > 0) {
  console.error(`\n❌ UNGUARDED API routes detected (${unguarded.length}):`);
  for (const e of unguarded) {
    console.error(`   - ${e}`);
    console.error(`     Fix: add a recognized guard (verifyPlatformAdmin / requirePlatformAdmin /`);
    console.error(`     requirePermission / auth check / rate limiter / secret or HMAC verification)`);
    console.error(`     OR add the path to src/lib/public-endpoints.ts with a documented reason`);
    console.error(`     if the endpoint is public by design.`);
  }
}

if (unguarded.length > 0 || orphaned.length > 0) process.exit(1);

console.log("\n✅ Every API route is guarded or explicitly allowlisted (FX-10)");
