# Phase 2 Auth & Security Plan — EliteDev Saudi 3PL Platform (Application Layer)

- **Status:** DRAFT — awaiting approval (ADR-014 Phase 2 gate, ADR-019 correction gate)
- **Date:** 2026-07-19
- **Owner:** EliteDev engineering
- **Scope:** Next.js application-layer auth and security for Phase 2 (per `docs/implementation-plan.md` Phase 2)
- **Purpose:** This is a PLANNING DOCUMENT ONLY. It documents the intended implementation of authentication, authorization middleware, rate limiting, invite flow, authorization service, error handling, and session management at the **Next.js application layer**. No migration files are created here. No production code is touched here. Code blocks are ILLUSTRATIVE planned content, not applied.
- **Companion document:** `docs/phase-2-schema-plan.md` — the DB schema plan (tables, RLS, triggers, storage buckets, seed data). This auth plan REFERENCES the schema plan and does NOT duplicate its DDL.
- **Authoritative references:**
  - `docs/elite-master-prompt-v2.md` section 6 M8 (Settings & Auth corrections) and section 5.2 (error code taxonomy)
  - `docs/architecture-decisions.md` ADR-006 (RBAC + RLS), ADR-013 (client-side locale), ADR-014 (replace dead scaffolding), ADR-019 (v2.0 correction set)
  - `docs/implementation-plan.md` Phase 2 scope and acceptance criteria

---

## 1. Overview and scope

### 1.1 What Phase 2 auth/security covers (application layer)

This plan covers the **Next.js App Router application layer** for auth and security. The database schema that backs it (tables, RLS, triggers, storage buckets, seed data, the `auth.users` sync trigger, the `get_my_tenant_id()` helper, the RLS `WITH CHECK` correction) lives in `docs/phase-2-schema-plan.md` and is NOT re-specified here.

The application-layer scope is:

1. **`@supabase/ssr` setup** — cookie-based Supabase clients for Client Components, Server Components, Server Actions, and Route Handlers, replacing the dead `@supabase/supabase-js` wrappers flagged in ADR-014.
2. **Narrowed middleware matcher with auth guard** — the M8 / ADR-019 correction: middleware runs ONLY on dashboard routes, excludes static assets and public auth routes, reads the session from cookies, performs account-status and role checks, and refreshes the session cookie.
3. **Rate limiting** — application-layer rate limiting for sign-in, forgot-password, 2FA verify, report generation, and orders import. The v2.0 spec specifies `slowapi` (a FastAPI library), but this project is Next.js-only with Supabase as the backend; this plan documents that discrepancy and recommends a Next.js-native approach.
4. **Invite architecture** — the end-to-end invite flow from GM action through email delivery, token hashing, acceptance, auth.users + custom users creation, and audit logging.
5. **Authorization service (`can()` replacement)** — a real server-side authorization service that replaces the always-`true` stub in `src/lib/permissions/can.ts` (ADR-014), backed by the RBAC tables defined in the schema plan.
6. **Error code taxonomy mapping** — mapping the v2.0 `ERR_<PREFIX>` codes (AUTH/DRV/PAY/VIO/VEH/ATT/ORD) to HTTP status codes, toast types, and the bilingual message envelope.
7. **Session management** — cookie TTLs, refresh behavior, logout, and the future session-listing surface.

### 1.2 What this plan does NOT cover

- **Module-specific authorization rules** (e.g., "a supervisor can approve expenses up to 5000 SAR"). Those land in Phase 3+ with each module's CRUD. This plan only establishes the `can(module, action)` primitive and the permission catalog plumbing.
- **The DB schema itself** — see `docs/phase-2-schema-plan.md`.
- **2FA enrollment UI** — the `require_2fa` setting and TOTP enrollment flow is flagged as an open question (section 11); this plan documents where 2FA verification hooks into the rate-limit and error taxonomy but does not specify the enrollment UX.
- **Social login** — explicitly forbidden by the master prompt. Only email/password + invite acceptance.
- **Public self-registration** — explicitly forbidden. New users arrive only via the invite flow (section 6).

### 1.3 Constraints re-stated

- This is a PLANNING DOCUMENT. Do NOT create files. Do NOT apply migrations. Do NOT touch production code.
- All code blocks below are ILLUSTRATIVE — they show the planned content of files that will be created/applied only after Phase 2 approval.
- ADR-014 Phase 2 gate and ADR-019 correction gate both require human approval before any of this lands.

---

## 2. Dependency: @supabase/ssr

### 2.1 Why a new dependency is required

The current Supabase wrappers in the repo are **dead and unsafe** (ADR-014, verified in Phase 0):

- `src/lib/supabase/client.ts` — uses bare `@supabase/supabase-js` with `persistSession: false` and `detectSessionInUrl: false`. This does NOT manage the auth session cookie. A Client Component calling this client has no access to the user's session — `supabase.auth.getUser()` always returns `null` on the server, and on the client it has no persisted session because persistence is disabled.
- `src/lib/supabase/server.ts` — uses bare `@supabase/supabase-js` AND reads the **wrong env name** (`SUPABASE_URL` instead of the env contract's `NEXT_PUBLIC_SUPABASE_URL`, per `docs/implementation-plan.md` Initial environment contract). It also uses the **service role key**, which bypasses RLS — appropriate for an admin client, NEVER appropriate for a request-scoped user client.
- `src/lib/supabase/middleware.ts` — never imported; Next.js ignores it. The active `src/middleware.ts` does only trivial redirects.

Net effect: **no Server Component, Server Action, or Route Handler can read the user's session today.** There is no auth. This is the gap Phase 2 closes.

### 2.2 What @supabase/ssr provides

`@supabase/ssr` is Supabase's official App Router integration package. It provides:

- `createBrowserClient(url, anonKey)` — a Client Component client that reads and writes the auth session cookie via the browser, compatible with `next/navigation` transitions.
- `createServerClient(url, anonKey, { cookies })` — a server-side client (Server Components, Server Actions, Route Handlers, middleware) that reads the session from Next.js cookies and refreshes the session by writing updated cookies back via the `setAll` handler.

Both helpers use the **anon key** (not the service role key) and respect RLS. The service-role client (section 3.3) is a separate, server-only concern that bypasses RLS deliberately.

### 2.3 Install command

To be run by the user (agents have no shell access):

```bash
pnpm add @supabase/ssr
```

### 2.4 Compatibility

- `@supabase/ssr` works alongside the already-installed `@supabase/supabase-js`. The admin client in section 3.3 continues to use `@supabase/supabase-js` directly (it does not need cookie handling).
- No changes to `tsconfig.json`, `next.config.ts`, or Tailwind config are required.
- The `@supabase/ssr` package is maintained by Supabase and tracks the same version line as `@supabase/supabase-js`.

### 2.5 Environment contract (re-stated from `docs/implementation-plan.md`)

The `.env.example` (to be created in Phase 2) must declare exactly these names:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
SENTRY_DSN=
```

Notes:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are exposed to the browser (the `NEXT_PUBLIC_` prefix). This is by design — the anon key is safe to expose; RLS is the enforcement layer.
- `SUPABASE_SERVICE_ROLE_KEY` is **server-only**. It MUST NOT be prefixed with `NEXT_PUBLIC_`. Any import of the admin client (section 3.3) in a Client Component is a build-time or runtime security failure. A lint rule (Phase 2 follow-up) should forbid `import ... from "@/lib/supabase/admin"` in files under `src/app` that are not marked `"use server"` or do not carry the Server Component contract.
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are used by the invite flow (section 6) and password-reset email delivery.

---

## 3. Supabase client setup (replace dead code per ADR-014)

This section specifies the planned content of three files. These are ILLUSTRATIVE — they are NOT created by this plan. They will be created during Phase 2 implementation after approval.

### 3.1 `src/lib/supabase/client.ts` (REWRITE — Client Component client)

Planned content:

```typescript
import { createBrowserClient } from "@supabase/ssr"

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

Notes:

- Replaces the existing dead `supabaseClient` export entirely. Any import of `supabaseClient` in the codebase (there are currently none — it is dead code) must be migrated to `createClient()`.
- Uses the anon key. Respects RLS.
- `createBrowserClient` handles cookie persistence in the browser, so `getUser()` returns the real session after login.
- Do NOT cache the client in a module-level singleton — Supabase recommends creating a fresh client per Server Component render to avoid cross-request session bleed.

### 3.2 `src/lib/supabase/server.ts` (REWRITE — Server Component / Server Action client)

Planned content:

```typescript
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — middleware handles refresh.
          }
        },
      },
    }
  )
}
```

Notes:

- `cookies()` is async in Next.js 16 (`await cookies()`). The current repo is on Next.js 16.1.1, so the `await` is required.
- The `setAll` `try/catch` is the documented Supabase pattern: when `createClient()` is called from a Server Component (read-only cookie access), `cookieStore.set` throws because Server Components cannot mutate cookies. That is expected — the middleware (section 4) performs the actual session refresh on every protected route. When `createClient()` is called from a Server Action or Route Handler, `setAll` succeeds and updates the session cookie in place.
- Uses the anon key. Respects RLS. This is the request-scoped user client — it should NEVER use the service role key.
- The function is `async` because `cookies()` is async. All callers must `await createClient()`.

### 3.3 `src/lib/supabase/admin.ts` (NEW — server-only service-role client)

Planned content:

```typescript
import { createClient } from "@supabase/supabase-js"

// Server-only. Bypasses RLS. NEVER import in client components.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
```

Notes:

- Uses `@supabase/supabase-js` directly (NOT `@supabase/ssr`). The admin client does not participate in cookie-based session management — it authenticates via the service role key, which bypasses RLS.
- `persistSession: false` is mandatory. The admin client must never write a session cookie.
- Authorized uses (exhaustive, to be enforced by review + lint):
  - Invite acceptance: `supabaseAdmin.auth.admin.createUser(...)` (section 6.5).
  - Invite expiry cron / scheduled job: marking expired invites.
  - Audit log writes that must succeed even if the actor's session has expired (rare; prefer writing audit via the user client).
  - User management in `/settings/users` where the GM's own session lacks the `manage users` permission at the RLS level (the RLS policy on `users` should still allow the GM to manage users; this admin path is a fallback, not the default).
  - Session listing in `/settings/security/sessions` (future — requires the Supabase admin API).
- **Forbidden uses**: any Client Component, any code path reachable from the browser, any code that operates on tenant-owned business data where the user's own RLS-bound client would suffice.

### 3.4 Files to DELETE (dead scaffolding per ADR-014)

The following files are dead code or unsafe stubs and are replaced by the implementations in this plan and in `docs/phase-2-schema-plan.md`. They will be deleted during Phase 2 implementation:

- `src/lib/supabase/middleware.ts` — dead (never imported; Next.js ignores it). Consolidated into the rewritten `src/middleware.ts` (section 4).
- `src/lib/services/auth.ts` — `getCurrentUser()` returns a hardcoded mock user (`admin@elite-dev.com`). Replaced by the server client's `getUser()` + a custom `users` table lookup (section 7).
- `src/lib/tenancy/tenant.ts` — `resolveTenant()` returns a hardcoded default tenant `elite-development`. Replaced by `get_my_tenant_id()` at the DB layer (schema plan) and the `getCurrentUser()` service (section 7) that resolves the tenant from the session.
- `src/lib/permissions/can.ts` — `can()` always returns `true`. Replaced by the real authorization service in section 7.

`src/lib/demo/*.ts` (static in-memory demo arrays) are NOT deleted in Phase 2 — they remain the data source for not-yet-migrated module pages until each module's phase replaces them. ADR-014 explicitly defers demo data removal to the phase that owns each area.

---

## 4. Middleware plan (narrowed matcher — M8/ADR-019)

### 4.1 Design intent

The M8 correction (v2.0 section 6.8) and ADR-019 require that Next.js middleware:

1. Runs ONLY on dashboard routes — never on static assets, public auth routes, or API routes that handle their own auth.
2. Reads the user's session from cookies via `@supabase/ssr`.
3. Redirects unauthenticated users to `/auth/sign-in` with a `returnTo` parameter.
4. Fetches the user's profile from the custom `users` table and enforces account-status checks (inactive, locked, must-change-password).
5. Enforces role-based access on `/settings/*` routes.
6. Refreshes the session cookie on every protected request (the `setAll` handler in `createServerClient`).

The current `src/middleware.ts` does NONE of this — it only redirects `/login` → `/auth/sign-in` and `/register` → `/auth/sign-up`, and its matcher is the catch-all `'/((?!api|_next/static|_next/image|favicon.ico).*)'` which runs on every non-excluded path including public auth routes (wasteful and incorrect).

### 4.2 Planned `src/middleware.ts` content

Illustrative — NOT applied by this plan:

```typescript
import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

// M8 / ADR-019: narrowed matcher — ONLY dashboard/module routes.
// See the `matcher` export at the bottom of this file.
// Excludes: /auth, /api, /_next, /favicon.ico, /login, /register, /landing, /.

type UserProfile = {
  id: string
  tenant_id: string
  role: string
  status: "active" | "inactive" | "locked"
  must_change_password: boolean
  locked_until: string | null
}

const SETTINGS_ROLE_GUARDS: Record<string, string[]> = {
  "/settings/users": ["general_manager"],
  "/settings/company": ["general_manager"],
  "/settings/security/policy": ["general_manager"],
  "/settings/compliance": ["general_manager"],
  "/settings/system": ["general_manager"],
  "/settings/audit": ["general_manager", "admin", "accountant"],
  "/settings/security/sessions": ["general_manager", "admin"],
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request })

  // 1. Create the SSR server client bound to this request's cookies.
  //    setAll writes refreshed session cookies back to the response.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // 2. Read the session. getUser() validates the JWT server-side.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const signInUrl = new URL("/auth/sign-in", request.url)
    signInUrl.searchParams.set("returnTo", request.nextUrl.pathname)
    return NextResponse.redirect(signInUrl)
  }

  // 3. Fetch the custom users row (tenant, role, status, lockout, password).
  const { data: profile } = await supabase
    .from("users")
    .select("id, tenant_id, role, status, must_change_password, locked_until")
    .eq("auth_user_id", user.id)
    .single<UserProfile>()

  if (!profile) {
    // Auth user exists but the custom users row does not — the sync trigger
    // (schema plan) should have created it. Treat as unauthenticated and
    // force sign-out to avoid a half-state.
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL("/auth/sign-in", request.url))
  }

  // 4. Account status checks.
  if (profile.status === "inactive") {
    await supabase.auth.signOut()
    const url = new URL("/auth/sign-in", request.url)
    url.searchParams.set("error", "AUTH_ACCOUNT_INACTIVE")
    return NextResponse.redirect(url)
  }

  if (
    profile.status === "locked" &&
    profile.locked_until &&
    new Date(profile.locked_until).getTime() > Date.now()
  ) {
    const url = new URL("/auth/sign-in", request.url)
    url.searchParams.set("error", "AUTH_ACCOUNT_LOCKED")
    return NextResponse.redirect(url)
  }

  // 5. Must-change-password gate.
  if (profile.must_change_password) {
    const pathname = request.nextUrl.pathname
    const allowed = "/settings/security"
    if (!pathname.startsWith(allowed)) {
      const url = new URL(allowed, request.url)
      url.searchParams.set("require", "change_password")
      return NextResponse.redirect(url)
    }
  }

  // 6. Role guards for /settings/* subroutes.
  const pathname = request.nextUrl.pathname
  for (const [prefix, allowedRoles] of Object.entries(SETTINGS_ROLE_GUARDS)) {
    if (pathname.startsWith(prefix)) {
      if (!allowedRoles.includes(profile.role)) {
        return NextResponse.rewrite(new URL("/errors/forbidden", request.url))
      }
      break
    }
  }

  // 7. Attach tenant + role headers for downstream Server Components.
  //    (Informational only — NOT a security boundary. RLS is the boundary.)
  response.headers.set("x-tenant-id", profile.tenant_id)
  response.headers.set("x-user-role", profile.role)

  return response
}

export const config = {
  // M8 / ADR-019: narrowed matcher. Only dashboard/module routes.
  // Static assets, /auth, /api, /landing, /login, /register, and / are excluded.
  matcher: [
    "/dashboard/:path*",
    "/drivers/:path*",
    "/vehicles/:path*",
    "/attendance/:path*",
    "/payroll/:path*",
    "/violations/:path*",
    "/expenses/:path*",
    "/maintenance/:path*",
    "/invoices/:path*",
    "/accounting/:path*",
    "/platforms/:path*",
    "/hr/:path*",
    "/templates/:path*",
    "/reports/:path*",
    "/users/:path*",
    "/roles/:path*",
    "/audit-log/:path*",
    "/security/:path*",
    "/settings/:path*",
    "/assignments/:path*",
  ],
}
```

### 4.3 Matcher — explicit inclusion list

The matcher above is an explicit allow-list of dashboard route prefixes. It does NOT use the negative-lookahead `'/((?!...).*)'` form because the M8 correction requires middleware to run ONLY on dashboard routes, not on "everything except a few exclusions." An explicit allow-list is safer: a new public route added later will NOT accidentally trigger the auth guard.

Matched routes (auth guard runs):

| Prefix | Module (1–18) |
| --- | --- |
| `/dashboard/:path*` | 12 (Dashboard) |
| `/drivers/:path*` | 1 |
| `/vehicles/:path*` | 2 |
| `/attendance/:path*` | 3 |
| `/payroll/:path*` | 4 |
| `/violations/:path*` | 5 |
| `/expenses/:path*` | 6 |
| `/maintenance/:path*` | 7 |
| `/invoices/:path*` | 8 |
| `/accounting/:path*` | 9 (reserved, disabled until its phase) |
| `/platforms/:path*` | 10 |
| `/hr/:path*` | 11 |
| `/templates/:path*` | 13 |
| `/reports/:path*` | 12 |
| `/users/:path*` | 14 |
| `/roles/:path*` | 15 |
| `/audit-log/:path*` | 16 |
| `/security/:path*` | 17 |
| `/settings/:path*` | 18 |
| `/assignments/:path*` | Operations cross-module |

Excluded routes (auth guard does NOT run):

- `/auth/*` — public auth UI (sign-in, accept-invite, forgot/reset-password). The sign-in Server Action performs its own auth; the guard would create a redirect loop.
- `/api/*` — Route Handlers handle their own auth (they call `createClient()` from `@/lib/supabase/server` and check the session inline).
- `/_next/*` — static assets. Middleware must NEVER run on these. This is the M8 correction's explicit requirement.
- `/favicon.ico` — static asset.
- `/login`, `/register` — legacy redirects. To preserve backward-compatible URLs, keep a tiny redirect for `/login` → `/auth/sign-in` and `/register` → `/auth/accept-invite` outside the matcher (in `next.config.ts` `redirects()` or a minimal root `page.tsx` redirect).
- `/landing` — public landing page.
- `/` — root redirects to `/landing` or `/dashboard` depending on session; handled outside the matcher.

### 4.4 Role guard matrix for `/settings/*`

The `SETTINGS_ROLE_GUARDS` map in section 4.2 encodes the v2.0 role requirements:

| Route prefix | Allowed roles |
| --- | --- |
| `/settings/users` | `general_manager` |
| `/settings/company` | `general_manager` |
| `/settings/security/policy` | `general_manager` |
| `/settings/compliance` | `general_manager` |
| `/settings/system` | `general_manager` |
| `/settings/audit` | `general_manager`, `admin`, `accountant` |
| `/settings/security/sessions` | `general_manager`, `admin` |

Other `/settings/*` subroutes (e.g., `/settings/account`, `/settings/appearance`, `/settings/notifications`) are user-scoped (the user edits their own profile/preferences) and do not require a role guard — any authenticated user may access them.

### 4.5 Important non-guarantees (defense in depth)

The middleware is the **first** check, not the only check. It MUST NOT be the security boundary:

- The `x-tenant-id` and `x-user-role` response headers are informational. They are trivially forgeable by a malicious client and MUST NOT be trusted by Server Components or Server Actions. Every Server Component / Server Action must re-derive the tenant and role from the session via `createClient()` (`@/lib/supabase/server`) and `getUser()`.
- RLS is the real tenant-isolation boundary (schema plan). Even if middleware is bypassed, RLS prevents cross-tenant reads/writes.
- The `can(module, action)` authorization service (section 7) is the real action-level boundary. Even if middleware allows a route, every Server Action must call `can()` before mutating.

### 4.6 Performance notes

- `getUser()` validates the JWT server-side by calling Supabase Auth. This adds one network round-trip per middleware invocation. Supabase caches the JWKS, so the validation is fast after the first request.
- The custom `users` table lookup adds a second round-trip. The composite index `users(auth_user_id)` (provisioned in the schema plan) makes this O(1).
- Total middleware latency budget: ~50–100 ms typical. Acceptable for an internal enterprise tool. If this becomes a bottleneck, a future optimization is to embed the role + tenant in a short-lived signed cookie set at login; out of scope for Phase 2.

---

## 5. Rate limiting strategy for Next.js

### 5.1 The discrepancy

The v2.0 master prompt (section 6.8 M8, and ADR-019) specifies rate limits via `slowapi`:

> Rate limiting. `slowapi`: login `10/min`, forgot-password `3/hour`, 2FA verify `5/min`, reports generate `10/hour`, orders import `30/hour`.

`slowapi` is a **FastAPI library**. This project is **Next.js-only** — there is no FastAPI backend. Supabase is the backend (Postgres, Auth, Storage, Edge Functions). There is no Python process to attach `slowapi` to.

ADR-019 adopts the rate-limit *requirements* (the limits themselves) but the *implementation* must be Next.js-native. This section documents the discrepancy and recommends an approach.

### 5.2 Required limits (from v2.0, unchanged)

| Endpoint / action | Limit | Window | Scope |
| --- | --- | --- | --- |
| Sign-in Server Action | 10 | minute | per IP |
| Forgot-password Server Action | 3 | hour | per IP |
| 2FA verify Server Action | 5 | minute | per IP |
| Reports generate (Server Action / Route Handler) | 10 | hour | per user |
| Orders import (Server Action) | 30 | hour | per user |

### 5.3 Recommended: Upstash Redis + sliding window

Upstash Redis is a serverless Redis with an HTTP API that works in Next.js Edge/Node runtimes without persistent connections. The `@upstash/ratelimit` package provides a sliding-window limiter that matches the v2.0 semantics.

Install (to be run by the user):

```bash
pnpm add @upstash/redis @upstash/ratelimit
```

Additional env vars (added to `.env.example`):

```env
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

Planned helper (`src/lib/auth/rate-limit.ts` — illustrative):

```typescript
import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import type { Duration } from "@upstash/ratelimit"

let limiterInstance: Ratelimit | null = null

function getLimiter() {
  if (limiterInstance) return limiterInstance
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null // dev fallback
  }
  limiterInstance = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow,
    prefix: "elitedev",
    analytics: true,
  })
  return limiterInstance
}

export async function rateLimit(
  identifier: string,
  limit: number,
  window: Duration,
  scope: string
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const limiter = getLimiter()
  if (!limiter) {
    // Dev fallback — no Redis configured. Allow all.
    return { success: true, remaining: limit, reset: 0 }
  }
  return limiter.limit(`${scope}:${identifier}`, limit, window)
}
```

Usage in a Server Action (illustrative):

```typescript
"use server"
import { rateLimit } from "@/lib/auth/rate-limit"
import { headers } from "next/headers"
import { AppError } from "@/lib/errors"

export async function signInAction(email: string, password: string) {
  const h = await headers()
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  const { success } = await rateLimit(ip, 10, "1 m", "signin")
  if (!success) {
    throw new AppError(
      "AUTH_RATE_LIMITED",
      429,
      "محاولات كثيرة. حاول مرة أخرى بعد دقيقة.",
      "Too many attempts. Try again in a minute."
    )
  }
  // ... proceed with sign-in
}
```

### 5.4 Alternative: in-memory Map-based limiter (dev only)

For local development without Upstash, a simple in-memory limiter works but has two caveats: it does not survive process restarts, and it is per-instance (so it does not work correctly across multiple serverless instances in production). Suitable for `pnpm dev` only.

```typescript
const buckets = new Map<string, { count: number; reset: number }>()

export async function rateLimitInMemory(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ success: boolean; remaining: number }> {
  const now = Date.now()
  const entry = buckets.get(key)
  if (!entry || entry.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs })
    return { success: true, remaining: limit - 1 }
  }
  entry.count++
  if (entry.count > limit) {
    return { success: false, remaining: 0 }
  }
  return { success: true, remaining: limit - entry.count }
}
```

The `rateLimit` helper in section 5.3 falls back to "allow all" when Redis env vars are absent. A stricter dev fallback could call `rateLimitInMemory` instead. Decision deferred to implementation.

### 5.5 Alternative: Supabase Edge Functions

Rate limiting could also be enforced in a Supabase Edge Function that wraps the auth endpoints. This avoids adding Upstash as a dependency but:

- Requires every sign-in / forgot-password call to route through the Edge Function instead of calling `supabase.auth.signInWithPassword` directly from the Server Action. This is a meaningful refactor of the auth flow.
- Edge Functions have their own cold-start cost and execution limits.
- Supabase does not currently provide a built-in rate limiter; the Edge Function would still need a backing store (Upstash Redis or a Postgres counter table).

### 5.6 Decision needed

Three options:

1. **Upstash Redis (recommended)** — adds two dependencies (`@upstash/redis`, `@upstash/ratelimit`) and two env vars. Cost is ~$0.20 per 100k requests on the free-then-pay tier; free tier covers 10k commands/day. Works in both Node and Edge runtimes. Survives restarts. Works across serverless instances.
2. **In-memory (dev only)** — no dependencies, no cost, but only correct for a single long-lived server process. Production deployments on Vercel/multi-instance would under-count.
3. **Supabase Edge Functions** — no new external dependency, but requires refactoring auth to route through the Edge Function and still needs a backing store.

**Flagged for user approval in section 11.**

### 5.7 Where rate limiting is enforced

Rate limiting is enforced at the **Server Action / Route Handler entry point**, NOT in middleware. Reasons:

- Middleware runs on every navigation; rate-limiting navigations is not the intent (the v2.0 limits are for *actions*, not page loads).
- The scope differs: sign-in is per-IP, reports-generate is per-user. Middleware has the IP but determining the user requires the session lookup (already done) — however, reports-generate is a POST to a Route Handler, not a navigation, so it does not always go through middleware.
- Server Actions are the natural choke point for "a user is attempting an action."

Every protected Server Action / Route Handler that performs a rate-limited action MUST call `rateLimit(...)` as its first statement after resolving the identifier (IP or user ID).

---

## 6. Invite architecture

### 6.1 Overview

The platform has **no public self-registration** (master prompt). New users arrive exclusively via an invite issued by a General Manager (GM). The invite flow:

1. GM opens `/settings/users`, clicks "Invite User".
2. Invite dialog collects email + role (from the 9 system roles) + optional message.
3. Server Action `createInvite` creates an `invites` row with a hashed token and sends an email.
4. Recipient clicks the link → `/auth/accept-invite?token=...&tid=...`.
5. Server Action `acceptInvite` validates the token, creates the auth.users entry + custom users row + tenant_memberships row, marks the invite accepted, writes audit log.
6. Recipient is redirected to `/auth/sign-in` with a success toast.

### 6.2 The 9 system roles

Per the schema plan seed data, the 9 roles are:

| Role key | Label (EN / AR) | Notes |
| --- | --- | --- |
| `general_manager` | General Manager / مدير عام | Full access; bypasses `can()` checks. |
| `admin` | Administrator / مدير | Broad operational access; no company/settings policy changes. |
| `accountant` | Accountant / محاسب | Finance, payroll, invoices, audit log read. |
| `operations_manager` | Operations Manager / مدير العمليات | Drivers, vehicles, assignments, attendance. |
| `dispatcher` | Dispatcher / منسق | Daily orders, platforms, assignments. |
| `hr_officer` | HR Officer / مسؤول الموارد البشرية | HR, contracts, documents. |
| `supervisor` | Supervisor / مشرف | Read-mostly operational access. |
| `compliance_officer` | Compliance Officer / مسؤول الامتثال | Violations, audit, compliance settings read. |
| `driver` | Driver / سائق | Driver-facing app (future). |

The `driver` role is reserved for a future driver-facing surface; in Phase 2 it is seeded but not assignable via the invite UI (drivers are created via the Drivers module in Phase 3, not via `/settings/users`).

### 6.3 `createInvite(email, role, message?)` Server Action

Planned behavior:

1. **Authorize**: call `can("users", "manage")`. If denied → throw `AuthorizationError` with `ERR_AUTH007` (insufficient role). Only GM passes (the `SETTINGS_ROLE_GUARDS` for `/settings/users` already restricts the route to `general_manager`, but the Server Action re-checks per section 4.5).
2. **Rate limit**: `rateLimit(gmUserId, 20, "1 h", "invite_create")` — a GM may send at most 20 invites per hour. Not in the v2.0 spec but a sensible abuse guard. Decision needed (section 11).
3. **Validate input**: email format (Zod), role must be one of the 9 (excluding `driver` per section 6.2), message length ≤ 500 chars.
4. **Check for existing pending invite**: query `invites` where `email = $1 AND status = 'pending' AND expires_at > now()`. If found, return a soft error ("An invite is already pending for this email"). Since the actor is the GM, a clear duplicate error is appropriate.
5. **Check for existing user**: query `users` where `email = $1`. If found, return an error ("A user with this email already exists"). Offer to deactivate/reactivate instead.
6. **Generate token**: `const token = crypto.randomUUID()` (UUID v4, 122 bits of entropy).
7. **Hash token**: `const tokenHash = await bcrypt.hash(token, 10)`. Store ONLY the hash in `invites.token_hash`. The plaintext token never touches the DB.
8. **Generate token_id** (for O(1) lookup — see section 6.7): `const tokenId = crypto.randomUUID()`. Store `invites.token_id` alongside `token_hash`.
9. **Insert invite row**:
   - `id` (gen_random_uuid)
   - `tenant_id` = GM's tenant
   - `email`
   - `role`
   - `token_id`
   - `token_hash`
   - `status = 'pending'`
   - `expires_at = now() + interval '7 days'`
   - `created_by = GM's user id`
   - `message` (optional)
10. **Send email via Resend**:
    - Link: `${process.env.NEXT_PUBLIC_APP_URL}/auth/accept-invite?token=${token}&tid=${tokenId}`
    - The email is bilingual (subject and body in both EN and AR per Design DNA).
    - From: `RESEND_FROM_EMAIL`.
    - If Resend fails, the invite row remains `pending` (the GM can resend from `/settings/users`).
11. **Write audit log**: `audit_log` row with `module = 'users'`, `action = 'invite_created'`, `entity_id = invite.id`, `metadata = { email, role }`.
12. **Return**: `{ inviteId, status: 'pending' }`. The UI shows a success toast.

### 6.4 Accept-invite page (`/auth/accept-invite`)

The page is a public route (NOT in the middleware matcher). It renders:

- A form with: full name, new password, confirm password.
- The `token` and `tid` (token_id) come from the URL query string.
- On submit, calls `acceptInvite(token, tid, fullName, password)`.

UI: reuses the Phase 1 sign-up design (per the Phase 1 file plan: "REPURPOSE `sign-up*` into `accept-invite`"). Split-screen shell, bilingual, no social login.

### 6.5 `acceptInvite(token, tid, fullName, password)` Server Action

Planned behavior:

1. **Rate limit**: `rateLimit(ip, 10, "1 m", "accept_invite")` — per IP, to slow invite-brute-force attempts.
2. **Lookup invite by token_id** (O(1)): `SELECT * FROM invites WHERE token_id = $1 AND status = 'pending' AND expires_at > now()`. If not found → return a generic error ("Invite not found or expired") that does NOT distinguish between "token_id wrong", "already accepted", and "expired" (anti-enumeration).
3. **Verify token hash**: `const match = await bcrypt.compare(token, invite.token_hash)`. If no match → same generic error. Optionally increment a per-invite failed-attempt counter and lock the invite after 5 failures (defense against online brute force; bcrypt is slow so this is belt-and-suspenders).
4. **Validate password**: Zod schema enforcing the security policy from `system_settings` (`security.password_min_length`, `security.password_require_uppercase`, etc.).
5. **Create auth.users entry** (admin client, bypasses RLS):

   ```typescript
   const admin = createAdminClient()
   const { data: authUser, error } = await admin.auth.admin.createUser({
     email: invite.email,
     password,
     email_confirm: true, // invite flow confirms the email by construction
     user_metadata: { full_name: fullName },
   })
   if (error) throw new AppError("AUTH_INVITE_CREATE_FAILED", 500, ...)
   ```

6. **Create custom `users` row** (admin client, because the new user has no session yet and the GM's session is not in scope here):
   - `auth_user_id = authUser.id`
   - `tenant_id = invite.tenant_id`
   - `email = invite.email`
   - `full_name = fullName`
   - `role = invite.role`
   - `status = 'active'`
   - `must_change_password = false` (they just set it)
   - `password_changed_at = now()`
7. **Create `tenant_memberships` row**: `user_id = newUser.id`, `tenant_id = invite.tenant_id`, `role = invite.role`.
8. **Update invite**: `status = 'accepted'`, `accepted_at = now()`, `accepted_by = newUser.id`.
9. **Write audit log**: `module = 'users'`, `action = 'invite_accepted'`, `entity_id = newUser.id`, `actor_user_id = newUser.id` (the new user is the actor of their own acceptance).
10. **Redirect**: to `/auth/sign-in?invite_accepted=1`. The sign-in page shows a success toast ("Your account is ready. Please sign in." / "تم إنشاء حسابك. يرجى تسجيل الدخول.").

All of steps 5–9 should run in a single Postgres transaction where possible. The admin client does not provide transaction semantics across `auth.admin.createUser` and the `users` insert, so step 5 is outside the transaction; if step 6 fails, a compensating `admin.auth.admin.deleteUser(authUser.id)` must run to avoid orphaned auth.users entries. This is a known friction point; document it in the worklog when implemented.

### 6.6 Expiry handling

Expired invites (`expires_at < now() AND status = 'pending'`) should be marked `status = 'expired'` daily. Two options:

- **pg_cron** (preferred): a daily Postgres job `UPDATE invites SET status = 'expired' WHERE status = 'pending' AND expires_at < now()`. Requires `pg_cron` to be enabled on the Supabase project.
- **Supabase Edge Function + scheduled trigger**: a daily Edge Function that runs the same UPDATE. Does not require `pg_cron`.

Decision deferred (section 11). Both are documented in the schema plan's "forward-looking" section.

### 6.7 Token storage tradeoff: hash-only vs token_id + hash

Two storage strategies:

1. **Hash-only**: store `token_hash` only. Lookup requires comparing the submitted token against every pending invite's hash (bcrypt.compare is O(1) per compare, but you must iterate over all pending invites for the given email, or all pending invites globally — O(n) total). With a small N (say <1000 pending invites at any time), this is acceptable but wasteful (bcrypt is intentionally slow — ~100ms per compare).
2. **token_id + hash** (recommended): store a `token_id` (UUID, not secret) alongside the `token_hash`. The invite link contains both `tid` and `token`. Lookup is `SELECT ... WHERE token_id = $1` (O(1) index hit), then a single `bcrypt.compare(token, hash)`. The `token_id` being sequential or even leaked does NOT compromise the invite — the `token` (the secret) is still required to pass the bcrypt check.

**Recommendation**: token_id + hash with a UUID token_id (not sequential). This gives O(1) lookup and does not weaken security (the `token_id` is public; the `token` is the secret). The marginal cost is one extra UUID column and one extra query param in the invite link.

**Tradeoff note**: if the `token_id` is leaked (e.g., via a referrer header on the accept-invite page), an attacker still cannot accept the invite without the `token`. The `token` should NEVER appear in a referrer-leakable position — the accept-invite page must be a full page load (not an SPA navigation) so the `token` is consumed by the Server Action and not retained in the URL after submission.

### 6.8 Token security summary

- **Generation**: `crypto.randomUUID()` — UUID v4, 122 bits of entropy.
- **Storage**: bcrypt-hashed (cost factor 10) at rest. Plaintext token never persisted.
- **Transmission**: HTTPS only (enforced by deployment). Token in URL query string on the accept-invite page only.
- **Single use**: status transitions `pending` → `accepted` (or `expired` / `revoked`) prevent replay.
- **Expiry**: 7 days from creation.
- **Comparison**: `bcrypt.compare(token, hash)` is timing-safe (bcrypt's compare is constant-time for equal-length inputs).
- **Revocation**: GM can revoke a pending invite from `/settings/users` (sets `status = 'revoked'`). The accept-invite Server Action rejects revoked invites with the same generic error.

---

## 7. Authorization service boundary

### 7.1 Replacing the stub

ADR-014 flags `src/lib/permissions/can.ts` as a stub that always returns `true`. This section specifies the real authorization service that replaces it. The stub is deleted per section 3.4; its call sites are migrated to the new `can()` / `authorize()` functions defined below.

### 7.2 Planned `src/lib/auth/authorization.ts`

Illustrative content:

```typescript
import { createClient } from "@/lib/supabase/server"
import { cache } from "react"

export type PermissionAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "export"
  | "print"
  | "manage"

export type PermissionCheck = {
  allowed: boolean
  reason?: string
}

/**
 * Server-side authorization check.
 *
 * @param module  one of the 18 module keys (e.g., "drivers", "payroll", "users")
 * @param action  one of the PermissionAction values
 * @returns { allowed, reason } — never throws on denial; throws only on infra errors
 *
 * UI hiding is NOT authorization. Every Server Action / Route Handler MUST
 * call can() before proceeding. The middleware route guard is a first-line
 * filter only; RLS is the data boundary.
 */
export const can = cache(
  async (module: string, action: PermissionAction): Promise<PermissionCheck> => {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { allowed: false, reason: "AUTH_NO_SESSION" }
    }

    // Fetch the user's role from the custom users table.
    const { data: profile, error } = await supabase
      .from("users")
      .select("role, status")
      .eq("auth_user_id", user.id)
      .single()

    if (error || !profile) {
      return { allowed: false, reason: "AUTH_NO_PROFILE" }
    }
    if (profile.status !== "active") {
      return { allowed: false, reason: "AUTH_INACTIVE" }
    }

    // general_manager bypasses all permission checks.
    if (profile.role === "general_manager") {
      return { allowed: true }
    }

    // Check the role_permissions + permissions join.
    const { data: granted } = await supabase
      .from("role_permissions")
      .select("permission:permissions(module, action)")
      .eq("role", profile.role)
      .eq("permission.module", module)
      .eq("permission.action", action)
      .limit(1)

    if (granted && granted.length > 0) {
      return { allowed: true }
    }

    return { allowed: false, reason: "AUTH_FORBIDDEN" }
  }
)

export class AuthorizationError extends Error {
  constructor(
    public code: string,
    public module: string,
    public action: PermissionAction
  ) {
    super(`${code}: ${module}.${action}`)
    this.name = "AuthorizationError"
  }
}

/**
 * Convenience wrapper that throws on denial. Use in Server Actions / Route
 * Handlers where denial should abort the request with a 403.
 */
export async function authorize(
  module: string,
  action: PermissionAction
): Promise<void> {
  const check = await can(module, action)
  if (!check.allowed) {
    throw new AuthorizationError(
      check.reason ?? "AUTH_FORBIDDEN",
      module,
      action
    )
  }
}
```

### 7.3 Permission check flow (sequence)

Text-form sequence diagram:

```
Server Action / Route Handler
  |
  |-- authorize("payroll", "approve")  (or can("payroll", "approve"))
  v
can(module, action)
  |
  |-- createClient() (server SSR client, reads session cookie)
  |-- supabase.auth.getUser()
  |     |
  |     v
  |   Supabase Auth (validates JWT)
  |     |
  |     v (returns user or null)
  |
  |-- if no user -> return { allowed: false, reason: "AUTH_NO_SESSION" }
  |
  |-- supabase.from("users").select("role, status").eq("auth_user_id", user.id).single()
  |     |
  |     v
  |   Postgres (RLS ensures only the user's own row is visible)
  |     |
  |     v (returns profile or error)
  |
  |-- if no profile or status != "active" -> return { allowed: false, ... }
  |
  |-- if role == "general_manager" -> return { allowed: true }  // bypass
  |
  |-- supabase.from("role_permissions").select(...).eq("role", profile.role)...
  |     |
  |     v
  |   Postgres (RLS: any authenticated user can read role_permissions)
  |     |
  |     v (returns matching permission rows)
  |
  |-- if rows.length > 0 -> return { allowed: true }
  |-- else -> return { allowed: false, reason: "AUTH_FORBIDDEN" }
  v
Server Action / Route Handler
  |
  |-- if allowed -> proceed with mutation (RLS enforces tenant isolation)
  |-- if denied -> throw AuthorizationError -> global error handler -> 403 JSON
```

### 7.4 Caching

Permission checks happen many times per request (a single dashboard page may issue 5–10 `can()` calls for UI conditional rendering). To avoid 5–10 round-trips per request:

- **Per-request cache**: `React.cache()` (used in section 7.2) deduplicates identical calls within a single React server render pass. `can("payroll", "approve")` called 3 times in one request issues ONE Postgres query.
- **Cross-request cache**: NOT recommended. Permissions can change at any time (GM updates a role's permissions); a cross-request cache would need invalidation. The per-request cache is sufficient; the cost is one query per (module, action) pair per request, which is acceptable.
- **Client-side cache**: the client may receive a "permissions snapshot" for UI hiding (e.g., to decide whether to render the "Delete" button). This snapshot is for UX only — every Server Action re-checks `can()` server-side. The client snapshot MUST NOT be trusted as an authorization decision.

### 7.5 The `general_manager` bypass

The `general_manager` role has all permissions by convention (the seed in the schema plan assigns every permission to `general_manager`). The `can()` function short-circuits and returns `{ allowed: true }` for GM without querying `role_permissions`. This is a performance optimization and a correctness guarantee: a GM can never be accidentally locked out by a missing permission row.

The bypass is implemented in application code (section 7.2), NOT in RLS. RLS still applies to GM at the data layer — a GM in tenant A cannot read tenant B's data even though `can()` returns `true`. The RLS `get_my_tenant_id()` helper (schema plan) enforces tenant isolation for every role, including GM.

### 7.6 Server-side only

`can()` and `authorize()` are server-side only. They depend on `@/lib/supabase/server` which uses `next/headers` — this module throws if imported into a Client Component. UI hiding in Client Components uses a permissions snapshot passed down from the Server Component; the snapshot is advisory only.

---

## 8. Error code taxonomy mapping

### 8.1 The bilingual error envelope

v2.0 section 5.2 mandates that every API error return a bilingual envelope:

```json
{ "code": "ERR_XXX", "message_ar": "...", "message_en": "..." }
```

The `code` is one of the `ERR_<PREFIX><NNN>` codes from the v2.0 taxonomy. The `message_ar` and `message_en` fields are user-facing localized messages. The envelope is the same for Server Action thrown errors (caught and serialized to the client) and Route Handler responses (returned as JSON).

### 8.2 The `AppError` class

Planned `src/lib/errors.ts` (illustrative):

```typescript
export class AppError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    public messageAr: string,
    public messageEn: string
  ) {
    super(messageEn)
    this.name = "AppError"
  }

  toJSON() {
    return {
      code: this.code,
      message_ar: this.messageAr,
      message_en: this.messageEn,
    }
  }
}
```

`AppError` is the single error type thrown by Server Actions and Route Handlers. The global error handler (section 8.4) converts it to the JSON envelope. Any non-`AppError` thrown is treated as `ERR_INTERNAL` (500) and the original message is NOT exposed to the client.

### 8.3 Error code → HTTP → toast mapping table

The v2.0 error code prefixes map to HTTP status codes and toast types as follows. Module-specific codes (DRV/PAY/VIO/VEH/ATT/ORD) are included here for completeness; only AUTH codes are triggered by Phase 2 flows. The others are reserved for Phase 3+ and documented here so the envelope shape is fixed now.

| Code | HTTP | Toast type | message_ar | message_en | Triggered by |
| --- | --- | --- | --- | --- | --- |
| `AUTH001` | 423 | error | الحساب مقفل. حاول مرة أخرى بعد {minutes} دقيقة. | Account locked. Try again in {minutes} min. | 6 failed sign-ins → account locked for 15 min (section 10.6) |
| `AUTH002` | 401 | error | رمز التحقق الثنائي غير صحيح. | Invalid 2FA code. | 2FA verify step with wrong TOTP code |
| `AUTH003` | 401 | warning | انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى. | Session expired. Please sign in again. | JWT expired / refresh failed |
| `AUTH004` | 401 | error | البريد الإلكتروني أو كلمة المرور غير صحيحة. | Invalid email or password. | Sign-in with wrong credentials |
| `AUTH005` | 302 | info | يرجى تغيير كلمة المرور الخاصة بك. | Please change your password. | `must_change_password = true` → redirect to `/settings/security` |
| `AUTH006` | 401 | warning | مطلوب التحقق الثنائي. | 2FA verification required. | `require_2fa = true` and user has TOTP enrolled |
| `AUTH007` | 403 | error | ليس لديك صلاحية للقيام بهذا الإجراء. | You do not have permission to perform this action. | `can(module, action)` returned `false` (AuthorizationError) |
| `AUTH_RATE_LIMITED` | 429 | warning | محاولات كثيرة. حاول مرة أخرى لاحقاً. | Too many attempts. Try again later. | `rateLimit()` returned `success: false` |
| `AUTH_ACCOUNT_INACTIVE` | 403 | error | تم تعطيل هذا الحساب. تواصل مع المدير. | This account is disabled. Contact your manager. | Middleware found `status = 'inactive'` |
| `AUTH_ACCOUNT_LOCKED` | 423 | error | تم قفل الحساب مؤقتاً. حاول لاحقاً. | Account temporarily locked. Try later. | Middleware found `status = 'locked'` with `locked_until` in future |
| `AUTH_INVITE_CREATE_FAILED` | 500 | error | فشل إنشاء حساب المستخدم. | Failed to create the user account. | `admin.auth.admin.createUser` returned error in acceptInvite |
| `DRV001` | 404 | error | السائق غير موجود. | Driver not found. | Phase 3+ |
| `DRV002` | 422 | error | رقم الإقامة غير صالح. | Invalid Iqama number. | Phase 3+ |
| `PAY001` | 409 | error | لم يتم قفل فترة الحضور بعد. | Attendance period not locked. | Phase 5 |
| `PAY002` | 422 | error | قيمة الراتب غير صالحة. | Invalid salary value. | Phase 5 |
| `VIO001` | 404 | error | المخالفة غير موجودة. | Violation not found. | Phase 4 |
| `VIO002` | 409 | error | نافذة الاعتراض منتهية. | Dispute window closed. | Phase 4 |
| `VEH001` | 404 | error | المركبة غير موجودة. | Vehicle not found. | Phase 3+ |
| `VEH003` | 422 | error | تراجع في قراءة العداد غير مسموح. | Odometer regression not allowed. | Phase 3+ (odometer fraud trigger) |
| `ATT001` | 409 | error | تم قفل سجل الحضور. | Attendance record locked. | Phase 4 |
| `ATT002` | 422 | error | تكرار في سجل الحضور. | Duplicate attendance record. | Phase 4 |
| `ORD001` | 404 | error | الجلسة غير موجودة. | Session not found. | Phase 4 (daily_order_entries) |
| `ERR_INTERNAL` | 500 | error | حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى. | An unexpected error occurred. Please try again. | Catch-all for non-`AppError` thrown errors |

Notes:

- `AUTH001` (account locked) uses HTTP 423 (Locked) — semantically more correct than 429. Some clients/proxies do not recognize 423; if that becomes an issue, fall back to 429.
- `AUTH005` (must change password) uses HTTP 302 because it triggers a redirect, not an error response per se. The toast is informational ("info" type), not an error.
- `AUTH_RATE_LIMITED` and the v2.0 `429` codes use HTTP 429 with a `Retry-After` header where applicable.
- `AUTH003` (session expired) surfaces as a redirect to `/auth/sign-in` with a `session_expired=1` query param; the HTTP status is 401 only when returned as JSON from a Route Handler (fetch calls), not from a navigation (which redirects).

### 8.4 Global error handler

Planned `src/app/api/_error-handler.ts` (illustrative — wraps Route Handlers):

```typescript
import { NextResponse } from "next/server"
import { AppError } from "@/lib/errors"

export async function withErrorHandler<T>(
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    return await handler()
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(err.toJSON(), { status: err.statusCode })
    }
    // Unknown error — log to Sentry, return generic.
    console.error("Unhandled error", err)
    return NextResponse.json(
      {
        code: "ERR_INTERNAL",
        message_ar: "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.",
        message_en: "An unexpected error occurred. Please try again.",
      },
      { status: 500 }
    )
  }
}
```

For Server Actions, the error handler is a try/catch in the Action's body that serializes the `AppError` to the form state (Next.js Server Actions return `formState` objects, not HTTP responses). The client reads `formState.error` and triggers a Sonner toast:

```typescript
// In the Client Component handling the Server Action result
import { toast } from "sonner"

if (formState?.error) {
  const { code, message_ar, message_en } = formState.error
  const locale = useAppStore.getState().language
  toast.error(locale === "ar" ? message_ar : message_en)
}
```

The Sonner toast respects the locale from the client store (`useAppStore` language field, per ADR-013). The bilingual message is delivered in the envelope so the client chooses which to display without a second round-trip.

---

## 9. Session management

### 9.1 Cookie-based sessions

Sessions are cookie-based via `@supabase/ssr`. The auth session is stored in two cookies set by Supabase:

- `sb-<project-ref>-auth-token` — the access + refresh token (encrypted/signed by Supabase).
- `sb-<project-ref>-auth-token-code-verifier` — the PKCE code verifier (during the OAuth flow; less relevant for email/password auth, but present).

These cookies are HTTP-only, Secure (in production), and SameSite=Lax. The `@supabase/ssr` `createBrowserClient` and `createServerClient` handle reading/writing them transparently.

### 9.2 Token TTLs

Token TTLs are driven by `system_settings` (schema plan) so the GM can tune them without a code change:

| Setting key | Default | Notes |
| --- | --- | --- |
| `security.session_access_token_hours` | 1 | Supabase access token TTL. After this, the refresh token is used to get a new access token. |
| `security.session_refresh_token_days` | 30 | Refresh token TTL. After this, the user must sign in again. |

Notes:

- The defaults above are the Supabase Auth defaults. Changing them in `system_settings` does NOT automatically change Supabase Auth's JWT TTL — Supabase Auth's TTL is configured in the Supabase dashboard. The `system_settings` values document the intent and are read by any future "session policy" UI; they do not override Supabase Auth directly. This is a known limitation; flagging it in the worklog.
- For Phase 2, the defaults are accepted as-is. Customization is a future setting (after Phase 7 hardening).

### 9.3 Refresh behavior

The middleware (section 4.2) refreshes the session on every protected route request via the `setAll` cookie handler in `createServerClient`. When the access token is about to expire (or has expired), Supabase's SSR client automatically uses the refresh token to obtain a new access token and writes the updated cookie back to the response. This is transparent to the user — they stay signed in until the refresh token expires (30 days).

If the refresh token has expired (or been revoked server-side), `getUser()` returns `null` and the middleware redirects to `/auth/sign-in` with `AUTH003` (session expired).

### 9.4 Logout

Logout is a Server Action:

```typescript
"use server"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/auth/sign-in")
}
```

`supabase.auth.signOut()` clears the session cookies (the SSR client writes expired cookies back via `setAll`). The redirect sends the user to the sign-in page. There is no `returnTo` on logout — the user is always sent to the sign-in page.

### 9.5 Session listing (future)

The `/settings/security/sessions` page (guarded to `general_manager` + `admin` per section 4.4) is a future surface that lists active sessions for the signed-in user (and, for GM, potentially for other users). Supabase Auth does not currently expose a per-user "active sessions" API; the admin API lists all users but not their sessions. Options:

- Supabase may add a sessions API in the future — track and adopt when available.
- A custom `sessions` table that logs sign-in events (IP, user-agent, timestamp) and is cleared on sign-out. This is a Phase 2 stretch goal; not required for the acceptance criteria.

Phase 2 acceptance criteria do NOT require the sessions page to be functional. The route exists (guarded), the page renders a "coming soon" placeholder, and the real implementation lands in a later phase.

### 9.6 Concurrency / single-session policy

v2.0 does not mandate single-session enforcement (only one active session per user). If a business requirement for single-session emerges, it would be implemented by revoking other refresh tokens on sign-in (via the Supabase admin API). Out of scope for Phase 2.

---

## 10. Test plan

This section documents the tests that MUST pass before Phase 2 is considered complete. The project has no test framework configured (Phase 0 finding); Phase 2 should introduce `vitest` for unit/integration tests and use documented SQL tests for RLS (the schema plan documents these). ADR-014 Phase 2 acceptance criteria require "Critical auth/role flows have tests or documented SQL tests."

### 10.1 Auth flow test

```
GIVEN a seeded GM user (from the schema plan seed)
WHEN the GM signs in via /auth/sign-in with valid credentials
THEN a session cookie is set (sb-*-auth-token)
AND the next request to /dashboard returns 200 (not a redirect)
AND the middleware attaches x-tenant-id and x-user-role headers

WHEN the GM signs out
THEN the session cookie is cleared
AND the next request to /dashboard redirects to /auth/sign-in?returnTo=/dashboard
```

### 10.2 Invite flow test

```
GIVEN a signed-in GM
WHEN the GM calls createInvite("newuser@example.com", "accountant")
THEN an invites row exists with status='pending' and expires_at = now() + 7 days
AND the token_hash is non-empty (and the plaintext token is NOT in the DB)
AND an email is sent via Resend (mocked in test)
AND an audit_log row is written (module='users', action='invite_created')

GIVEN the recipient has the invite link (token + tid)
WHEN the recipient calls acceptInvite(token, tid, "New User", "StrongPass1!")
THEN a row exists in auth.users with email_confirm=true
AND a row exists in the custom users table with role='accountant', status='active'
AND a row exists in tenant_memberships
AND the invite row has status='accepted', accepted_at=now(), accepted_by=new user id
AND an audit_log row is written (action='invite_accepted')
AND the user can sign in with the new credentials

WHEN acceptInvite is called with a wrong token (correct tid)
THEN a generic "Invite not found or expired" error is returned
AND no auth.users row is created
AND no users row is created
```

### 10.3 RLS isolation test (SQL)

Documented in the schema plan; re-stated here for the test plan:

```
GIVEN two users: userA in tenantA, userB in tenantB
WHEN userA queries SELECT * FROM users
THEN only tenantA's users are returned (tenantB's rows are filtered out)
AND a direct INSERT INTO users (tenant_id, ...) with tenant_id=tenantB fails
    with the RLS WITH CHECK violation (get_my_tenant_id() != tenantB)
```

This is the M8 / ADR-019 RLS INSERT WITH CHECK correction. The SQL test runs as part of the schema plan's test suite; the application layer does not re-test this (it's the DB's job).

### 10.4 Rate limit test

```
GIVEN the rate limiter is configured (Upstash Redis or in-memory fallback)
WHEN 11 sign-in attempts are made from the same IP within 1 minute
THEN the 11th attempt returns AUTH_RATE_LIMITED (HTTP 429)
AND the first 10 attempts proceed to the normal sign-in flow (which may itself
    return AUTH004 for wrong credentials — the rate limiter does not short-circuit
    credential validation)

GIVEN 11 reports-generate attempts by the same user within 1 hour
THEN the 11th returns AUTH_RATE_LIMITED
```

### 10.5 Permission denial test

```
GIVEN a signed-in supervisor (role='supervisor')
WHEN the supervisor calls deleteUser(userId) Server Action
THEN can("users", "delete") returns { allowed: false }
AND authorize() throws AuthorizationError with code="AUTH_FORBIDDEN"
AND the Server Action returns HTTP 403 with the bilingual envelope
AND the client shows a Sonner error toast with the localized message
AND no users row is deleted
```

### 10.6 Account lockout test

```
GIVEN a seeded user with status='active'
WHEN 6 sign-in attempts are made with wrong credentials within a short window
THEN the 6th failure sets users.status='locked' and users.locked_until=now()+15min
AND the 7th attempt (even with correct credentials) returns AUTH001 (account locked)
AND the middleware redirects to /auth/sign-in?error=AUTH_ACCOUNT_LOCKED

GIVEN 15 minutes have passed (locked_until < now())
WHEN the user signs in with correct credentials
THEN the sign-in succeeds
AND users.status is reset to 'active' and locked_until is cleared
```

The lockout counter and `locked_until` are implemented at the DB layer (the schema plan documents the `users.failed_login_attempts` column and a trigger or application logic that sets `locked_until`). The application-layer sign-in Server Action increments `failed_login_attempts` on `AUTH004` and resets it to 0 on successful sign-in.

### 10.7 Middleware narrowing test

```
GIVEN the narrowed matcher is active
WHEN a request hits /_next/static/chunk-123.js
THEN middleware does NOT run (no auth check, no session cookie read)

WHEN a request hits /auth/sign-in
THEN middleware does NOT run (no redirect loop)

WHEN a request hits /dashboard
THEN middleware runs (session check, profile fetch, role/tenant headers)
```

### 10.8 Lint and typecheck

Per the cross-phase validation checklist in `docs/implementation-plan.md`:

- `pnpm lint` passes with no errors (and no `any` in domain code per the Phase 0 finding).
- `pnpm typecheck` (or the repository's equivalent) passes.

These must pass before Phase 2 is marked complete.

---

## 11. Open questions for approval

The following decisions require human approval before Phase 2 implementation proceeds. Each is flagged with a recommendation but the final call belongs to the approving stakeholder.

### 11.1 Rate limiting approach

**Options:**

1. Upstash Redis (recommended) — adds `@upstash/redis` + `@upstash/ratelimit`, two env vars, ~$0.20/100k requests cost. Works across serverless instances. Survives restarts.
2. In-memory (dev only) — no deps, no cost, but only correct for a single long-lived server process. Not production-safe on multi-instance deployments.
3. Supabase Edge Functions — no new external dependency, but requires refactoring auth to route through the Edge Function and still needs a backing store (Redis or Postgres counter table).

**Recommendation:** Upstash Redis. The cost is negligible at the platform's scale, and the sliding-window semantics match the v2.0 limits exactly. Use the in-memory fallback for local `pnpm dev` only.

**Impact of decision:** Affects which dependencies are added and which env vars are documented in `.env.example`. Does NOT affect the limit values or where they are enforced (Server Actions).

### 11.2 Invite token storage

**Options:**

1. Hash-only — `invites.token_hash` only. Lookup is O(n) over pending invites per email. Acceptable for small N but wasteful (bcrypt is slow).
2. token_id + hash (recommended) — `invites.token_id` (UUID, public) + `invites.token_hash`. Lookup is O(1). The `token_id` being leaked does NOT compromise the invite (the `token` secret is still required).

**Recommendation:** token_id + hash with a UUID `token_id`. The tradeoff note in section 6.7 explains why leaking the `token_id` does not weaken security.

**Impact of decision:** Affects the `invites` table schema (one extra column) and the invite link format (one extra query param `tid`). Does NOT affect the token generation or hashing algorithm.

### 11.3 GM seed user creation

**Options:**

1. Via migration (known dev password) — the schema plan seed inserts a GM user with a known dev password (e.g., `ChangeMe123!`) and `must_change_password = true`. Simple, deterministic, works on first deploy. Risk: the dev password is in the migration history.
2. Via the invite flow (production-realistic) — the GM is created by inviting `gm@elite-dev.com` through the invite flow. More realistic but requires Resend to be configured before the first sign-in is possible. Chicken-and-egg: who invites the first GM?

**Recommendation:** Via migration with `must_change_password = true` AND `status = 'active'`. The dev password is documented in the schema plan's seed section and is changed on first sign-in. This unblocks local development and first-deploy bootstrap without requiring email delivery. The worklog records that the dev password is rotated before any production deploy.

**Impact of decision:** Affects the schema plan seed data. Does NOT affect the application-layer invite flow (section 6) — both options use the same `users` table shape.

### 11.4 2FA enforcement

The v2.0 spec mentions a `require_2fa` setting (default `false`). The question is whether 2FA should be enforced for `general_manager` and `admin` roles from day 1, or optional.

**Options:**

1. Optional from day 1 (recommended for Phase 2) — `require_2fa = false` by default. Users can enroll in TOTP voluntarily from `/settings/security`. The 2FA verify Server Action exists and is rate-limited (5/min per IP per v2.0) but is only triggered when a user has TOTP enrolled AND `require_2fa = true`.
2. Enforced for GM + admin from day 1 — `require_2fa = true` for GM and admin roles. Every GM/admin sign-in requires a TOTP code. More secure but requires every GM/admin to enroll a TOTP app before they can sign in.

**Recommendation:** Optional from day 1. Enforcing 2FA on day 1 adds friction to first-deploy bootstrap (the GM must enroll TOTP before they can do anything) and the platform is single-tenant internal at this stage. Revisit enforcement after Phase 7 hardening or when the tenant count grows.

**Impact of decision:** Affects the sign-in Server Action flow (whether the 2FA verify step is mandatory for some roles) and the `/settings/security` enrollment UI priority. The 2FA verify rate limit and `AUTH002`/`AUTH006` error codes are documented regardless.

### 11.5 auth.users sync trigger application

The M8 correction requires a trigger `sync_auth_user_to_custom_users` that runs `AFTER UPDATE OR DELETE` on `auth.users`. The `auth` schema is managed by Supabase and is NOT part of the standard migration flow — applying a trigger to `auth.users` requires running the SQL in the Supabase SQL editor (or via a migration that the Supabase CLI applies with elevated privileges).

**Question:** Does the user have access to the Supabase SQL editor (or the ability to run SQL against the `auth` schema) to apply this trigger manually?

**Recommendation:** The schema plan documents the trigger DDL in a clearly-marked "manual apply" section. During Phase 2 implementation, the applying engineer runs it in the Supabase SQL editor and records the application in the worklog. If the user does NOT have SQL editor access, an alternative is to run the sync in application code (a webhook on auth.user.updated events) — but this is less reliable than a DB trigger.

**Impact of decision:** Affects HOW the trigger is applied, not WHETHER. The trigger is required by ADR-019 (M8 correction) and must land in Phase 2.

---

## Document control

- **Status:** DRAFT — awaiting Phase 2 approval.
- **Date:** 2026-07-19.
- **Companion document:** `docs/phase-2-schema-plan.md` (DB schema: tables, RLS, triggers, storage, seed).
- **Supersedes:** None (new document).
- **Owner:** EliteDev engineering.
- **Approval gates:** ADR-014 Phase 2 gate, ADR-019 correction gate. Both require human approval before any file creation, migration application, or production code change described in this plan is executed.
- **Constraints:** This is a planning document. No files are created by this plan. No migrations are applied. No production code is touched. All code blocks are illustrative planned content.
