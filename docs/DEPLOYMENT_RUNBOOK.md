# DEPLOYMENT_RUNBOOK.md — EliteDev Platform

**Last Updated:** 2026-08-20
**Target Platform:** Vercel (recommended) or Docker (self-hosted)

---

## Prerequisites

### Environment Variables
All required env vars are documented in `.env.example`. For production:

```
NEXT_PUBLIC_APP_URL=https://app.elitedev.com.sa
NEXT_PUBLIC_SUPABASE_URL=<supabase-project-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
RESEND_API_KEY=<resend-api-key>
RESEND_FROM_EMAIL=noreply@elitedev.com.sa
SENTRY_DSN=<optional>
UPSTASH_REDIS_REST_URL=<optional>
UPSTASH_REDIS_REST_TOKEN=<optional>
```

### Database
1. All 57 migrations (001-057) must be applied
2. Migration 009 trigger must be applied manually via Supabase SQL Editor
3. RLS policies (010) must be active
4. Seed data (013) must be loaded

### Supabase
1. Auth providers configured
2. Storage buckets created (011)
3. Email templates customized

## Deployment Steps (Vercel)

```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Link project
vercel link

# 3. Set environment variables
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add RESEND_API_KEY production
vercel env add RESEND_FROM_EMAIL production

# 4. Deploy
vercel --prod

# 5. Verify
curl -I https://app.elitedev.com.sa/landing
```

## Deployment Steps (Docker)

```dockerfile
FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

## Post-Deploy Verification

```bash
# Health check
curl -I https://app.elitedev.com.sa/

# Auth flow
curl -I https://app.elitedev.com.sa/auth/sign-in

# Security headers
curl -I https://app.elitedev.com.sa/landing | grep -i "x-frame\|x-content\|strict"

# Dashboard (should redirect to sign-in)
curl -I https://app.elitedev.com.sa/dashboard
```

## Rollback Procedure

### Application Rollback (Vercel)
```bash
# List deployments
vercel ls

# Promote previous deployment
vercel promote <deployment-url>
```

### Database Rollback
1. Identify the migration to rollback
2. Create a reverse migration script
3. Test in staging first
4. Apply during maintenance window
5. Never delete data — use soft-delete

## Incident Communication

1. Detect alert
2. Assess severity (SEV-1 to SEV-4)
3. Notify team
4. Begin investigation
5. Implement fix
6. Verify fix
7. Post-mortem
