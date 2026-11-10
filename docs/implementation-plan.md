# EliteDev Implementation Plan

## Status
- Product: Elite Development Enterprise Logistics Platform
- Mode: Single-tenant now; multi-tenant-ready architecture
- Repository foundation: approved Shadcn dashboard/landing Next.js template (partially re-themed to EliteDev)
- Current phase: 0 — repository inspection (COMPLETE; awaiting Phase 1 approval)
- Phase owner: GLM-5.2 coding agent with human approval gates
- Last updated: 2026-07-15

## Product objective
Build a secure bilingual Arabic/English web operating system for Elite Development’s Saudi 3PL business. The driver is the central operational entity, connected to vehicles, assignments, attendance, violations, expenses, advances, maintenance, payroll, documents, and performance.

## Delivery principles
- Database-first, audit-first, secure-by-default
- Visual parity with the approved template; business domain fully replaced
- Single tenant UX; `organization_id` and RLS on all tenant-owned data
- Supabase PostgreSQL is source of truth
- No mock persistence or client-authoritative financial/business state
- Financial, legal, HR, and access controls are server validated and auditable
- Arabic RTL and English LTR are built together, not retrofitted

## Phase 0 — inspect and baseline
### Goal
Understand the fork before production modifications.

### Permitted work
- Inspect package manager, package.json, source tree, routes, configuration, theme, UI primitives, existing sample content, and auth/data code.
- Create/update only documentation in `docs/`.
- Run safe read-only commands and existing lint/typecheck only if no setup changes are required.

### Prohibited work
- No production code changes
- No new dependencies
- No Supabase migration creation/application
- No secrets or environment changes
- No destructive commands

### Required output
- Existing architecture and relevant files
- Components/routes to preserve, replace, or remove
- Dependency gap analysis
- i18n/RTL, auth, database, security, and design risks
- Proposed exact Phase 1 file plan

### Acceptance criteria
- Repository facts are verified from files
- Documentation has been updated
- No production source changes

## Phase 0 — verified findings (2026-07-15)

### Stack and tooling (verified from files)
- Package manager: **pnpm** (`pnpm-lock.yaml`, lockfileVersion 9.0). No npm/yarn lockfiles.
- Runtime/framework: **Next.js 16.1.1** (App Router), **React 19.2.3**, **TypeScript 5.9.3** with `strict: true`.
- Styling: **Tailwind CSS v4** (`@tailwindcss/postcss`, no `tailwind.config.*`; theme tokens live in `src/app/globals.css` via `@theme`/CSS variables). `tw-animate-css` present.
- UI: shadcn/ui **new-york** style (`components.json`, `rsc: false`, baseColor `neutral`, cssVariables on), Lucide icons. Aliases `@/components`, `@/lib`, `@/components/ui`, `@/hooks` confirmed in `tsconfig.json` paths and `components.json`.
- `tsconfig.json` `lib` is `["dom","dom.iterable","es6"]` — note ES2017 target / es6 lib; may want es2020+ for `numeric`/`BigInt` work in Phase 5.
- No test framework configured (no vitest/jest/playwright in `package.json`, no script). No `.env.example`. `supabase/migrations/` contains only `.gitkeep`.

### Already-present EliteDev scaffolding (non-functional placeholders)
A previous pass re-skinned the template toward EliteDev but left everything as static/client placeholders:
- `src/lib/i18n/` — `translations.ts` (ar/en catalogs), `types.ts` (strongly typed `TranslationStrings`). Consumed via `useTranslation()` hook → `LocaleProvider` context. Catalogs cover app/nav/pages/common/dashboard/settings only — far from complete.
- `src/contexts/locale-context.tsx` — client-side locale via React context + `localStorage` key `elite-locale`; sets `document.documentElement.lang`/`dir` in an effect. Note: root `layout.tsx` still hardcodes `lang="ar" dir="rtl"` (no `[locale]` segment routing).
- `src/lib/supabase/{client,server}.ts` — `createClient` wrappers exist but are **dead code** (imported nowhere). They read non-standard env names: client uses `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` (correct), server uses `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (does NOT match env contract which expects `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`).
- `src/lib/services/auth.ts` — `getCurrentUser()` returns a **hardcoded mock user** (`admin@elite-dev.com`).
- `src/lib/permissions/can.ts` — `can()` **always returns `true`**; module/action enums are a subset only (missing `export`/`print`/`manage`, and modules like `assignments`, `invoices`, `hr`, `audit`, `documents`, `platforms`).
- `src/lib/tenancy/tenant.ts` — `resolveTenant()` returns a **hardcoded default tenant** `elite-development`.
- `src/lib/validation/schemas.ts` — only `driverSchema` and `payrollSchema` (loose; payroll status enum is `pending|approved|paid`, not the full lifecycle).
- `src/lib/demo/*.ts` — static in-memory arrays: `drivers`, `vehicles`, `attendance`, `expenses`, `maintenance`, `payroll`, `users`, `dashboard`. These are the actual data source for the live pages (not Supabase).
- `src/types/app.ts` — minimal `User`/`Tenant`/`Locale` types.

### Middleware situation (important)
Two middleware files exist; **only `src/middleware.ts` is active** in Next.js:
- `src/middleware.ts` (active) — trivial redirect-only (`/login`→`/auth/sign-in`, `/register`→`/auth/sign-up`). Does **no** auth/session/tenant enforcement. Matcher excludes `api|_next/static|_next/image|favicon.ico`.
- `src/lib/supabase/middleware.ts` (DEAD — never imported; Next ignores it) — calls `resolveTenant()` and sets `x-tenant-id` header, matcher lists dashboard routes. This is the intended protected-route guard but it is not wired up.
- `next.config.ts` also declares a legacy `i18n` block (`locales:["ar","en"]`, `defaultLocale:"ar"`). On App Router this legacy field is not the locale mechanism in use; locale is handled client-side instead. A `/home`→`/dashboard` redirect exists.

### Design tokens / theme (verified)
- `globals.css` `:root` is still the **default shadcn neutral palette**: `--primary` grayscale `oklch(0.205 0 0)`, `--sidebar` light `oklch(0.985 0 0)`. **Elite Blue `#1E5A99`, Elite Orange `#E87D3E`, and the fixed navy sidebar gradient are NOT present in CSS tokens.**
- Elite colors appear only inline: `app-sidebar.tsx` sets `bg-[#061a2b]` and a logo chip `bg-[#1E5A99]`. This is hardcoding, not a token system.
- Fonts: `src/lib/fonts.ts` exports `Inter` (`--font-inter`) and `Cairo` (`--font-cairo`) via `next/font/google`; root layout applies both variables. Master prompt permits Geist **or** Inter → Inter is acceptable; Cairo satisfies Arabic requirement. `globals.css` maps `--font-sans: var(--font-inter)` only (Cairo is loaded but not switched in by `dir`).
- `tabular-nums` used in template `section-cards.tsx` (good) but not systematically applied to financial KPIs.

### Route inventory and classification
Routes live under two route groups: `src/app/(auth)` and `src/app/(dashboard)`, plus `src/app/landing`, root `src/app/page.tsx` (client redirect → `/landing`), and `src/app/{layout,loading,not-found,globals.css,favicon.ico}`.

**(auth) — all English-only, template forms, NO Supabase, NO bilingual:**
- `sign-in` (+ `-2`, `-3` variants), `sign-up` (+ `-2`,`-3`), `forgot-password` (+ `-2`,`-3`), `errors/{forbidden,not-found,unauthorized,internal-server-error,under-maintenance}`.
- `sign-in/components/login-form-1.tsx`: RHF+Zod, but `<form action="/">` (no Server Action), prefilled `test@example.com`/`password`, and a **nonfunctional "Login with Google" button** (forbidden by master prompt). All copy English. Auth `layout.tsx` metadata still says "ShadcnStore".
- No `reset-password`, no `accept-invite` route (both required). Sign-up exists but master prompt requires **no public self-registration** (reuse design for invite acceptance).

**(dashboard) — pages:**
- **Demo-data tables (hardcoded Arabic strings, mixed with `t.nav.*` title):** `drivers`, `drivers/[id]`, `vehicles`, `attendance`, `expenses`, `maintenance`, `payroll`.
- **PlaceholderPage stubs:** `violations`, `platforms`, `invoices`, `hr`, `templates`, `reports`, `roles`, `audit-log`, `security`.
- **Template remnants (unrelated SaaS modules):** `dashboard` (still template `SectionCards` "Total Revenue $1,250 / New Customers" + `data.json`), `dashboard-2`, `calendar`, `chat`, `mail`, `tasks`, `faqs`, `pricing`, `users` (template `data.json` with `plan`/`billing` fields), `settings/*` (account/appearance/billing/connections/notifications/user).
- Missing required routes: `assignments` (no sidebar entry, no page), `documents`, `verify/[documentType]/[documentId]`, payroll detail `[id]`, vehicles detail `[id]` (vehicles page links to `/vehicles/[id]` which does **not** exist → 404).
- `drivers/[id]/page.tsx` uses the **old synchronous `params: { id: string }`** signature; Next 16 requires `params` to be a `Promise`. Build/type risk.

**Shell components (preserve):** `components/app-sidebar.tsx` (Elite-styled, bilingual nav groups), `site-header.tsx` (sidebar trigger, command search via `⌘K`, language toggle, mode toggle), `command-search.tsx`, `nav-main.tsx`, `nav-user.tsx`, `sidebar-notification.tsx`, `logo.tsx` (generic glyph — replace later), full `components/ui/*` primitive set, `components/ui/sidebar.tsx`.
**Shell components (template, removable):** `theme-customizer/*`, `config/theme-*`, `landing/mega-menu.tsx`, `pricing-plans.tsx`, `upgrade-to-pro-button.tsx`, `color-picker.tsx`, `image-3d.tsx`, `dot-pattern.tsx` and the original `landing/components/*` (hero/features/testimonials/team/blog/logo-carousel/pricing/stats/cta) which are superseded by `landing-page-content.tsx`.

### Dependency gap analysis (vs required architecture)
Already satisfied: `next`, `react`, `react-dom`, `typescript` (strict), `tailwindcss` v4, shadcn primitives (radix), `lucide-react`, `@tanstack/react-table`, `react-hook-form` + `@hookform/resolvers` + `zod`, `recharts`, `zustand`, `date-fns`, `sonner` (toasts), `vaul` (drawer/sheet), `cmdk` (command palette), `@supabase/supabase-js`.
**Gaps to resolve in the relevant phase (do NOT install in Phase 0):**
- `@supabase/ssr` — required for cookie-based server/client/middleware Supabase clients in App Router (Phase 2). The current bare `createClient` in `lib/supabase/*` does not manage the session cookie and is dead code.
- `framer-motion` — required "only for restrained animation" (Phase 1+). Currently absent.
- `qrcode` (or equivalent) — for QR generation on payslips/documents (Phase 5/6).
- Export libraries (CSV/Excel) and print/PDF tooling — Phase 6 (reports/payslips). No formatter present.
- Test framework (e.g., `vitest`) — not present; payroll determinism tests require one (Phase 5).
- No ESLint rule enforcing `no-explicit-any` beyond `next/typescript` defaults; master prompt forbids `any` in domain code.

### Security / data / i18n risks
- **No authentication or authorization anywhere.** All dashboard routes are client components reading static demo arrays; no RLS, no server actions, no audit. The active middleware does not protect routes.
- **Locale is client-only** (context + `localStorage`), with `lang`/`dir` set post-hydrate. SSR always renders `lang="ar" dir="rtl"` regardless of preference → SSR/CSR `lang`/`dir` mismatch and no per-locale URL. Acceptable under "documented locale design" but must be documented (see ADR-013) and the SSR default must be correct.
- **Env contract mismatch** + **no `.env.example`**: server client reads `SUPABASE_URL` instead of `NEXT_PUBLIC_SUPABASE_URL`; service-role usage would bypass RLS — must remain strictly server-side.
- **Financial values are JS `number`** in demo data (`salary`, `amount`) and rendered via `.toLocaleString()` — violates the decimal-safe rule for any future authoritative use (relevant from Phase 3 onward).
- **Hardcoded Arabic** in pages bypasses the i18n catalog; English rendering of those pages is broken (title localizes, body does not).
- **Dead/duplicate middleware** and a legacy `next.config.ts i18n` block create confusion about the active locale/auth strategy.

### Acceptance criteria status
- Repository facts verified from files: ✅
- Documentation updated: ✅ (this section + ADR-013/014 + worklog)
- No production source changes: ✅

## Phase 1 — visual and localization foundation
### Scope
- Elite brand tokens, typography, dark/light support where compatible
- Arabic/English locale architecture and true RTL/LTR
- Dashboard shell: sidebar, header, mobile drawer, command palette boundary, profile menu
- Landing page and auth UI matching approved reference quality
- Replace visible generic demo copy with EliteDev logistics language

### Explicit exclusions
- No business CRUD persistence
- No public signup
- No production Supabase migrations unless Phase 2 is approved

### Acceptance criteria
- Landing, sign-in, forgot/reset password, accept-invite UI routes render
- Responsive at 375/768/1024/1440
- RTL correctly flips logical layout
- No generic template user-facing copy in implemented routes
- Lint/typecheck pass

### Proposed exact Phase 1 file plan (UI-only; no persistence)
**Brand & theme tokens**
- UPDATE `src/app/globals.css`: add `--color-elite-blue` / `--color-elite-orange`, map `--primary`→Elite Blue, apply fixed navy sidebar gradient to `--sidebar*`, add `.dir-rtl`/`.dir-ltr` font switching (Cairo/Inter), scope `tabular-nums` utility for KPIs, keep dark/light.
- UPDATE `src/lib/fonts.ts`: keep Inter+Cairo; document Geist option. Ensure Cairo is applied under RTL.
- UPDATE `src/components/app-sidebar.tsx`: replace inline `bg-[#061a2b]`/`bg-[#1E5A99]` hardcoding with tokens; keep nav groups; add missing **Operations→Assignments** entry; align with 260px/68px spec (already ~16rem).
- REPLACE `src/components/logo.tsx` with an EliteDev brand mark (current is a generic cart glyph).

**Locale / RTL**
- UPDATE `src/app/layout.tsx`: derive `lang`/`dir` from locale provider instead of hardcoded `lang="ar" dir="rtl"` (avoid SSR/CSR mismatch). Keep providers.
- EXPAND `src/lib/i18n/{translations.ts,types.ts}` with full catalogs for landing, auth, all module headings, table headers, statuses, empty/loading/error states, buttons.
- KEEP `src/contexts/locale-context.tsx` + `useTranslation()` (documented locale design per ADR-013).

**Landing**
- UPDATE `src/app/landing/landing-page-content.tsx`: keep structure, route `useTranslation()`, replace fabricated metrics (+18% etc.) with real capability copy, fix dead `/login`→`/auth/sign-in` links.
- REMOVE template `src/app/landing/components/*` superseded by the above (hero/features/testimonials/team/blog/logo-carousel/pricing/stats/cta) and `components/landing/mega-menu.tsx`, `pricing-plans.tsx`, `upgrade-to-pro-button.tsx`.

**Auth UI (split-screen, bilingual, no social login)**
- UPDATE `src/app/(auth)/layout.tsx`: fix "ShadcnStore" metadata; add premium split-screen shell.
- UPDATE `src/app/(auth)/sign-in/components/login-form-1.tsx`: bilingual, remove Google button + prefilled creds, remove `<form action="/">`, add loading/error/password-visibility (still no real auth until Phase 2).
- UPDATE `forgot-password` form + page to bilingual. RENAME/ADD `reset-password` and `accept-invite` (reuse sign-up design) routes; REPURPOSE `sign-up*` into `accept-invite` (no public self-registration).
- DELETE variant duplicates `sign-in-2/3`, `sign-up-2/3`, `forgot-password-2/3`.

**Shell + dashboard chrome**
- UPDATE `src/app/(dashboard)/dashboard/page.tsx` + `section-cards.tsx`: remove template SaaS KPIs/copy; bilingual placeholders for Elite KPIs (no real data until Phase 3).
- KEEP `site-header.tsx` (lang toggle + ⌘K), `command-search.tsx`, `nav-main/nav-user`, `components/ui/*`.

**Explicitly deferred (not Phase 1):** Supabase wiring, RLS, migrations, real CRUD, payroll, documents, reports. Remove `/home`→`/dashboard` legacy redirect only if it conflicts.

## Phase 2 — authentication, authorization, and data foundation
### Scope
- Supabase client/server setup and environment documentation
- Auth middleware and protected routes
- organizations, memberships, profiles, roles, permissions, audit logs
- RLS policies, seed of Elite Development organization and base roles
- Invite architecture and authorization service boundary

### Approval gate
Show SQL migration plan, RLS policy intent, indexes, test plan, seed and rollback effect before applying migrations.

### Acceptance criteria
- Deny-by-default tenant isolation
- Base role/action model exists
- Critical auth/role flows have tests or documented SQL tests
- Service-role key stays server-only

## Phase 3 — drivers, fleet, assignments, dashboard
### Scope
- Drivers, driver documents, expiry alerts
- Vehicles, vehicle documents, expiry alerts
- Driver-vehicle assignment transaction/history/odometer validation
- Data-backed executive dashboard summaries

### Acceptance criteria
- Organization-safe CRUD with RLS and audit events
- One active assignment constraint by default
- Profile pages display related data intentionally
- Empty/loading/error/permission states exist

## Phase 4 — daily operations
### Scope
- Attendance and approved workflow
- Expenses, receipts, advances
- Maintenance and vehicle availability status
- Violations, evidence, warnings, controlled deduction eligibility
- Notifications/expiry alerts and permission-aware exports

### Acceptance criteria
- Unique attendance constraint
- Advances cannot deduct without approval
- Maintenance links safely to expenses
- No automatic financial deduction without configuration/approval

## Phase 5 — payroll
### Mandatory design gate
Before mutations: submit rule model, data schema, status transitions, decimal method, approval/reversal design, RLS/permissions, audit model, and test fixtures. Await human approval for ambiguous money rules.

### Scope after approval
- Periods, rule versions, runs, lines, ledger entries
- Server-side calculation services and deterministic unit tests
- Review/approve/pay/lock lifecycle
- Controlled corrections/reversals
- Bilingual one-A4 payslip with QR verification

### Acceptance criteria
- Approved/locked snapshots are immutable
- All values trace to ledger items and sources
- Calculations server-side and decimal-safe
- Permission and lifecycle tests pass

## Phase 6 — HR, documents, reports
### Scope
- Leave, contracts, HR documents, onboarding/offboarding boundaries
- Template selection, generation, versioned snapshots, signed storage
- Safe public verification
- CSV/Excel/PDF/print reports and document layouts

## Phase 7 — platforms, invoices, hardening
### Scope
- Platform management/performance records
- Invoice/payout tracking
- ZATCA readiness only unless verified requirements are approved
- E2E tests, observability hooks, performance/security review, deployment runbook

## Cross-phase validation checklist
- `pnpm lint`
- `pnpm typecheck` or repository equivalent
- Relevant unit/integration tests
- Manual LTR and RTL review
- Responsive review at required breakpoints
- Keyboard/focus/dialog review
- RLS/authorization review for changed entities
- No secrets in diff
- Migration review before apply
- Audit events for relevant critical mutations

## Initial environment contract
```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
SENTRY_DSN=
```

Never commit populated `.env.local`. Maintain `.env.example` with names only.

## v2.0 master prompt delta (2026-07-19)

Summarizes what changed from v1.0 (`docs/elite-master-prompt.md`) to v2.0 (`docs/elite-master-prompt-v2.md`).

- **Status header update:** The canonical source of truth is now `docs/elite-master-prompt-v2.md`. v1.0 (`docs/elite-master-prompt.md`) is preserved for history; v2.0 supersedes it for the decisions v2.0 explicitly addresses (visual, module numbering, Accounting Module 9, the 19 production corrections, platform-wide standards).
- **Precedence (per ADR-015):** AIDesigner UI lock > Design DNA > v1.0 generic visual guidance. Business logic / DB / workflows / security / compliance / storage / migrations / APIs / audit / Saudi rules from v1.0 remain in force unless v2.0 explicitly overrides.
- **What v2.0 adds:**
  - ABSOLUTE AIDesigner UI lock (ADR-015): immutable color tokens, elite-blue/elite-orange 50–900 scales, fixed sidebar gradient, radius scale, spacing rhythm, split-screen login, `EnterpriseModulePage` pattern, gradient footer, command palette, gradient avatar, group-hover row actions.
  - Design DNA token system (ADR-016): tokens replace inline hardcoded hex; glassmorphism + shadow utilities.
  - Accounting & Finance as Module 9 (ADR-017): new first-class module with 12 minimum submodules; native to the same app shell; Saudi finance rules (separate output/input VAT, immutable posting + reversal correction, DB-driven company profile/VAT/QR).
  - Official module numbering 1–18 (ADR-018): consolidates v1.0's "8 modules" and "16 modules" lists; M1–M8 correction numbering preserved only for traceability.
  - Platform-wide standards: 9 Supabase Storage buckets with sizes/expiries/RLS; error code taxonomy (AUTH/DRV/PAY/VIO/VEH/ATT/ORD); universal soft-delete partial index pattern (`idx_{table}_active`); 28-file Supabase CLI migration strategy; FastAPI `/health` and `/ready` endpoints.
  - 19 production corrections (ADR-019) across M1–M8: orders proration, COD reconciliation, deduction ledger rollback, `violation_ref` via SEQUENCE, Hijri holidays, leave concurrency (`FOR UPDATE`), `working_day_value` GENERATED column, `auth.users` sync trigger, RLS INSERT `WITH CHECK`, rate limiting, narrowed middleware matcher, odometer fraud trigger, structured handover forms, HungerStation distance rate card, NULL `shift_label` via `COALESCE`, report job queue, cache invalidation via Realtime, action item scoring, NAJM external fine staging, WPS SIF format, Saudi minimum wage advisory flag, driver salary history, `vehicle_active_documents` view. Full detail in `docs/elite-master-prompt-v2.md` sections 5–6.
- **Impact on existing phases:**
  - Phase 1 (visual + i18n): MUST implement AIDesigner tokens (ADR-015/016) instead of the v1.0 "keep template palette" approach. See revised Phase 1 file plan below.
  - Phase 2 (auth + data foundation): MUST include `auth.users` sync trigger, RLS INSERT `WITH CHECK` with `get_my_tenant_id()`, rate limiting, narrowed middleware matcher, storage buckets, error code taxonomy, soft-delete index pattern.
  - Phase 3 (drivers/vehicles/dashboard): MUST include COD sessions + salary history + `compute_driver_completeness()` (M1), odometer fraud trigger + structured handover forms + `vehicle_active_documents` view (M2).
  - Phase 4 (daily operations): MUST include Hijri holidays + late tiers + `working_day_value` GENERATED + leave concurrency `FOR UPDATE` + anomaly detector (M6), NAJM external fine staging + `violation_ref` SEQUENCE + dispute window + deduction rollback (M3), HungerStation distance rate card + NULL `shift_label` `COALESCE` (M5).
  - Phase 5 (payroll): MUST use the canonical prorated formula (`Math.ceil`), WPS SIF, Saudi minimum wage advisory, `cancelPayrollPeriod` calling `rollbackPayrollDeductions`.
  - Phase 6 (HR/documents/reports): MUST include report job queue + cache invalidation + action item scoring (M7).
  - Module 9 Accounting: tentatively a new phase after Phase 6 (TBD); numbered and scoped now per ADR-017, not yet scheduled.

## Revised Phase 1 file plan (v2.0 — AIDesigner + Design DNA)

This REPLACES the "Proposed exact Phase 1 file plan (UI-only; no persistence)" section in the existing Phase 1 for planning purposes (the original is preserved above for history). UI-only, no Supabase, no migrations.

**Brand & theme tokens (ADR-015, ADR-016)**
- UPDATE `src/app/globals.css`:
  - add `@theme` block with elite-blue and elite-orange 50–900 scales (anchor 500 = `#1E5A99` / `#E87D3E`);
  - add semantic CSS custom properties in `:root` (light) and `.dark` (dark) for `background`/`foreground`/`card`/`primary`/`secondary`/`muted`/`muted-foreground`/`destructive`/`border`/`radius` per the Design DNA HSL values;
  - add the fixed sidebar gradient as a CSS variable/utility (NOT inline);
  - add glassmorphism utility classes `.glass` and `.glass-dark`;
  - add shadow utilities `.shadow-modern`, `.shadow-modern-lg`, `.hover-lift`, `.gradient-elite-blue`, `.gradient-elite-orange`;
  - add the global 200ms `*` transition (color/bg/border/transform/box-shadow);
  - preserve dark/light;
  - scope `tabular-nums` for financial KPIs.
- UPDATE `src/lib/fonts.ts`: keep Inter + Cairo; ensure Cairo applies under RTL via `dir`-based font switching.
- UPDATE `src/components/app-sidebar.tsx`: replace inline `bg-[#061a2b]`/`bg-[#1E5A99]` hardcoding with tokens; apply the fixed sidebar gradient token; keep 260px expanded / 68px collapsed spec; add missing Operations→Assignments entry; align pillar groups with the 1–18 module list (ADR-018) including a reserved Accounting pillar (Module 9, disabled until its phase).
- REPLACE `src/components/logo.tsx` with an EliteDev brand mark using the elite-blue→elite-orange gradient token; remove the generic cart glyph.
- ADD a `gradient-avatar` utility/pattern (from-[#1E5A99] to-[#E87D3E]) for reuse in `nav-user.tsx` and user lists.

**Locale / RTL (ADR-013 unchanged)**
- UPDATE `src/app/layout.tsx`: derive `lang`/`dir` from the locale provider instead of hardcoded `lang="ar" dir="rtl"` to fix the SSR/CSR mismatch; keep providers.
- EXPAND `src/lib/i18n/{translations.ts,types.ts}` with full catalogs for landing, auth, all 18 module headings, table headers, statuses, empty/loading/error states, buttons. Ensure every string has EN + AR variants (Design DNA strict rule).
- KEEP `src/contexts/locale-context.tsx` + `useTranslation()` (documented locale design per ADR-013).
- ENSURE sidebar margin flips: `ml-[260px]` LTR / `mr-[260px]` RTL; active bar flips: `-left-3` LTR / `-right-3` RTL.

**Landing**
- UPDATE `src/app/landing/landing-page-content.tsx`: route through `useTranslation()`; replace fabricated metrics with real capability copy; fix dead `/login`→`/auth/sign-in` links; apply AIDesigner typography (text-2xl font-bold tracking-tight for page-equivalent titles) — NO heavy decorative headers.
- REMOVE template `src/app/landing/components/*` superseded by the above and `components/landing/mega-menu.tsx`, `pricing-plans.tsx`, `upgrade-to-pro-button.tsx`.

**Auth UI (split-screen, bilingual, no social login — AIDesigner lock)**
- UPDATE `src/app/(auth)/layout.tsx`: fix "ShadcnStore" metadata; implement the approved split-screen shell (lg:w-1/2 left brand panel with background image, flex-1 right form panel max-w-[420px]); card uses `border-border/50 shadow-modern-lg backdrop-blur-sm bg-card/80 dark:bg-card/60`.
- UPDATE `src/app/(auth)/sign-in/components/login-form-1.tsx`: bilingual; remove Google button + prefilled creds; remove `<form action="/">`; add loading/error/password-visibility; inputs `h-11 pl-10` with left icon; submit button `w-full h-11 text-base font-semibold` using the elite-blue gradient CTA style; Framer Motion stagger entrance (`containerVariants`, `itemVariants`). NOTE: framer-motion is NOT yet installed — flag as a Phase 1 dependency to approve (see Dependencies below).
- UPDATE `forgot-password` form + page to bilingual. ADD `reset-password` and `accept-invite` (reuse sign-up design) routes; REPURPOSE `sign-up*` into `accept-invite` (no public self-registration per v1.0).
- DELETE variant duplicates `sign-in-2/3`, `sign-up-2/3`, `forgot-password-2/3`.

**Shell + dashboard chrome (EnterpriseModulePage pattern — ADR-015)**
- UPDATE `src/app/(dashboard)/dashboard/page.tsx` + `components/section-cards.tsx`: remove template SaaS KPIs/copy; bilingual placeholders for Elite KPIs; KPI cards use the approved pattern (rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm p-4 shadow-sm hover:shadow-md, decorative circle opacity-[0.06] brand color at top-right); no real data until Phase 3.
- ADD/DOCUMENT an `EnterpriseModulePage` component pattern (header → KPI cards → toolbar → data table → pagination → dialog) to be used by every CRUD module page. Phase 1 documents the pattern; actual module pages adopt it in their phases.
- KEEP `site-header.tsx` (lang toggle + ⌘K command palette, bg-background/80 backdrop-blur-xl border-b border-border/40, notification bell bg-[#E87D3E], gradient avatar), `command-search.tsx`, `nav-main/nav-user`, `components/ui/*`.
- UPDATE footer to the approved gradient (from-[#0F3A66] to-[#1E5A99]) with 3-column grid and elite-orange links.

**Dependencies to approve in Phase 1**
- `framer-motion` — required for the approved Framer Motion stagger on the login page and restrained animation per Design DNA. Phase 0 worklog flagged it as absent. Phase 1 needs it. State impact: adds one runtime dependency, no build config change. Approval required per the GLM-5.2 execution protocol (state impact, get approval).
- No other new dependencies in Phase 1.

**Explicitly deferred (NOT Phase 1)**
- Supabase wiring, RLS, migrations, real CRUD, payroll, documents, reports, Accounting Module 9 (ADR-017), all v2.0 corrections that require DB schema (ADR-019) — these land in their respective phases per the impact list above.

## Revised Phase 1 acceptance criteria (v2.0)
- Landing, sign-in, forgot/reset password, accept-invite UI routes render bilingually.
- AIDesigner tokens (elite-blue, elite-orange, sidebar gradient, semantic light/dark tokens) are in `globals.css` and used — no inline hardcoded Elite hex values remain in shell components.
- Split-screen login renders with Framer Motion stagger.
- Sidebar gradient matches the fixed token exactly.
- Responsive at 375/768/1024/1440.
- RTL correctly flips logical layout (sidebar margin, active bar, dir-based font switch to Cairo).
- No generic template user-facing copy in implemented routes.
- EnterpriseModulePage pattern documented.
- `pnpm lint` and typecheck pass.
