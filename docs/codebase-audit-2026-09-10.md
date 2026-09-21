# Codebase Audit — Bugs & Security Review

**Date:** 2026-09-10 · **Scope:** full `src/`, config, scripts, supabase · **Verified:** `tsc --noEmit` ✅ · `eslint src` ✅ · `vitest` 221/221 ✅

---

## Verdict

The core architecture is solid: RLS as the data boundary, `requirePermission()` on every server action, constant-time HMAC verification, fail-closed webhook/cron/load-test gates, bcrypt invite tokens, open-redirect-safe `returnTo` handling, strict CSP/HSTS headers, and pnpm override pins for vulnerable transitive deps. The issues below are the gaps worth fixing.

---

## HIGH

### H1. `/api/platform/companies` POST is completely unauthenticated
`src/app/api/platform/companies/route.ts` creates a company **and** an admin user with an attacker-chosen password via the service-role client (`create_platform_user` RPC) — with **no auth check at all**. The proxy matcher excludes `/api`, so nothing else guards it. This is a legacy parallel path to the invite-based flow (it uses `platform_companies` / `platform_users`, not `tenants`).
**Fix:** delete the route, or put it behind `verifyPlatformAdmin()` like the other `/api/platform/admin/*` routes.

### H2. Documented per-IP auth rate limits are never enforced; in-memory limiter is ineffective on serverless
- `rateLimitSignIn` / `rateLimitForgotPassword` / `rateLimit2FA` are defined in `src/lib/auth/rate-limit.ts` but **never called** — sign-in (`components/login-form-1.tsx`) and forgot-password call Supabase directly from the browser. The auth-plan limits (10/min sign-in, 3/hr forgot, 5/min 2FA) exist only on paper. Supabase's built-in auth rate limits are the only backstop.
- Where the limiter *is* used (accounting, drivers, dashboard, …) it silently falls back to a per-instance in-memory Map when `UPSTASH_REDIS_REST_URL/TOKEN` are unset. On Vercel serverless that means per-Lambda, cold-start-reset counters — effectively no limit in production.
**Fix:** call the auth wrappers from server actions/routes; require Upstash in production (fail closed or alert loudly).

### H3. SSRF in outbound webhook delivery
`src/lib/webhooks/dispatcher.ts` POSTs signed payloads to `webhook.url`. The URL is validated with `new URL()` only — any tenant admin with `settings:manage` can register `http://localhost/...`, `http://169.254.169.254/...`, or internal hosts, and the server will deliver HMAC-signed payloads there.
**Fix:** allow `https:` only, resolve the host and block private/loopback/link-local ranges (or use an egress proxy).

---

## MEDIUM

### M1. Order CSV export fails for short months
`src/lib/orders/actions.ts` builds `end = YYYY-MM-31` unconditionally. For Feb/Apr/Jun/Sep/Nov Postgres rejects `lte.'2026-02-31'` as an invalid date and the export errors.
**Fix:** compute the real last day (date-fns `endOfMonth`) or filter `lt` on the first day of the next month.

### M2. Webhook retry cron is not configured; delivery table grows unbounded
`vercel.json` has no `crons` entry, so `/api/webhooks/cron` is never invoked and `processRetries()` never runs automatically. `cleanOldDeliveries()` is defined but never called anywhere → `webhook_deliveries` accumulates forever.
**Fix:** add `"crons": [{ "path": "/api/webhooks/cron", "schedule": "*/5 * * * *" }]` and a second cron for cleanup (export `cleanOldDeliveries` through the cron route).

### M3. Expense approval race → duplicate AP rows
`approveExpense` reads `is_approved` then inserts into `payables` — two concurrent approvals both pass the check and create two payable rows for one expense (financial impact). Rollback is also best-effort, not transactional.
**Fix:** atomic check-and-set first: `update expenses set is_approved = true where id = … and is_approved = false` and treat 0 rows updated as EXP002 before inserting the payable.

### M4. Raw Supabase error messages returned to clients
`/api/platform/register`, `/api/platform/companies`, `/api/platform/admin/{create-company,update-status,users}` return `error.message` from Supabase (e.g. `authError.message` leaks "User already registered" → account enumeration; others leak schema details). The newer routes correctly use generic messages.
**Fix:** return generic errors; log details server-side.

### M5. Public registration has no password policy and no bot protection
`/api/platform/register` validates only field presence — `password` can be `"a"`. Combined with no rate limit/captcha, the endpoint is usable for tenant spam and weak-credential creation.
**Fix:** reuse the zod schema from the companies route (min 8 + complexity), rate-limit per IP, consider a turnstile/honeypot.

### M6. MFA verify throttle is per-instance memory
`src/lib/auth/mfa.ts` `verifyAttempts` Map — the code itself carries a TODO. On serverless it resets per instance; combined with H2 the 5-per-5-min rule isn't real in production.

### M7. Inconsistent `audit_log.actor_id` values
`writeAuditLog` docs say `actor_id` references `auth.users(id)`, and `invites.ts`/`accounting` correctly pass `authUserId`. But `src/lib/webhooks/actions.ts` passes `currentUser.id` (the custom `users` row id). If the FK is on auth.users, those inserts fail — and `writeAuditLog` swallows errors, so the audit trail silently disappears for webhook management actions.
**Fix:** pass `authUserId` (or relax the FK — but pick one convention everywhere).

### M8. Proxy "downstream headers" don't work and leak metadata
`src/proxy.ts` sets `x-tenant-id` / `x-user-role` on the **response** headers. They never reach Server Components (that requires `NextResponse.next({ request: { headers } })`) — and instead they're shipped to the browser, leaking internal tenant/role info.
**Fix:** either set request headers properly or delete the two lines.

---

## LOW / Hardening

| # | Finding | Where |
|---|---------|-------|
| L1 | Production CSP keeps `script-src 'unsafe-inline'` — weakens XSS defense; move to nonce/hash-based CSP | `next.config.ts` |
| L2 | CSP `img-src` lacks the Supabase storage host — tenant logos served from Supabase Storage will be blocked | `next.config.ts` |
| L3 | Duplicate platform-admin guard implementations (`src/lib/platform/admin-guard.ts` vs `src/lib/platform/admin.ts`) — consolidate | both |
| L4 | Dead attack surface: `/api/platform/login` is unreferenced (platform login page now redirects to `/auth/sign-in`) — delete it (it also does service-role `signInWithPassword` with no rate limit) | route |
| L5 | `users` PATCH doesn't enum-validate `status` (role is validated); DELETE soft-deletes but doesn't ban the auth user, so an existing session keeps working on `/api/*` paths | `api/platform/admin/users` |
| L6 | 55× `console.error` instead of the structured pino logger (loses redaction + aggregation) | across `src/` |
| L7 | Health endpoint returns **200 for `degraded`** — pure status-code monitors won't page on DB/auth failure | `api/health` |
| L8 | Registration slug generation can collide (two similar company names → same slug); no uniqueness handling | `api/platform/register` |
| L9 | Repo hygiene: untracked scratch files at root (`dev-server.log`, `deployment_info.txt`, `.env.local.bak`, `lint-report.txt`, `dashboard-page-local-backup.patch`) and full duplicate project trees (`Design_Landing_…/`, `p0-1-*`) — drift/accidental-commit risk. Delete, and add `*.log` + scratch names to `.gitignore`. `.env*` is already ignored ✅ | repo root |

---

## Confirmed-good (no action)

- Incoming webhooks: fail-closed secret check, required timestamp (replay window 5 min), timing-safe HMAC compare, no dev bypass.
- Cron + load-test endpoints: fail-closed 503 without secret, bearer compare timing-safe.
- Invite flow: bcrypt(10) token hashes, `tid`+`token` split, replay-marking, anti-enumeration generic errors, compensating `deleteUser`, per-IP rate limit.
- Auth proxy: JWT validation via `getUser()`, profile/lock/inactive gates, must-change-password + MFA (AAL2) step-up, role-guarded `/settings/*`, open-redirect-safe `returnTo`/`next` (`safeReturnPath` blocks `//host`).
- Server actions: `requirePermission` + `getCurrentUser` + zod re-validation + explicit `tenant_id` scoping on every mutation; money math centralized in EPSILON-guarded `round2`; balanced-journal and period guards pushed into atomic service-role RPCs.
- Security headers (X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS prod-only), no-store on `/api/*`.

---

## Suggested fix order

1. **H1** (delete/guard the unauthenticated route) — minutes of work, closes the largest hole.
2. **H2** (wire auth rate limits + require Upstash in prod).
3. **M1, M2, M3** (functional bugs with real user/financial impact).
4. **H3, M4, M5, M8** (hardening + info leaks).
5. Low items opportunistically.
