# OBSERVABILITY.md — EliteDev Platform

**Audit Date:** 2026-08-20
**Status:** ⚠️ Minimal — needs implementation

---

## Current State

| Component | Status | Detail |
|-----------|:------:|--------|
| Error tracking | ⚠️ | Sentry DSN configured in .env.example but not implemented |
| Structured logging | ❌ | console.error only in error boundary |
| Request logging | ❌ | No request/response logging |
| Audit logging | ✅ | `writeAuditLog()` in 20/26 server actions |
| Performance monitoring | ❌ | No APM |
| Uptime monitoring | ❌ | None configured |
| Alerting | ❌ | None configured |

## Recommended Observability Stack

### Tier 1: Essential (Before Production)
1. **Sentry** — Error tracking + performance
   - Already configured in .env.example
   - Add `@sentry/nextjs` package
   - Capture server action errors
   
2. **Structured Logging** — Replace console.error
   - Use `pino` or `winston`
   - Add request ID, user ID, tenant ID to all logs
   - Log format: `{ timestamp, level, message, requestId, userId, tenantId, action, resource }`

3. **Supabase Dashboard** — Built-in monitoring
   - Database metrics
   - Auth logs
   - Storage usage
   - API requests

### Tier 2: Growth (3-6 months)
4. **Uptime monitoring** — Checkly or Betterstack
5. **Log aggregation** — Supabase logs + external
6. **Custom dashboards** — Grafana or similar

### Tier 3: Scale (12+ months)
7. **APM** — Datadog or New Relic
8. **Distributed tracing** — OpenTelemetry
9. **Custom metrics** — Business KPIs
10. **Alerting** — PagerDuty or OpsGenie

## Structured Logging Schema

```json
{
  "timestamp": "2026-08-20T10:00:00Z",
  "level": "info",
  "message": "Invoice created",
  "requestId": "req_abc123",
  "userId": "usr_xyz",
  "tenantId": "tnt_abc",
  "action": "invoice.created",
  "resource": "invoice",
  "resourceId": "inv_001",
  "metadata": {
    "amount": 15000,
    "currency": "SAR"
  }
}
```

## Security Event Logging

### Required Security Events
| Event | Level | Detail |
|-------|:-----:|--------|
| LOGIN_SUCCESS | info | User ID, IP |
| LOGIN_FAILED | warn | Email, IP, reason |
| PASSWORD_RESET | info | User ID |
| ROLE_CHANGED | warn | Actor, Target, Old→New |
| ACCOUNT_LOCKED | warn | User ID, reason |
| UNAUTHORIZED_ACCESS | error | User ID, resource, action |
| DATA_EXPORT | info | User ID, type, record count |
| SETTINGS_CHANGED | info | User ID, setting, old→new |

## Severity Levels

| Level | Response Time | Examples |
|:-----:|:------------:|----------|
| SEV-1 | <15 min | Database down, auth bypass, data breach |
| SEV-2 | <1 hour | Server action failures, payment errors |
| SEV-3 | <4 hours | Slow queries, non-critical errors |
| SEV-4 | Next day | Performance degradation, minor bugs |

## Alert Rules (Recommended)

| Alert | Condition | Severity |
|-------|-----------|:--------:|
| High error rate | >5% of requests | SEV-2 |
| Auth failures spike | >10 in 5 minutes | SEV-2 |
| Slow queries | >5 seconds | SEV-3 |
| Database connections | >80% pool | SEV-2 |
| Storage >80% | Disk usage | SEV-3 |
| Failed deployments | Deploy fails | SEV-2 |
