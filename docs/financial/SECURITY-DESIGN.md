# Financial Security Design

> **Status:** Design only. No production code changed.

---

## 1. Authentication

- Supabase Auth (JWT) — unchanged.
- Session handled by `src/lib/supabase/server.ts` (SSR cookies) + `src/proxy.ts` middleware (validates JWT server-side, refreshes cookies, guards dashboard routes).
- Financial pages are behind the dashboard matcher; no anonymous financial access.

---

## 2. Authorization (RBAC)

- App-level: every financial Server Action begins with `requirePermission(module, action)` (`src/lib/auth/authorization.ts`).
- Modules already seeded: `accounting`, `invoices`, `expenses`, `reports`, `payroll`, `audit_log` (013). Phase 8 adds `vat` (or sub-actions under `accounting`).
- Roles: `general_manager`, `admin`, `accountant` (full financial grants), `payroll_officer`, `operations_officer`, `platform_coordinator`, `readonly_auditor` (read-only on most).
- Action vocabulary: `read | create | update | approve | export | print`.

---

## 3. Row-Level Security (RLS)

- **Deny-by-default:** every financial table has the 4-policy pattern (SELECT + INSERT WITH CHECK + UPDATE; no DELETE).
- Tenant isolation via `get_my_tenant_id()` (SECURITY DEFINER). All financial tables carry `tenant_id`; INSERT/UPDATE `WITH CHECK (tenant_id = get_my_tenant_id())` prevents tenant forgery.
- `trial_balance` VIEW uses `security_invoker = true` so RLS of base tables still applies.
- Views for statements (P&L, Balance Sheet) must also be `security_invoker`.

---

## 4. Tenant isolation

- Single tenant today (default UUID `…0001`), but every table is tenant-scoped and RLS-protected, so multi-tenancy can be enabled by simply onboarding more tenants.
- No shared financial data across tenants: customers, invoices, journals, VAT all scoped.

---

## 5. Financial permissions matrix (draft)

| Capability | GM | Admin | Accountant | Payroll officer | Readonly auditor |
|---|---|---|---|---|---|
| CoA manage | ✅ | ✅ | ✅ | — | — |
| Journal post | ✅ | ✅ | ✅ | — | — |
| Journal approve | ✅ | ✅ | ✅ | — | — |
| Invoice finalize | ✅ | ✅ | ✅ | — | — |
| Payments allocate | ✅ | ✅ | ✅ | — | — |
| VAT period finalize | ✅ | ✅ | ✅ | — | — |
| Financial reports read/export | ✅ | ✅ | ✅ | ✅ (payroll only) | ✅ read |
| Audit log | ✅ | ✅ | ✅ | — | ✅ read/export |

---

## 6. Audit logging

- Immutable `audit_log` (007): UPDATE/DELETE blocked by trigger; SELECT-only RLS; writes via service-role `writeAuditLog()`.
- Every financial mutation logs: actor, tenant, module, action, entity type/id, new values.
- Financial events (`financial_events`) provide a second, domain-level trail with idempotency.
- Posted/finalized immutability is enforced at the **DB trigger level** (not just UI) — `JRN001–003` already; same pattern for invoices/VAT periods.

---

## 7. Immutable records

- Posted journals: trigger-blocked edits/deletes; reversal-only.
- Finalized invoices / credit / debit notes: trigger-blocked edits (Phase 5).
- Finalized VAT periods: trigger-blocked edits (Phase 8).
- Corrections: reversal entries, credit/debit notes, VAT adjustments — never in-place UPDATEs.

---

## 8. Secrets handling

- `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY` are **server-only** (`.env.local`, `.env.example` documents "never expose to the browser").
- Service-role admin client is only imported in `"use server"` / server-only modules (`src/lib/supabase/admin.ts`).
- Never pass service-role values to client components.

---

## 9. API / Server Action security

- Server Actions are the only mutation surface; each validates auth + permission + input (Zod schemas where present).
- Rate limiting exists for reports (`rateLimitReports` 10/hour) and auth flows; extend to invoice/payment actions if public.
- Error taxonomy: typed error codes (`src/lib/errors/error-codes.ts`) — extend with `INV/ACC/VAT` codes; DB raises `ENGINE_CODE` exceptions surfaced safely.
- No financial calculation on the client; frontend only displays server-computed values.

---

## 10. Service-role protection

- Admin client bypasses RLS — used only for: cross-table writes, audit inserts, report data collection.
- **Rule:** service-role operations must still pass `requirePermission` first (as existing actions do).
- No client code can call service-role paths (server-only import guard).

---

## 11. Financial transaction protection

- Journal + lines + event inserted atomically (single transaction / DB function) so partial failures cannot occur.
- Payment allocation updates guarded by `chk_allocation_target` (one AR or one AP target) and amount checks.
- Idempotency keys make event replay safe.
- Period-close blocks new postings (both app-level and, in future, DB trigger).

---

## 12. Data protection & mock-data rule

- Development uses **synthetic data only** (demo tenants, mock customers/invoices — never real company, IBAN, VAT, CR, employee or driver info).
- Signed URLs for document/invoice downloads expire (existing pattern, 300s).
- Private storage buckets: no anon read for financial documents (only the driver-application anon-upload exception exists, and it is scoped to a `drafts` folder).
