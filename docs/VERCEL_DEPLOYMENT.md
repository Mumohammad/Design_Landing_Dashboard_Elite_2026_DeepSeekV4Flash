# Vercel Deployment Guide — EliteDev

## Prerequisites

1. **Vercel Account** — [vercel.com](https://vercel.com) (Hobby plan is fine for starting)
2. **Supabase Project** — Already provisioned with schema + seed data
3. **GitHub Repo** — [Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash)

---

## Step 1: Import Repository

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **"Import Git Repository"**
3. Select `Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash`
4. Click **"Import"**

---

## Step 2: Configure Build Settings

Vercel auto-detects Next.js. Verify:

| Setting | Value |
|---------|-------|
| Framework | Next.js |
| Build Command | `pnpm build` |
| Output Directory | `.next` |
| Install Command | `pnpm install --frozen-lockfile` |
| Node.js Version | 20.x |

---

## Step 3: Set Environment Variables

Go to **Settings → Environment Variables** and add:

### Required (from Supabase Dashboard → Settings → API)

| Variable | Value | Environment |
|----------|-------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxxx.supabase.co` | All |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbG...` | All |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbG...` | Production only |
| `NEXT_PUBLIC_APP_URL` | `https://your-app.vercel.app` | All |

### Optional — Rate Limiting (Upstash Redis)

| Variable | Value | Environment |
|----------|-------|-------------|
| `UPSTASH_REDIS_REST_URL` | `https://xxxxx.upstash.io` | Production |
| `UPSTASH_REDIS_REST_TOKEN` | `AXxx...` | Production |

### Optional — Email (Resend)

| Variable | Value | Environment |
|----------|-------|-------------|
| `RESEND_API_KEY` | `re_xxxxx` | Production |
| `RESEND_FROM_EMAIL` | `noreply@elitedev.com.sa` | Production |

### Optional — Error Tracking (Sentry)

| Variable | Value | Environment |
|----------|-------|-------------|
| `SENTRY_DSN` | `https://xxxxx@sentry.io/xxxxx` | Production |
| `NEXT_PUBLIC_SENTRY_DSN` | (same as SENTRY_DSN) | All |
| `SENTRY_ORG` | `your-org` | Production |
| `SENTRY_PROJECT` | `your-project` | Production |

### Optional — Logging

| Variable | Value | Environment |
|----------|-------|-------------|
| `LOG_LEVEL` | `info` | Production |
| `PERF_LOG_THRESHOLD_MS` | `1000` | Production |

---

## Step 4: Deploy

1. Click **"Deploy"**
2. Wait for the build to complete (~2-3 minutes)
3. Vercel assigns a URL like `your-project.vercel.app`

---

## Step 5: Custom Domain (Optional)

1. Go to **Settings → Domains**
2. Add your domain (e.g., `app.elitedev.com.sa`)
3. Add the DNS records Vercel provides
4. Enable HTTPS (automatic)

---

## Step 6: Post-Deploy Verification

After deployment, verify:

```bash
# 1. Homepage loads
curl -s -o /dev/null -w "%{http_code}" https://your-app.vercel.app/landing
# Should return: 200

# 2. Auth redirect works
curl -s -o /dev/null -w "%{http_code}" https://your-app.vercel.app/dashboard
# Should return: 307 (redirect to /auth/sign-in)

# 3. API health (if you add one)
curl -s -o /dev/null -w "%{http_code}" https://your-app.vercel.app/api/health
# Should return: 200
```

---

## Step 7: GitHub Auto-Deploy

Vercel automatically deploys:
- **Preview** — on every push to any branch
- **Production** — on push to `master` branch

To promote a preview to production:
1. Go to the deployment in Vercel dashboard
2. Click **"Promote to Production"**

---

## Step 8: Database Migration

If you haven't already applied migrations to your Supabase project:

```bash
# Install Supabase CLI
pnpm add -D supabase

# Login
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Push all migrations
supabase db push

# Seed initial data (optional)
supabase db seed
```

---

## Troubleshooting

### Build fails with "Module not found"
- Run `pnpm install` locally to regenerate lockfile
- Commit the updated `pnpm-lock.yaml`

### Environment variables not available
- Ensure variables are set in Vercel dashboard (not just .env.local)
- Set sensitive variables to **Production** only, not Preview

### Supabase connection fails
- Verify `NEXT_PUBLIC_SUPABASE_URL` doesn't have a trailing slash
- Verify `SUPABASE_SERVICE_ROLE_KEY` is set for server-side operations

### Sentry not capturing errors
- Set `SENTRY_DSN` in Production environment
- Source maps upload requires `SENTRY_ORG` and `SENTRY_PROJECT`

---

## Architecture Diagram

```
Browser
  ↓ HTTPS
Vercel Edge Network (CDN + Edge Functions)
  ↓
Next.js App (Server Components + Client Components)
  ↓ Server Actions
Supabase
  ├── PostgreSQL (RLS + Triggers)
  ├── Auth (JWT + Session)
  ├── Storage (Private Buckets)
  └── Realtime (Subscriptions)

Optional Integrations:
  ├── Upstash Redis (Rate Limiting)
  ├── Resend (Email)
  ├── Sentry (Error Tracking)
  └── ZATCA (Tax Compliance)
```
