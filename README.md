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

## Contributing

### Prerequisites

- Node.js 24+
- pnpm (via corepack)
- Docker (for Supabase local / pgTAP tests)
- Supabase CLI (`npm install -g supabase`)

### Development Workflow

```bash
# 1. Create a feature branch
 git checkout -b feat/my-feature master

# 2. Start dev server
 pnpm dev

# 3. Make changes, then verify
 pnpm lint            # Lint
 npx tsc --noEmit     # Type check
 pnpm test            # Unit tests

# 4. Run pgTAP tests if you changed RLS/migrations
 ./supabase/run-pgtap-tests.sh

# 5. Commit with conventional message
 git commit -m "feat: add new payroll export format"

# 6. Push and open PR
 git push origin feat/my-feature
```

### Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
type: short description

optional body
```

| Type | When to Use |
|------|-------------|
| `feat` | New feature or module |
| `fix` | Bug fix |
| `security` | Security hardening, RLS, auth |
| `test` | Adding/updating tests |
| `docs` | Documentation changes |
| `ci` | CI/CD pipeline changes |
| `refactor` | Code restructuring (no behavior change) |
| `perf` | Performance improvements |
| `i18n` | Translation / localization |

### PR Checklist

Before requesting review, ensure:

- [ ] `pnpm lint` passes with 0 errors
- [ ] `npx tsc --noEmit` passes with 0 errors
- [ ] `pnpm test` — all 221 unit tests pass
- [ ] No browser Supabase reads added (check `grep src/ "@/lib/supabase/client"`)
- [ ] Any new server action has `requirePermission()`
- [ ] Any new mutation has `writeAuditLog()`
- [ ] Any new table has RLS enabled and a pgTAP test
- [ ] No secrets, tokens, or passwords in code
- [ ] Arabic/English translations added for new strings
- [ ] Responsive on mobile (375px minimum)
- [ ] RTL layout works correctly

### Architecture Rules

| Rule | Why |
|------|-----|
| **Never use `@/lib/supabase/client` in dashboard pages** | All sensitive reads go through server actions |
| **Always use `requirePermission()` in server actions** | Defense-in-depth beyond RLS |
| **Always use `writeAuditLog()` for mutations** | Audit trail for compliance |
| **Never edit applied migrations** | Create forward-only migrations with the next number |
| **Use `round2()` for monetary values** | Avoid floating-point precision errors |
| **Never expose `SUPABASE_SERVICE_ROLE_KEY` to client** | Server-only, bypasses RLS |
| **Always scope queries by `tenant_id`** | Multi-tenant isolation |

### pgTAP RLS Tests

If you add a new table or modify RLS policies:

1. Add the table to `supabase/tests/010_full_rls_test_suite.sql`
2. Add cross-tenant denial test (Section 6 pattern)
3. Add anonymous denial test (Section 4 pattern)
4. If the table is service-role-only, add to Section 2
5. Run `./supabase/run-pgtap-tests.sh` to verify

### File Organization

```
src/
├── app/                    # Next.js App Router pages
│   ├── (dashboard)/        # Dashboard routes (protected)
│   ├── auth/               # Auth pages (login, signup, etc.)
│   ├── api/                # API routes (health, cron)
│   └── landing/            # Public landing page
├── components/             # Shared React components
│   ├── ui/                 # shadcn/ui primitives
│   ├── landing/            # Landing page sections
│   └── dashboard/          # Dashboard-specific components
├── lib/                    # Business logic & utilities
│   ├── accounting/         # Invoice, VAT, ZATCA, journal
│   ├── auth/               # Authorization, invites, sessions
│   ├── payroll/            # Payroll calculation engine
│   ├── expenses/           # Expense management
│   ├── reports/            # Report generation
│   ├── supabase/           # Supabase client factories
│   ├── i18n/               # Translations & locale
│   └── logger.ts           # Structured logging (pino)
├── hooks/                  # Custom React hooks
├── contexts/               # React contexts (locale)
└── proxy.ts                # Route protection middleware

supabase/
├── migrations/             # 60 forward-only SQL migrations
├── tests/                  # pgTAP RLS test files
│   ├── 010_full_rls_test_suite.sql
│   ├── 058_rls_security_tests.sql
│   └── 060_behavioral_rls_tests.sql
├── seed.sql                # Test fixture data
├── config.toml             # Supabase CLI config
└── run-pgtap-tests.sh      # pgTAP test runner

docs/                       # Production documentation
e2e/                        # Playwright E2E tests
scripts/                    # Setup & deployment scripts
```

### Getting Help

- Check existing [docs/](docs/) for deployment, rollback, and disaster recovery
- Open an issue for bugs or feature requests
- For security issues, do NOT open a public issue — contact the team directly

## License

Private — EliteDev © 2026
