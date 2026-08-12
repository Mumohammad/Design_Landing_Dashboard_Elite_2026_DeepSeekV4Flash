# Architecture Decisions — EliteDev

This document records accepted technical decisions. Add a new numbered entry for every material decision. Do not overwrite history; supersede a decision explicitly when necessary.

## ADR-001 — Use the approved Next.js template as the visual foundation
- **Status:** Accepted
- **Decision:** Build from the repository’s `nextjs-version` application and retain compatible design primitives, page patterns, and responsive behaviors.
- **Reason:** It provides the approved landing, dashboard, and auth visual baseline while allowing the domain to be replaced.
- **Consequences:** Generic demo content and unrelated sample routes are removed/refactored incrementally; the template is not treated as a production domain model.

## ADR-002 — Single tenant now, multi-tenant ready by schema and RLS
- **Status:** Accepted
- **Decision:** Seed one Elite Development organization; include `organization_id` in every tenant-owned table and enforce organization membership/RLS from the first migration.
- **Reason:** Avoid a costly future redesign while keeping current UX simple.
- **Consequences:** No organization-switcher or billing is required initially. No hardcoded organization IDs in production business logic.

## ADR-003 — Supabase PostgreSQL is the source of truth
- **Status:** Accepted
- **Decision:** Use Supabase PostgreSQL, Auth, Storage, and RLS. UI state is transient only.
- **Reason:** The system requires durable relationships, auditability, access control, document storage, and future SaaS isolation.
- **Consequences:** No mock persistence, no localStorage business data, and no frontend-only critical workflows.

## ADR-004 — Server-authoritative mutation and finance model
- **Status:** Accepted
- **Decision:** Protected Server Actions/Route Handlers perform validation, authorization, financial calculation, state transition, persistence, and audit actions.
- **Reason:** Client code cannot be trusted for financial totals, approval states, permissions, or tenant scope.
- **Consequences:** Client forms revalidate on server; money uses PostgreSQL numeric or integer halalas; no JavaScript floating-point authority.

## ADR-005 — Arabic/English and RTL/LTR are core architecture
- **Status:** Accepted
- **Decision:** Implement localized routes or equivalent documented locale architecture, Cairo/Geist(or Inter), `lang`/`dir`, complete message catalogs, and logical CSS.
- **Reason:** Arabic is a primary Saudi operating language, not an afterthought.
- **Consequences:** Every new component must be direction-tested. No hardcoded left/right positioning where logical properties apply.

## ADR-006 — Authorization combines RBAC and RLS
- **Status:** Accepted
- **Decision:** Model roles, permissions, role permissions, user role assignments, organization membership, server permission checks, and database RLS.
- **Reason:** Hiding UI elements is not security; tenant and action isolation must survive direct requests.
- **Consequences:** Every module defines read/create/update/delete/approve/export/print/manage needs. RLS must deny by default.

## ADR-007 — Audit history is immutable in normal UI
- **Status:** Accepted
- **Decision:** Critical business actions write audit events; normal users cannot edit/delete audit records.
- **Reason:** Payroll, documents, permissions, and operational history require traceability.
- **Consequences:** Sensitive fields must be minimized/redacted in audit views; audit table policies are restrictive.

## ADR-008 — Payroll is ledger-first and snapshot-based
- **Status:** Accepted
- **Decision:** Payroll is modeled as periods, rule versions, runs, lines, itemized ledger entries, review/approval/payment/lock states, and immutable approved snapshots.
- **Reason:** Manual auditable operations are safer than opaque spreadsheet-only or client-only calculations.
- **Consequences:** Approved/paid/locked values cannot be edited directly; corrections use a controlled reversal/correction workflow. Exact salary/allowance/GOSI rules need business approval before implementation.

## ADR-009 — Documents are generated from versioned data snapshots
- **Status:** Accepted
- **Decision:** Generated official documents store their template version, input snapshot, document number, output reference, generation metadata, and verification identity.
- **Reason:** Historical documents must remain reproducible and auditable after source records change.
- **Consequences:** Public verification shows only safe authenticity metadata. Restricted source files use signed URLs.

## ADR-010 — ZATCA is readiness, not an unverified claim
- **Status:** Accepted
- **Decision:** Model invoice fields and secure integration boundaries; defer signing/submission until verified requirements, credentials, and approved workflow exist.
- **Reason:** UI alone does not create legal/tax compliance.
- **Consequences:** Do not market or label the product as ZATCA compliant until implemented and independently verified.

## ADR-011 — Design quality is operational, not ornamental
- **Status:** Accepted
- **Decision:** Preserve template quality with fixed Elite palette and sidebar gradient, data-dense tables, restrained motion, and readable surfaces.
- **Reason:** Logistics users need speed, clarity, and professional trust.
- **Consequences:** No neon/crypto patterns, excessive blur, decorative metrics, or global gradient buttons.

## ADR-012 — Print layouts are dedicated views
- **Status:** Accepted
- **Decision:** Reports and official documents use dedicated print CSS/PDF layouts; dashboard chrome never prints.
- **Reason:** A raw dashboard print is unsuitable for official documents and signatures.
- **Consequences:** Payslips target one A4 page and require print testing in both languages.

## ADR-013 — Client-side locale context is the documented locale design (Phase 0 baseline)
- **Status:** Accepted (Phase 0 baseline; revisit if SEO/SSR-localization needs emerge)
- **Date:** 2026-07-15
- **Context:** The template already implements Arabic/English via a React `LocaleProvider` context (`src/contexts/locale-context.tsx`) + `localStorage` (`elite-locale`) + a typed catalog (`src/lib/i18n/translations.ts`), and sets `document.documentElement.lang`/`dir` in an effect. There is no `/[locale]` route segment. The master prompt permits "robust locale routing **or an equally documented locale design**."
- **Decision:** For Phase 1, keep and harden the context-based design (typed catalogs, `useTranslation()` hook, persisted preference) rather than introducing `[locale]` segment routing. The locale preference in `localStorage` stores only a UI preference (not business data), so it does not violate the no-localStorage-business-data rule.
- **Alternatives considered:** (a) Migrate to `[locale]` segment routing for per-locale URLs and SSR-correct `lang`/`dir`. Rejected for Phase 1 due to rewrite cost across the existing tree; can be revisited later. (b) `next-intl` middleware-based routing. Same cost concern.
- **Consequences:**
  - Must fix the SSR/CSR `lang`/`dir` mismatch: `src/app/layout.tsx` currently hardcodes `lang="ar" dir="rtl"` while the client effect overrides it. Default must match and be deterministic.
  - URLs are not locale-segmented; switching language does not change the URL. Acceptable for an internal single-tenant operations tool.
  - Every new string must be added to the typed `TranslationStrings` catalog; hardcoded Arabic/English in components is treated as a defect to remove.
  - `dir` flipping must use logical CSS properties; new components are direction-tested in both LTR and RTL.
- **Approval required:** No.

## ADR-014 — Treat existing EliteDev scaffolding as non-functional placeholders to replace phase-by-phase
- **Status:** Accepted
- **Date:** 2026-07-15
- **Context:** Phase 0 inspection found a prior partial re-skin: EliteDev-flavored demo data (`src/lib/demo/*`), typed i18n catalogs, and stub modules for auth/permissions/tenancy/supabase. However these are **dead or unsafe**: `getCurrentUser()` returns a hardcoded mock, `can()` always returns `true`, `resolveTenant()` returns a hardcoded tenant, the `lib/supabase/{client,server}.ts` clients are unused and read mismatched env names, and `src/lib/supabase/middleware.ts` is dead code (the active `src/middleware.ts` does only trivial redirects). Live dashboard pages read static arrays, not Supabase.
- **Decision:**
  - Regard all `src/lib/demo/*`, `src/lib/services/auth.ts`, `src/lib/permissions/can.ts`, `src/lib/tenancy/tenant.ts`, and the current `lib/supabase/*` wrappers as **scaffolding to replace**, not a working implementation. No production decision may rely on them.
  - Do not hardcode a production organization ID; the `elite-development` default in `resolveTenant()` is a placeholder to be removed when real tenant/membership lookup lands (Phase 2).
  - Remove the dead `src/lib/supabase/middleware.ts` and consolidate route protection into the active `src/middleware.ts` in Phase 2 (using `@supabase/ssr` cookie sessions).
  - Standardize env names to the contract (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) and add `.env.example` in Phase 2; the service-role key stays server-only.
  - Remove template-only routes/components (`dashboard-2`, `calendar`, `chat`, `mail`, `tasks`, `faqs`, `pricing`, theme-customizer, auth `-2/-3` variants, etc.) on the phase that owns each area to keep diffs coherent.
- **Alternatives considered:** Wholesale rewrite of `src/`. Rejected — violates "keep changes minimal, coherent, reversible" and discards reusable shell/UI primitives.
- **Consequences:** Until each phase replaces a stub, that area remains client-only static data with no auth/RLS guarantees. The worklog must record each replacement. Financial demo values are JS `number` and must become server-side `numeric`/integer-halala from Phase 3 onward.
- **Approval required:** No for documentation/planning; yes before any migration (Phase 2) and before payroll rules (Phase 5).

## ADR-015 — AIDesigner UI lock is the final visual override
- **Status:** Accepted
- **Date:** 2026-07-19
- **Context:** v2.0 master prompt adds an "ABSOLUTE AIDesigner UI lock" section declaring the approved Enterprise SaaS Logistics Dashboard design as immutable and the highest-priority visual rule in the entire master file. This supersedes earlier generic visual guidance (including ADR-011's "no global gradient buttons" wording where the two conflict). The lock fixes: color tokens (light/dark HSL), brand anchors (elite-blue #1E5A99, elite-orange #E87D3E with 50–900 scales), the sidebar gradient (linear-gradient(180deg, #0c2d4a 0%, #0f3a5e 30%, #122f4a 70%, #0a1f33 100%)), radius scale (cards/dialogs rounded-2xl; controls rounded-lg/rounded-xl), spacing rhythm (p-6, space-y-6, gap-4 KPI, gap-3 toolbar), the split-screen login, the EnterpriseModulePage pattern (header → KPI cards → toolbar → data table → pagination → dialog), the gradient footer, the command palette, the gradient avatar pattern, and group-hover row actions.
- **Decision:** Adopt the AIDesigner UI lock as the authoritative visual specification. When any older section (including ADR-011) conflicts with the approved AIDesigner design, the AIDesigner design wins for all visual implementation decisions. Business logic, DB logic, workflows, security rules, compliance, storage, migrations, APIs, audit, and Saudi-specific business rules from the rest of the master file remain fully in force. Do NOT redesign, reinterpret, modernize, simplify, or replace the approved design with another visual system.
- **Alternatives considered:** (a) Keep ADR-011's "no gradient buttons" wording as authoritative. Rejected — v2.0 explicitly defines approved elite-blue/elite-orange gradient CTAs and supersedes that wording. (b) Treat Design DNA as advisory only. Rejected — v2.0 declares it immutable.
- **Consequences:** Primary CTA uses elite-blue gradient; Quick Actions uses elite-orange gradient; sidebar gradient is fixed; login stays split-screen; EnterpriseModulePage pattern is mandatory for all CRUD modules; gradient avatar pattern is mandatory for users. Earlier "no decorative shapes" guidance is superseded by the approved decorative KPI circle treatment (opacity-[0.06]). Phase 1 file plan must implement these tokens; ADR-011's "no global gradient buttons" wording is superseded only where the AIDesigner lock explicitly defines approved gradients.
- **Approval required:** No for documentation; Phase 1 implementation requires the normal phase approval gate.

## ADR-016 — Design DNA token system (elite-blue / elite-orange scales + sidebar gradient as tokens, not hardcoded values)
- **Status:** Accepted
- **Date:** 2026-07-19
- **Context:** Phase 0 inspection found Elite colors exist only as inline hardcoded values (`bg-[#061a2b]`, `bg-[#1E5A99]` in `app-sidebar.tsx`) — not as a token system. The v2.0 Design DNA addition requires elite-blue and elite-orange as full 50–900 Tailwind scales, the sidebar gradient as a reusable token/utility, CSS custom properties for all semantic tokens (background/foreground/card/primary/secondary/muted/destructive/border/radius) in both light and dark mode, glassmorphism utility classes (.glass, .glass-dark), and shadow utilities (.shadow-modern, .shadow-modern-lg, .hover-lift, .gradient-elite-blue, .gradient-elite-orange).
- **Decision:** Implement the Design DNA token system in Phase 1: add CSS custom properties to `src/app/globals.css` (light `:root` + dark `.dark`), add elite-blue and elite-orange Tailwind scales (via `@theme` block since this project uses Tailwind v4 with no `tailwind.config.*`), add the fixed sidebar gradient as a utility/token (not inline), add the glassmorphism + shadow utility classes, and replace all inline hardcoded Elite hex values with tokens. Inter remains primary Latin font, Cairo remains Arabic font (font switching by `dir`).
- **Alternatives considered:** (a) Keep inline hardcoded hex values. Rejected — unmaintainable, violates Design DNA "do not hardcode colors outside the defined palette". (b) Use a `tailwind.config.ts` for the scales. Rejected — project is Tailwind v4 with `@theme` in `globals.css`; introducing a config file would diverge from the established v4 setup.
- **Consequences:** `globals.css` gains `@theme` block with elite-blue/elite-orange scales; semantic tokens in `:root` and `.dark`; sidebar uses a token/utility for its gradient; `app-sidebar.tsx` and `logo.tsx` inline hex values are replaced with tokens. ADR-013 (client-side locale) remains the locale design; the font-by-dir switch must be added so Cairo applies under RTL. The global 200ms `*` transition must be preserved.
- **Approval required:** No for documentation; Phase 1 implementation requires the normal phase approval gate.

## ADR-017 — Accounting & Finance is official Module 9
- **Status:** Accepted
- **Date:** 2026-07-19
- **Context:** v2.0 promotes Accounting & Finance from an implicit capability (referenced only via payroll journal entries and ZATCA-readiness) to a first-class module numbered 9 in the official 1–18 module list. Scope: chart of accounts, accounting periods, journal entries, source-linked immutable postings, AR, AP, customer/supplier finance references, rider settlement accounting linkage, VAT output ledger, VAT input ledger, bank accounts and reconciliation, payment allocation, aging reports, trial balance, P&L, balance sheet foundation, audit trail for every finance action, period close rules, reversal-based correction flows for posted entries.
- **Decision:**
  - Add Accounting & Finance as Module 9 with the scope above. It must look native to the same AIDesigner app shell (same sidebar, header, table patterns, cards, dialogs, spacing, typography, color system) — NOT visually isolated.
  - Saudi finance rules apply: separate output VAT from input VAT; never silently reduce customer invoice totals by purchase invoices or input VAT; immutable posting plus reversal-based correction after posting; ZATCA-relevant invoice data source-linked and auditable; company profile/VAT rate/logo/QR/invoice identity DB-driven not hardcoded.
  - Minimum submodules: Chart of Accounts, Journal Entries, Receivables, Payables, Customer Statements, Supplier Statements, Settlement Batches, Bank Reconciliation, VAT Center, Financial Reports, Accounting Period Close, Finance Settings.
- **Alternatives considered:** (a) Defer accounting indefinitely and keep only payroll journal entries. Rejected — v2.0 explicitly adds it as a first-class module. (b) Build accounting as a separate visual system. Rejected — v2.0 requires it look native to the same app shell.
- **Consequences:** Phase 2+ migration planning must include accounting schema (chart of accounts, journal entries, postings, VAT ledgers, bank accounts, reconciliation, period close). The Phase 5 payroll `journal_entries` table (already in v2.0) becomes the integration hook into Module 9. Sidebar navigation gains an Accounting pillar. Implementation of Accounting full CRUD is deferred to a later phase (tentatively after Phase 6) but the module is numbered, scoped, and reserved now. ADR-004 (server-authoritative mutation and finance model) and ADR-008 (payroll ledger-first) extend naturally to accounting postings.
- **Approval required:** Yes before any accounting migration (Phase 2+ gate). No for documentation/scoping.

## ADR-018 — Official module numbering is 1–18
- **Status:** Accepted
- **Date:** 2026-07-19
- **Context:** v1.0 organized the platform around 8 "enterprise modules" (Drivers, Vehicles, Violations, Payroll, Orders & Platforms, Attendance, Dashboard & Reports, Settings & Auth) plus a separate "16 core modules" list in the replication prompt. This created ambiguity. v2.0 declares an official 1–18 numbering that consolidates both lists and inserts Accounting as Module 9.
- **Decision:**
  - Adopt the official 1–18 numbering: 1 Drivers, 2 Vehicles, 3 Attendance, 4 Payroll, 5 Violations & Penalties, 6 Expenses, 7 Maintenance, 8 Invoices, 9 Accounting & Finance, 10 Platforms, 11 HR, 12 Reports, 13 Templates, 14 Users, 15 Roles, 16 Audit Log, 17 Security, 18 Settings.
  - The earlier M1–M8 numbering from v2.0's "production corrections" section refers to the original 8-module grouping (M1=Drivers, M2=Vehicles, M3=Violations, M4=Payroll, M5=Orders & Platforms, M6=Attendance, M7=Dashboard & Reports, M8=Settings & Auth) and is preserved only for traceability when reading v2.0 correction notes.
  - All new documentation, sidebar groups, route folders, and migration references use the 1–18 numbering.
- **Alternatives considered:** (a) Keep the v1.0 8-module grouping. Rejected — does not match the expanded scope including Accounting. (b) Keep both numberings active without mapping. Rejected — causes ambiguity.
- **Consequences:**
  - Sidebar pillar groups, route folders, and migration file naming should align to the 1–18 list where practical.
  - The v2.0 corrections (M1–M8) are mapped to their 1–18 equivalents in `docs/elite-master-prompt-v2.md`.
  - Existing Phase 3–7 plans are renumbered to match (Phase 3 covers Modules 1–2 + dashboard; Phase 4 covers Modules 3,5,6,7; Phase 5 covers Module 4; Phase 6 covers Modules 11,13,12; Module 9 Accounting is tentatively a later phase).
- **Approval required:** No.

## ADR-019 — Adopt v2.0 production correction set across all modules
- **Status:** Accepted
- **Date:** 2026-07-19
- **Context:** v2.0 documents 19 critical/high production corrections across the original 8 modules plus platform-wide standards. These are not optional polish — they address concurrency bugs (leave balance race, violation_ref race), financial correctness (orders proration, COD reconciliation, deduction rollback), Saudi compliance (Hijri holidays, Saudi minimum wage, WPS SIF, Saudi IBAN checksum), security (RLS INSERT WITH CHECK, auth.users sync trigger, rate limiting), and data integrity (odometer fraud, odometer regression, structured handover forms, vehicle_active_documents view, dispute window enforcement).
- **Decision:** Adopt the full v2.0 correction set as the canonical behavior for every affected module. Key corrections by area:
  - **Payroll proration (M1/M4):** orders target is prorated via `Math.ceil((monthly_target / working_days_target) * working_days_actual)`. NEVER compare against the flat monthly target. Identical formula in Drivers and Payroll modules.
  - **COD reconciliation (M1):** `driver_cod_sessions` table tracks cash collected vs submitted; unresolved shortfalls become payroll deductions; risk flags on drivers.
  - **Deduction ledger rollback (M3/M4):** `rollbackPayrollDeductions()` rolls ledger rows to pending, rolls violations to resolved, writes per-violation audit. `cancelPayrollPeriod()` MUST call it.
  - **Reference numbers via SEQUENCE (M3):** `violation_ref` uses a PostgreSQL SEQUENCE, never `COUNT(*)+1`.
  - **Hijri holidays (M6):** `public_holidays` table with `calendar_type` (gregorian|hijri|fixed); Eid al-Fitr (hijri 10/1) and Eid al-Adha (hijri 12/10), 5-day duration; `hijri-converter` package.
  - **Leave concurrency (M6):** `SELECT ... FOR UPDATE` on leave request + balance rows prevents double-approval.
  - **working_day_value (M6):** `GENERATED ALWAYS AS` computed column; API never submits it.
  - **Auth.users sync (M8):** trigger on `auth.users` AFTER UPDATE OR DELETE keeps custom `users` table status in sync.
  - **RLS INSERT WITH CHECK (M8):** `get_my_tenant_id()` helper + `WITH CHECK (tenant_id = get_my_tenant_id())` on ALL tenant-owned INSERT policies.
  - **Rate limiting (M8):** slowapi on login (10/min), forgot-password (3/hour), 2fa verify (5/min), reports generate (10/hour), orders import (30/hour).
  - **Middleware matcher (M8):** narrowed to dashboard routes only; never runs on `_next/static`.
  - **Odometer fraud (M2):** DB trigger blocks odometer regression (raises VEH003).
  - **Structured handover forms (M2):** `vehicle_handover_forms` table replaces loose `handover_photos[]`.
  - **HungerStation distance rate card (M5):** `rate_card` JSONB + `calculateSessionRevenue()` (base 5.00, 0.50/km, first 1km free, 20km cap, multi-order discount 1.50).
  - **NULL shift_label (M5):** COALESCE in unique partial index, not raw UNIQUE.
  - **Report job queue (M7):** async generation via FastAPI BackgroundTasks, client polls status, 24h expiry.
  - **Cache invalidation (M7):** event-driven via Supabase Realtime broadcast.
  - **Action item scoring (M7):** severity + age + financial + scale, sorted by computed score.
  - **NAJM external fines (M3):** `external_fine_imports` staging table, manual now, API-ready later.
  - **WPS SIF (M4):** defined format with Saudi bank codes, currency 682.
  - **Saudi minimum wage (M4):** advisory flag for SA nationals below 4000 SAR.
  - **Driver salary history (M1):** `driver_salary_history` table for payslip audit trail.
  - **Soft-delete partial indexes:** `idx_{table}_active` pattern platform-wide.
  - **Storage buckets:** 9 buckets defined with sizes, expiries, and RLS.
  - **Error code taxonomy:** AUTH/DRV/PAY/VIO/VEH/ATT/ORD prefixes.
- **Alternatives considered:** (a) Adopt corrections incrementally per phase without an umbrella ADR. Rejected — risks forgetting or partially applying them. (b) Defer all corrections to a single late "hardening" phase. Rejected — several are correctness/security bugs that must be in the initial implementation of each module, not retrofits.
- **Consequences:**
  - Each phase's migration and code plan MUST incorporate the v2.0 corrections relevant to its modules.
  - The worklog must record each correction as it lands.
  - The full correction detail lives in `docs/elite-master-prompt-v2.md` section 5 (platform-wide) and section 6 (per-module).
  - Where a correction needs business approval (e.g. exact payroll rule numbers, waiver thresholds), it is flagged at the relevant phase gate per ADR-008.
- **Approval required:** No for documentation/adoption. Yes before the first migration that implements any correction (Phase 2 gate) and yes before payroll rule implementation (Phase 5 gate per ADR-008).

## Decision template
```md
## ADR-XXX — Title
- **Status:** Proposed | Accepted | Superseded | Rejected
- **Date:** YYYY-MM-DD
- **Context:**
- **Decision:**
- **Alternatives considered:**
- **Consequences:**
- **Approval required:** Yes/No; owner
```
