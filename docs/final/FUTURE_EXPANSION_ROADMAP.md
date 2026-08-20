# FUTURE_EXPANSION_ROADMAP.md — EliteDev Platform

**Last Updated:** 2026-08-20

---

## Scaling Roadmap

### STAGE 1: Single Tenant (NOW)
- Supabase managed PostgreSQL
- Next.js App Router
- Server Actions (26 modules)
- RLS-based security
- Manual deployment
- **Status: ✅ Current state**

### STAGE 2: Production Launch (1-3 months)
- CI/CD pipeline (✅ created)
- Rate limiting on all actions
- Structured logging
- Supabase Pro plan
- Vercel deployment
- E2E tests
- Error tracking (Sentry)
- **Status: 🔧 In progress**

### STAGE 3: Growing SaaS (3-6 months)
- Redis caching layer
- Background job queue (Inngest or BullMQ)
- Cursor-based pagination
- REST API for mobile
- Feature flags
- MFA support
- **Status: 📋 Planned**

### STAGE 4: Multi-Tenant Scale (6-12 months)
- Multi-org user support
- Org switching in UI
- Custom domain per tenant
- Webhook architecture
- Advanced observability (Grafana/Datadog)
- Data archival strategy
- Read replicas
- **Status: 📋 Planned**

### STAGE 5: Enterprise (12+ months)
- SAML/OIDC SSO
- SCIM provisioning
- Advanced compliance (SOC2)
- White-label branding
- Multi-region support
- Dedicated compute
- Service decomposition
- **Status: 📋 Future**

---

## Module Expansion Architecture

### Current Modules (28)
Fleet, Drivers, Vehicles, Attendance, Payroll, HR, Expenses, Violations, Maintenance, Documents, Templates, Accounting, Invoices, Reports, Notifications, Platforms, Orders, Applications, Security, Settings, Audit Log, Calendar, Chat, Mail, Tasks, Pricing, FAQs, Dashboard

### Future Modules (Recommended)
| Module | Priority | Dependencies | Effort |
|--------|:--------:|:-------------|:------:|
| Contracts | P2 | Drivers, HR | Medium |
| Procurement | P2 | Expenses, Accounting | High |
| Customer Management | P2 | Parties, Invoices | Medium |
| Billing/Subscriptions | P3 | Accounting, Payments | High |
| Advanced Analytics | P3 | Reports, Dashboard | Medium |
| Email Campaigns | P4 | Notifications, Templates | Medium |

---

## SaaS Billing Architecture (Future)

```
organizations
├── subscription_plan_id → plans
├── billing_period
├── trial_ends_at
├── subscription_status

plans
├── name (starter/professional/business/enterprise)
├── monthly_price
├── annual_price
├── max_users
├── max_drivers
├── max_vehicles
├── features (JSONB entitlement flags)

organization_features
├── organization_id
├── feature_key
├── enabled
├── limit
├── used
```

### Entitlement Model (Not Hardcoded Limits)
Instead of `if (user.role === 'admin')`, use:
```sql
SELECT * FROM organization_features
WHERE organization_id = $1 AND feature_key = 'advanced_reports' AND enabled = true;
```

---

## API Versioning Strategy (Future)

```
/api/v1/drivers      → Current server actions
/api/v1/payroll      → Current server actions
/api/v2/drivers      → Enhanced with pagination, filtering
```

Server actions are the current API. REST endpoints would be added alongside, not replacing.

---

## Event Architecture (Future)

### Domain Events (When Needed)
```
driver.created → notify fleet manager
payroll.approved → notify accountant, generate payslip
invoice.created → send to customer
document.expiring → notify admin
user.invited → send email
organization.created → provision default data
```

### When to Implement
- When >50 tenants (need decoupled notifications)
- When external integrations are needed
- When audit trail requires event sourcing

### Implementation Options
1. **Inngest** — Serverless event-driven (recommended for Supabase)
2. **Supabase Edge Functions** — Triggered by DB changes
3. **Application-level events** — Simple pub/sub within server actions

---

## Webhook Architecture (Future)

### Outbound Webhooks
```
POST /webhooks/{tenant_id}
├── X-Webhook-Signature: HMAC-SHA256
├── X-Webhook-Timestamp: ISO timestamp
├── Event: driver.created
├── Payload: { ... }
```

### Inbound Webhooks (Integrations)
- Delivery platforms (food delivery callbacks)
- Payment gateways
- Accounting systems (QuickBooks, Xero)
- HR systems
- Government portals (ZATCA, MOL)
