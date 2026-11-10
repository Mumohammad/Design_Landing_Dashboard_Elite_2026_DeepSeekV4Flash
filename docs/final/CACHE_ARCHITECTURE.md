# CACHE_ARCHITECTURE.md — EliteDev Platform

**Audit Date:** 2026-08-20
**Status:** Not implemented (safe — no cross-tenant leak risk)

---

## Current State

No caching is implemented. Every request hits Supabase directly.

### Implications
- ✅ No cross-tenant data leak risk
- ⚠️ Higher database load
- ⚠️ Slower page loads for complex dashboards
- ⚠️ More Supabase API requests

## Recommended Cache Strategy

### Cache Categories

| Category | TTL | Scope | Invalidation |
|----------|:---:|:-----:|:------------:|
| Static (landing, docs) | 1 hour | Public | On deploy |
| Semi-static (templates, settings) | 5 min | Per-tenant | On update |
| User-specific (dashboard) | 30 sec | Per-user | On mutation |
| Real-time (payroll, status) | No cache | Per-user | Never |
| Sensitive (financial) | No cache | Per-user | Never |

### Cache Key Convention
```
elite:{tenant_id}:{resource}:{filters}
elite:tnt_abc:drivers:page=1&search=ahmed
elite:tnt_abc:dashboard:kpi:30d
elite:public:landing:faq
```

### Implementation Stack

**Tier 1 (Recommended):** Upstash Redis
- Already in .env.example
- Serverless-compatible
- Per-request pricing
- No connection pooling issues

**Tier 2 (Alternative):** Next.js built-in cache
- `unstable_cache()` for server components
- `revalidateTag()` for invalidation
- Limited to server-side

### Cache Security Rules

1. **Always include tenant_id** in cache keys
2. **Never cache cross-tenant data** without tenant scoping
3. **Never cache sensitive financial data** without user scope
4. **Purge on mutation** — All write operations should invalidate related cache
5. **Short TTL for dashboard** — 30 seconds maximum

### Example Implementation
```typescript
import { unstable_cache } from 'next/cache'

const getDashboardKPIs = unstable_cache(
  async (tenantId: string, period: string) => {
    // Query Supabase
    return kpis
  },
  ['dashboard-kpis'],
  { revalidate: 30, tags: ['dashboard'] }
)
```
