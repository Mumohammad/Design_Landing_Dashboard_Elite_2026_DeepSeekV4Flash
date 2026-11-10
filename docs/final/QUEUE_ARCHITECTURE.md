# QUEUE_ARCHITECTURE.md — EliteDev Platform

**Audit Date:** 2026-08-20
**Status:** Not implemented — critical gap for production

---

## Current State

All operations are synchronous. This is acceptable for small scale but will cause issues with:
- PDF generation (slow, blocks request)
- Excel exports (large data)
- Bulk payroll processing (many calculations)
- Email sending (network I/O)
- ZATCA transmission (external API)

## Recommended Queue Architecture

### Implementation Options

| Option | Complexity | Best For |
|--------|:----------:|----------|
| **Inngest** | Low | Serverless, Supabase-native |
| **BullMQ + Redis** | Medium | Traditional servers |
| **Supabase Edge Functions** | Medium | DB-triggered jobs |
| **Custom (pg_notify)** | High | Full control |

### Recommended: Inngest
- Serverless-native (works with Vercel)
- No infrastructure management
- Built-in retries, throttling, deduplication
- Free tier sufficient for initial scale

## Job Catalog

| Job | Trigger | Priority | Retries | Timeout |
|-----|---------|:--------:|:-------:|:-------:|
| PDF generation | Invoice/document create | Medium | 3 | 60s |
| Excel export | User request | Medium | 3 | 120s |
| Payroll calculation | Period close | High | 5 | 300s |
| Email sending | Invite, notification | Low | 3 | 30s |
| ZATCA transmission | Invoice finalize | High | 3 | 60s |
| Report generation | User request | Medium | 3 | 120s |
| Document processing | Upload | Low | 3 | 60s |

## Job Schema

```typescript
interface BackgroundJob {
  id: string
  organization_id: string
  created_by: string
  type: string           // 'pdf.generate' | 'payroll.calculate' | etc.
  status: 'pending' | 'running' | 'completed' | 'failed'
  attempts: number
  max_attempts: number
  progress: number       // 0-100
  payload: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
  started_at?: string
  completed_at?: string
  created_at: string
  updated_at: string
}
```

## Implementation Priority

### P1 (Before heavy usage)
1. PDF generation async
2. Excel export async

### P2 (At 10+ tenants)
3. Payroll processing async
4. Email sending async

### P3 (At 50+ tenants)
5. ZATCA transmission async
6. Report generation async
7. Document processing async
