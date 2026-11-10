# API_AUDIT.md — EliteDev Platform

**Audit Date:** 2026-08-20
**Architecture:** Server Actions only (no REST API routes)
**Status:** ⚠️ Functional but limited

---

## Architecture

The application uses **Next.js Server Actions** exclusively. There are **zero API routes** (`/api/*` does not exist).

This is a valid architecture for a Next.js App Router application but has implications:
- No REST/GraphQL API for mobile apps or third-party integrations
- No webhook endpoints for external services
- No OpenAPI/Swagger documentation

## Server Action Inventory

### Authentication & User Management
| Action | File | Auth | Validation |
|--------|------|------|-----------|
| signIn | `auth/actions.ts` | Public | Zod |
| signUp | `auth/actions.ts` | Public | Zod |
| signOut | `auth/actions.ts` | Required | — |
| forgotPassword | `auth/actions.ts` | Public | Rate limited |
| resetPassword | `auth/actions.ts` | Token | Zod |
| acceptInvite | `auth/invites.ts` | Token | Zod |

### Accounting
| Action | File | Auth | Admin |
|--------|------|------|-------|
| postJournalEntry | `accounting/actions.ts` | Required | Yes |
| updateJournalEntry | `accounting/actions.ts` | Required | Yes |
| voidJournalEntry | `accounting/actions.ts` | Required | Yes |
| deleteJournalEntry | `accounting/actions.ts` | Required | Yes |
| createInvoice | `accounting/invoices.ts` | Required | Yes |
| issueInvoice | `accounting/invoices.ts` | Required | Yes |
| recordPayment | `accounting/payments.ts` | Required | Yes |
| generateInvoiceDocument | `accounting/invoice-docs.ts` | Required | Yes |
| saveZatcaCsid | `accounting/zatca-csid.ts` | Required | Yes |
| transmitToZatca | `accounting/zatca-transport.ts` | Required | Yes |

### Business Operations
| Action | File | Auth |
|--------|------|------|
| createDriver | `drivers/actions.ts` | Required |
| updateDriver | `drivers/actions.ts` | Required |
| createVehicle | `vehicles/actions.ts` | Required |
| updateVehicle | `vehicles/actions.ts` | Required |
| recordAttendance | `attendance/actions.ts` | Required |
| createExpense | `expenses/actions.ts` | Required |
| processPayroll | `payroll/actions.ts` | Required |
| createApplication | `applications/actions.ts` | Required |
| createTemplate | `templates/generator.ts` | Required |
| generateReport | `reports/actions.ts` | Required |
| updateSettings | `settings/actions.ts` | Required |

## Security Analysis

### ✅ Strengths
1. **All server actions use `createAdminClient()`** — Bypasses RLS with service role (server-side only)
2. **Authentication checked** — Each action verifies session via `getUser()`
3. **Tenant isolation** — Server actions filter by `currentUser.tenantId`
4. **Input validation** — Zod schemas for auth; manual validation for business logic
5. **Over-allocation guards** — Payments server action validates before insert

### ⚠️ Gaps
1. **No rate limiting on most actions** — Only auth endpoints have rate limiting
2. **No idempotency keys** — Duplicate form submissions could create duplicate records
3. **No request logging** — Server actions don't log who did what (except audit_log writes)
4. **No CSRF tokens** — Relies on Next.js built-in Same Origin protection
5. **No input length limits** — Some text fields have no max length validation
6. **Inconsistent validation** — Some actions use Zod, others validate manually

### Rate Limiting Status
| Endpoint | Rate Limited | Implementation |
|----------|-------------|----------------|
| sign-in | ✅ | `src/lib/auth/rate-limit.ts` |
| forgot-password | ✅ | `src/lib/auth/rate-limit.ts` |
| reports/generate | ✅ | `src/lib/reports/actions.ts` |
| All other actions | ❌ | Not rate limited |

## Recommendations

### P1
1. **Add rate limiting to all mutating server actions** — Prevent abuse

### P2
2. **Add idempotency keys** for financial operations (invoices, payments)
3. **Add structured request logging** — Who did what, when, from where
4. **Standardize input validation** — Use Zod for all actions

### P3
5. **Consider adding REST API** for future mobile/third-party needs
6. **Add input length limits** for all text fields
