# EliteDev — Saudi 3PL Enterprise Platform

> Enterprise logistics and 3PL SaaS platform for the Saudi Arabian market.
> Arabic/English, RTL/LTR, ZATCA-compliant invoicing, full payroll engine.

[![CI](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/actions/workflows/ci.yml)
[![pgTAP RLS Tests](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/actions/workflows/ci.yml/badge.svg?branch=master&label=pgTAP%20RLS)](https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16.3-black.svg)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green.svg)](https://supabase.com/)

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash.git
cd Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash
pnpm install

# 2. Set up environment
cp .env.example .env.local
# Fill in Supabase credentials (see .env.example for all vars)

# 3. Start development
pnpm dev

# 4. (Optional) Run pgTAP RLS tests locally
./scripts/setup-test-db.sh
```

## Architecture

```
Browser
  ↓
Next.js (React 19 + TypeScript)
  ↓
Server Components / Client Components
  ↓
Server Actions (requirePermission + writeAuditLog)
  ↓
Supabase Client (RLS-enforced)
  ├── PostgreSQL (75+ tables, RLS on all)
  ├── Auth (invite-only provisioning)
  ├── Storage (driver docs, invoices, templates)
  └── Realtime (optional)
```

## Modules

| Module | Description |
|--------|-------------|
| **Dashboard** | Executive KPIs, charts, insights, driver table |
| **Drivers** | Full lifecycle: onboarding, compliance, salary history |
| **Vehicles** | Fleet management, assignments, handover, maintenance |
| **Attendance** | Work schedules, leave, holidays, summaries |
| **Payroll** | Calculation engine, WPS export, deduction rollback |
| **Expenses** | Categories, approvals, advances |
| **Violations** | Types, deductions, external fine imports |
| **Platforms** | Delivery platform integration, daily orders |
| **HR** | Performance reviews, onboarding, training |
| **Documents** | Templates, generated docs, QR verification |
| **Accounting** | Chart of accounts, journal entries, periods |
| **Invoices** | Draft → issued → finalized, credit/debit notes |
| **VAT** | Periods, adjustments, reconciliation, returns |
| **ZATCA** | CSID management, XML signing, transmissions |
| **Reports** | Generation log, PDF/Excel export |
| **Settings** | Company profile, security, language, payroll defaults |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript 5.9, Tailwind CSS 4 |
| UI | shadcn/ui, Radix UI, Recharts, Framer Motion |
| Backend | Next.js Server Actions, Supabase RPC |
| Database | PostgreSQL 15 (via Supabase), pgTAP for RLS testing |
| Auth | Supabase Auth (invite-only) |
| Storage | Supabase Storage (signed URLs) |
| i18n | Arabic/English, RTL/LTR, typed translation catalog |
| Logging | pino (structured JSON) |
| Error Tracking | Sentry (client + server + edge) |
| CI/CD | GitHub Actions (lint → typecheck → tests → build → audit → pgTAP → E2E) |
| Deployment | Vercel |

## Security

- **RLS on all 75+ tables** — tenant isolation enforced at database level
- **109 pgTAP assertions** — automated RLS verification in CI
- **Invite-only provisioning** — no public signup, auth trigger hardened
- **Opaque verification tokens** — SHA-256 hashed, no enumerable IDs
- **Zero browser Supabase reads** — all sensitive data via server actions
- **Financial tenant scoping** — every mutation verified against tenant
- **PII scrubbing** — Sentry filters passwords, tokens, secrets
- **CSP hardened** — unsafe-eval removed, Sentry ingest whitelisted

## Testing

```bash
# Unit tests (221 tests, 21 files)
pnpm test

# pgTAP RLS tests (127 assertions, 75+ tables)
./supabase/run-pgtap-tests.sh

# E2E tests (Playwright)
pnpm test:e2e

# TypeScript check
npx tsc --noEmit

# Lint
pnpm lint
```

## CI/CD Pipeline

```
PR / Push to master
  │
  ├── ci (ubuntu-latest, 20min)
  │   ├── Install dependencies
  │   ├── Lint
  │   ├── Type check
  │   ├── Unit tests (221/221)
  │   ├── Build
  │   ├── Dependency audit (0 high/critical)
  │   ├── Secret scan
  │   └── Health endpoint smoke test
  │
  ├── pgtap (needs: ci, 15min)
  │   ├── Start Supabase local stack
  │   ├── Apply all 60 migrations + seed
  │   ├── Run 127 pgTAP RLS assertions
  │   └── Stop Supabase
  │
  └── e2e (needs: ci, PRs only)
      └── Playwright smoke tests (if staging URL configured)
```

## Environment Variables

See [`.env.example`](.env.example) for the full list. Key variables:

```env
# Required
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Sentry (production)
SENTRY_DSN=
SENTRY_ORG=
SENTRY_PROJECT=
SENTRY_AUTH_TOKEN=

# App
NEXT_PUBLIC_APP_URL=
```

## Database

- **60 migrations** (forward-only, never edit applied migrations)
- **75+ tables** with RLS enabled
- **pgTAP test suite** validates all policies
- **Seed data** for local development and CI

```bash
# Apply all migrations
supabase db reset

# Run pgTAP tests
supabase db execute -f supabase/tests/010_full_rls_test_suite.sql
```

## Documentation

| Document | Description |
|----------|-------------|
| `docs/PRODUCTION_READINESS_SCORE.md` | Weighted scorecard (7.9/10) |
| `docs/PRODUCTION_CERTIFICATION.md` | Go-live checklist with evidence |
| `docs/CI_CD_AUDIT.md` | Pipeline configuration and gates |
| `docs/DEPLOYMENT_RUNBOOK.md` | Vercel + Supabase deployment procedures |
| `docs/DISASTER_RECOVERY.md` | RPO/RTO, backup strategy, incident response |
| `docs/ROLLBACK_PLAN.md` | Application, database, migration rollback |
| `docs/TEST_STRATEGY.md` | Unit, integration, E2E, security test plan |

## Production Readiness

**Current Score: 7.9/10 — ⚠️ CONDITIONALLY READY**

See [docs/PRODUCTION_READINESS_SCORE.md](docs/PRODUCTION_READINESS_SCORE.md) for the full breakdown.

### Before Go-Live

1. Configure Sentry DSN in Vercel environment variables
2. Set up staging Supabase project
3. Enable Vercel Analytics
4. Configure uptime monitoring at `/api/health`

## License

Private — EliteDev © 2026
