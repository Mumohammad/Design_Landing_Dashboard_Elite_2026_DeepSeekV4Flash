# Phase 2 Setup Guide

This guide walks you through applying the Phase 2 database migrations and setting up the application end-to-end. It assumes Phase 1 (landing page, bilingual foundation, design system) is already in place.

> **Working directory (Windows):**
> `C:\Users\Zbook\Downloads\shadcn-dashboard-landing-template-main (1)\shadcn-dashboard-landing-template-main\nextjs-version`

---

## 1. Prerequisites

Before you begin, make sure you have the following:

- **Node.js 18+** and **pnpm** installed
- A **Supabase project** (create one at https://supabase.com/dashboard)
- The **Supabase CLI** — install via one of:
  ```sh
  npm install -g supabase
  # or
  brew install supabase/tap/supabase
  ```
- A **Resend** account (for invite emails) — optional for dev, required for production invite flow

---

## 2. Install dependencies

```sh
cd "C:\Users\Zbook\Downloads\shadcn-dashboard-landing-template-main (1)\shadcn-dashboard-landing-template-main\nextjs-version"

# Required for Phase 2
pnpm add @supabase/ssr

# Optional for production rate limiting (dev falls back to in-memory)
pnpm add @upstash/redis @upstash/ratelimit

# Optional for future bcrypt upgrade (currently uses SHA-256)
pnpm add bcryptjs @types/bcryptjs

# From Phase 1 (if not yet installed)
pnpm add framer-motion
```

---

## 3. Configure environment

```sh
# Copy the example env file
cp .env.example .env.local
```

Edit `.env.local` and fill in real values:

- `NEXT_PUBLIC_SUPABASE_URL` — from Supabase Dashboard → Project Settings → API → **Project URL**
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Supabase Dashboard → Project Settings → API → **anon public** key
- `SUPABASE_SERVICE_ROLE_KEY` — from Supabase Dashboard → Project Settings → API → **service_role** key (**NEVER expose to browser**)
- `RESEND_API_KEY` — from https://resend.com/api-keys (optional for dev)
- `RESEND_FROM_EMAIL` — a verified sender address (optional for dev)
- `NEXT_PUBLIC_APP_URL` — `http://localhost:3000` for dev, your domain for prod

---

## 4. Apply migrations

```sh
# Link your Supabase project (one-time)
supabase link --project-ref YOUR_PROJECT_REF

# Apply all migrations (001-013)
supabase db push

# Verify migrations applied
supabase db dump --schema public | grep "CREATE TABLE"
```

The `grep` output should include the following tables:

```
tenants
users
system_settings
audit_log
roles
permissions
role_permissions
user_role_assignments
tenant_memberships
invites
```

---

## 5. Apply the auth.users sync trigger (MANUAL — cannot be in db push)

The `auth` schema is managed by Supabase and **cannot** be modified via `supabase db push`. Apply this trigger manually:

1. Go to **Supabase Dashboard → SQL Editor**
2. Paste the content from the commented-out block in `supabase/migrations/009_triggers.sql` (the `sync_auth_user_to_custom_users` function + `on_auth_user_changed` trigger)
3. Run the query

This trigger keeps the custom `users` table `status` column in sync when a user is banned or deleted in Supabase Auth.

---

## 6. Create the first General Manager user

Since there is no public self-registration, the first GM must be created manually.

### Option A: Via Supabase Dashboard (easiest)

1. Go to **Supabase Dashboard → Authentication → Users → Add user**
2. Enter the GM's email and a temporary password
3. Note the user's UUID (from the Auth users list)
4. Go to **SQL Editor** and run:

```sql
-- Insert the custom users row (replace the UUID and email)
INSERT INTO users (auth_user_id, tenant_id, employee_code, full_name_ar, full_name_en, email, role, status, must_change_password)
VALUES (
  'PASTE_AUTH_USER_UUID_HERE'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,  -- the seeded Elite Development tenant
  'GM-001',
  'اسم المدير العام',
  'General Manager Name',
  'gm@elite-dev.com',
  'general_manager',
  'active',
  false  -- set true to force password change on first login
);

-- Create the tenant membership
INSERT INTO tenant_memberships (tenant_id, user_id, is_primary)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, id, true
FROM users WHERE auth_user_id = 'PASTE_AUTH_USER_UUID_HERE'::uuid;

-- Create the role assignment
INSERT INTO user_role_assignments (tenant_id, user_id, role_id)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, u.id, r.id
FROM users u
CROSS JOIN roles r
WHERE u.auth_user_id = 'PASTE_AUTH_USER_UUID_HERE'::uuid
  AND r.name = 'general_manager'
  AND r.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid;
```

### Option B: Via the invite flow (production-realistic)

After the first GM exists, they can invite other users via the UI at `/settings/users` → **"Invite User"**.

---

## 7. Replace placeholder CR/VAT values

The seed migration (`013`) uses placeholder values for the tenant's commercial registration and VAT numbers. Update them with the real values:

```sql
UPDATE tenants
SET cr_number = 'YOUR_REAL_CR_NUMBER',
    vat_number = 'YOUR_REAL_VAT_NUMBER_15_DIGITS'
WHERE id = '00000000-0000-0000-0000-000000000001'::uuid;
```

---

## 8. Verify Phase 1 + Phase 2 compile

```sh
pnpm lint
pnpm exec tsc --noEmit
```

Both commands should pass with no errors.

---

## 9. Run the dev server

```sh
pnpm dev
```

Visit http://localhost:3000 — you should see:

- **Landing page** (bilingual)
- `/auth/sign-in` — split-screen login
- After login as GM → `/dashboard` with KPI placeholders

---

## 10. Test the RLS (optional but recommended)

Run these SQL tests in the Supabase SQL Editor to verify tenant isolation:

```sql
-- Test 1: Verify get_my_tenant_id() works
-- Run as an authenticated user (set the JWT claim)
SET LOCAL request.jwt.claims = '{"sub": "YOUR_AUTH_USER_UUID"}';
SELECT get_my_tenant_id();  -- should return the tenant UUID

-- Test 2: Verify RLS blocks cross-tenant reads
-- As user in tenant A, try to read tenant B's data
SELECT * FROM users WHERE tenant_id != get_my_tenant_id();
-- should return 0 rows

-- Test 3: Verify INSERT WITH CHECK blocks forged tenant_id
INSERT INTO users (auth_user_id, tenant_id, email, role)
VALUES (gen_random_uuid()::text::uuid, '00000000-0000-0000-0000-000000000002'::uuid, 'test@test.com', 'admin');
-- should fail with RLS policy violation

-- Test 4: Verify audit_log immutability
UPDATE audit_log SET action = 'tampered' WHERE id = (SELECT id FROM audit_log LIMIT 1);
-- should fail with "audit_log is immutable" error
```

---

## 11. Production checklist

- [ ] `.env.local` populated with real values (**NEVER committed**)
- [ ] `@supabase/ssr` installed
- [ ] Migrations applied (`supabase db push`)
- [ ] `auth.users` sync trigger applied via SQL Editor
- [ ] First GM user created
- [ ] CR/VAT placeholder values replaced
- [ ] `pnpm lint` passes
- [ ] `pnpm exec tsc --noEmit` passes
- [ ] RLS tests pass (section 10)
- [ ] (Production) `@upstash/redis @upstash/ratelimit` installed for rate limiting
- [ ] (Production) Resend configured for invite emails
- [ ] (Production) Storage bucket auto-purge cron configured (`generated-reports` 24h, `import-files` 7d)

---

## 12. Troubleshooting

- **"Module not found: @supabase/ssr"** → run `pnpm add @supabase/ssr`
- **"relation users does not exist"** → migrations not applied; run `supabase db push`
- **"permission denied for table users"** → RLS is working; ensure you're authenticated and have a `users` row
- **"audit_log is immutable"** → you tried to UPDATE/DELETE an `audit_log` row; this is by design
- **Middleware redirects to `/auth/sign-in` on every page** → session not set; sign in first, or check that the middleware matcher is correct
