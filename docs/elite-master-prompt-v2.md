# EliteDev Saudi 3PL Platform — Master Prompt v2.0 Reference

This document is the canonical v2.0 engineering reference for the Elite Development Enterprise Logistics Platform. It captures the v2.0 master prompt decisions in a structured, actionable form. It does **not** reproduce the full master prompt verbatim; it consolidates the decisions into tables, lists, and directives that engineering can act on.

- Companion file: `docs/elite-master-prompt.md` (v1.0).
- Scope of this file: v2.0 additions only — platform-wide standards, the 19 production corrections, the Design DNA addition, the ABSOLUTE AIDesigner UI lock, the module numbering override (1–18), and Accounting & Finance as a new Module 9.

---

## 1. Authority and scope

- **v2.0 is the canonical source of truth** for every decision explicitly captured in this file. Where v2.0 speaks, it governs.
- **Precedence (visual):** `AIDesigner UI lock` > `Design DNA` > `v1.0 generic visual guidance`. AIDesigner wins every visual decision.
- **Precedence (non-visual):** Business logic, database schema, workflows, security, compliance, storage, migrations, APIs, audit, and Saudi regulatory rules from v1.0 **remain in force** unless v2.0 explicitly overrides them in section 5 or section 6.
- **v1.0 preservation:** `docs/elite-master-prompt.md` is preserved unchanged for historical reference. It is not deleted or rewritten.
- **Supersession is partial:** v2.0 supersedes v1.0 **only** for the decisions it explicitly addresses. All other v1.0 business logic, domain rules, and architecture decisions remain binding.
- **Non-goal:** This file does not re-litigate architecture (see `docs/architecture-decisions.md`) or phase sequencing (see `docs/implementation-plan.md`).

---

## 2. Module numbering override (official: 1–18)

The official module list is 18 modules in the order below. This numbering is authoritative for sidebar grouping, permissions, audit `module` values, and documentation references.

| # | Module | Notes |
| --- | --- | --- |
| 1 | Drivers Management | Enterprise core |
| 2 | Vehicles Management | Enterprise core |
| 3 | Attendance Management | Enterprise core |
| 4 | Payroll Management | Enterprise core |
| 5 | Violations & Penalties | Enterprise core |
| 6 | Expenses Management | Enterprise core |
| 7 | Maintenance Management | Enterprise core |
| 8 | Invoices Management | Enterprise core |
| 9 | Accounting & Finance Management | **NEW in v2.0** |
| 10 | Platforms Management | Enterprise core |
| 11 | HR Management | Enterprise core |
| 12 | Reports Management | Enterprise core |
| 13 | Templates Management | Enterprise core |
| 14 | Users Management | Administration |
| 15 | Roles Management | Administration |
| 16 | Audit Log | Administration |
| 17 | Security Management | Administration |
| 18 | Settings Management | Administration |

### Mapping to the earlier "8 enterprise modules"

The earlier grouping of 8 enterprise modules maps onto the 1–18 list as follows. v2.0 production corrections in section 6 reference the original M1–M8 numbering for traceability.

| Original M# | Original name | Maps to |
| --- | --- | --- |
| M1 | Drivers | Module 1 |
| M2 | Vehicles | Module 2 |
| M3 | Violations | Module 5 |
| M4 | Payroll | Module 4 |
| M5 | Orders & Platforms | Module 10 (+ Module 8 financial linkage) |
| M6 | Attendance | Module 3 |
| M7 | Dashboard & Reports | Module 12 |
| M8 | Settings & Auth | Modules 14, 15, 16, 17, 18 |

---

## 3. ABSOLUTE AIDesigner UI lock (final visual override)

The visual anchors below are **immutable**. They cannot be changed by later prompts, design reviews, or "modernization" passes. Any conflicting earlier instruction (including v1.0 visual guidance) is overridden by this section.

### 3.1 Style anchors

- Enterprise SaaS Logistics Dashboard.
- Clean-professional light/dark theme with subtle glassmorphism.
- Split-screen login (brand panel + form panel).
- Deep-navy fixed sidebar with the locked gradient.
- Minimal-decorative interior pages (operational density, no oversized headings).
- Bilingual: EN LTR + AR RTL, first-class from the start.

### 3.2 Immutable color tokens

| Token | Light HSL | Dark HSL | Hex anchor |
| --- | --- | --- | --- |
| `--background` | `0 0% 100%` | `222 47% 9%` | `#FFFFFF` / `#0C1322` |
| `--foreground` | `222 47% 11%` | `210 40% 98%` | `#0F172A` / `#F8FAFC` |
| `--card` | `0 0% 100%` | `222 47% 11%` | `#FFFFFF` / `#0F1729` |
| `--primary` | `211 67% 36%` | `211 67% 52%` | `#1E5A99` (elite-blue 500) |
| `--secondary` | `210 40% 96%` | `217 33% 17%` | `#F1F5F9` / `#1D283A` |
| `--muted` | `210 40% 96%` | `217 33% 17%` | `#F1F5F9` / `#1D283A` |
| `--muted-foreground` | `215 16% 47%` | `215 20% 65%` | `#64748B` / `#94A3B8` |
| `--destructive` | `0 72% 51%` | `0 63% 31%` | `#DC2626` / `#7F1D1D` |
| `--border` | `214 32% 91%` | `217 33% 20%` | `#E2E8F0` / `#222F44` |
| `--radius` | `0.75rem` | `0.75rem` | rounded-xl base |

### 3.3 Immutable brand anchors

- `elite-blue` = `#1E5A99` (500 on the brand scale).
- `elite-orange` = `#E87D3E` (500 on the brand scale).
- Full 50–900 scales are defined in section 4.2 and must not be regenerated or resampled.

### 3.4 Immutable sidebar gradient

```
linear-gradient(180deg, #0c2d4a 0%, #0f3a5e 30%, #122f4a 70%, #0a1f33 100%)
```

### 3.5 Immutable radius scale

- Small controls (buttons, inputs, badges, chips): `rounded-lg` / `rounded-xl`.
- Cards, dialogs, sheets, table containers: `rounded-2xl`.

### 3.6 Immutable spacing rhythm

- Main content padding: `p-6`.
- Section stack: `space-y-6`.
- KPI card grid gap: `gap-4`.
- Toolbar gap: `gap-3`.

### 3.7 Immutable layout rules

- Split-screen login (brand left / form right at `lg:` breakpoint).
- Fixed sidebar: `260px` expanded, `68px` collapsed, deep-navy gradient.
- Sticky glassmorphic header: `h-16`, `bg-background/80 backdrop-blur-xl`, `z-30`.
- `EnterpriseModulePage` pattern: header → KPI cards → toolbar → data table → pagination → dialog.
- Content margin: `ml-[260px]` LTR, `mr-[260px]` RTL (flips on collapse).
- Gradient footer: `from-[#0F3A66] to-[#1E5A99]`, 3-column grid.
- Command palette (`⌘K`) accessible from header.
- Gradient avatar for users: `from-[#1E5A99] to-[#E87D3E]`.
- Row actions: `opacity-0 group-hover:opacity-100`.
- Full bilingual RTL/LTR with logical CSS properties.

### 3.8 Immutable component rules

- Primary CTA = elite-blue gradient (`bg-gradient-to-r from-[#1E5A99] to-[#2E6FAE]`).
- Quick Actions = elite-orange gradient (used sparingly).
- Table containers: `rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm shadow-sm`.
- Cards keep decorative circle treatment at `opacity-[0.06]` in the brand color.
- Inputs, dialogs, dropdowns, pagination, skeletons, and icons follow the approved AIDesigner pattern documented in section 4.

### 3.9 Explicit DO NOT list

Do **not**:

- Change the color token system or introduce new tokens.
- Change the sidebar gradient.
- Change the typography or spacing rhythm.
- Change the split-screen login layout.
- Change header, sidebar, footer, toolbar, table, dialog, button, or avatar styling.
- Replace any approved AIDesigner screen with a prior design or external template.
- Apply conflicting earlier rules (e.g., "no gradient buttons" conflicts with the approved primary CTA / Quick Actions gradients — the AIDesigner rule wins).

### 3.10 Precedence note

AIDesigner wins for **all visual decisions**. Business logic, DB, workflows, security, compliance, storage, migrations, APIs, audit, and Saudi rules from the rest of the master file remain in force and are not weakened by this lock.

---

## 4. Design DNA (visual source of truth)

This section is the operational visual spec. It is authoritative for implementation; where it and section 3 overlap, section 3 is the contract and section 4 is the spec.

### 4.1 Color palette

See section 3.2 for the token table (token | light HSL | dark HSL | hex anchor). Those ten tokens are the entire palette; no additional tokens may be introduced.

### 4.2 Brand color scales

**elite-blue** (anchor 500 = `#1E5A99`):

| Step | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hex | `#EAF2F9` | `#D6E4F2` | `#ADCAE5` | `#7FABD4` | `#4F8BBF` | `#1E5A99` | `#1A4F88` | `#15406F` | `#103257` | `#0C2440` |

**elite-orange** (anchor 500 = `#E87D3E`):

| Step | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hex | `#FDF1EA` | `#FAE0D2` | `#F4C1A6` | `#EE9F73` | `#E88E54` | `#E87D3E` | `#D26A2C` | `#AC5421` | `#87411B` | `#633017` |

### 4.3 Typography roles

| Role | Tailwind classes |
| --- | --- |
| Page title | `text-2xl font-bold text-foreground` |
| Page subtitle | `text-sm text-muted-foreground` |
| KPI label | `text-xs font-medium text-muted-foreground` |
| KPI value | `text-2xl font-bold tabular-nums text-foreground` |
| Table header | `text-xs font-semibold uppercase text-muted-foreground` |
| Table body | `text-sm text-foreground` |
| Sidebar label | `text-sm font-medium text-slate-300` (active: `text-white`) |
| Login title | `text-3xl font-bold text-white` |
| Footer | `text-sm text-white/80` |

- English uses Geist or Inter; Arabic uses Cairo.
- Apply `tabular-nums` to all KPI and financial values.

### 4.4 Spacing & layout

- Main: `p-6`.
- Sections: `space-y-6`.
- KPI grid: `gap-4`.
- Toolbar: `gap-3`.
- Table container: `rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm shadow-sm`.
- Dialog: `max-w-4xl max-h-[85vh]`, `rounded-2xl`.
- Sidebar: `260px` expanded / `68px` collapsed.
- Header: `h-16`, `sticky top-0 z-30`, `bg-background/80 backdrop-blur-xl`.
- Content margin: `ml-[260px]` LTR / `mr-[260px]` RTL.

### 4.5 Component patterns

- **Buttons**
  - Primary CTA: elite-blue gradient, `rounded-lg`.
  - Quick Actions: elite-orange gradient (sparingly).
  - Outline small: `h-9 rounded-lg border`.
  - Ghost icon: `h-9 w-9 rounded-lg hover:bg-muted`.
  - Destructive: `text-destructive`.
  - Empty-state add: outline button with `Plus` icon.
- **Cards / KPI**
  - Decorative circle at `opacity-[0.06]` in the relevant brand color.
  - KPI label + value + delta row.
- **Data Table**
  - Container per 4.4.
  - Header row per 4.3.
  - Body rows: `hover:bg-muted/50`.
  - Row actions: `opacity-0 group-hover:opacity-100 transition`.
  - Status badge pattern: `bg-{color}-500/15 text-{color}-600 border border-{color}-500/20 rounded-full`.
  - Skeleton: `300ms` delay before showing.
- **Inputs**
  - Search: `h-9 bg-muted/30 rounded-xl`.
- **Dialogs**
  - `rounded-2xl`, `max-w-4xl max-h-[85vh]`.
- **Sidebar**
  - Fixed, deep-navy gradient, 12 pillar groups.
  - Per-pillar accent colors.
  - Active item: `bg-white/12` + `3px` accent bar on the start edge.
  - Collapse toggle preserves state.
- **Header**
  - `bg-background/80 backdrop-blur-xl`, `h-16`.
  - `⌘K` command palette.
  - Notification bell: `bg-[#E87D3E]`.
  - Gradient avatar: `from-[#1E5A99] to-[#E87D3E]`.
- **Footer**
  - Gradient `from-[#0F3A66] to-[#1E5A99]`.
  - 3-column grid.
- **Login**
  - Split-screen: `lg:w-1/2` brand left, `flex-1` form right, form `max-w-[420px]`.
  - Framer Motion stagger (see 4.7).

### 4.6 Visual effects

- Glassmorphism utilities: `.glass` (light) and `.glass-dark` (dark) only.
- `backdrop-blur-sm` on table containers.
- `backdrop-blur-xl` on header and command palette.
- KPI decorative circle at `opacity-[0.06]`.
- Shadows: `shadow-sm` (tables), `shadow-lg shadow-[brand]/20` (elevated cards), `shadow-modern-lg` (modals).
- `hover-lift` utility for interactive cards.
- Global `200ms` transition on `*` (never remove).

### 4.7 Animations

| Keyframe | Duration | Use |
| --- | --- | --- |
| `fade-in` | `0.3s` | Page/section entry |
| `slide-up` | `0.4s` | Card stacks |
| `scale-in` | `0.3s` | Dialogs, popovers |
| `slide-in` | `0.3s` | Sheets, drawers |
| `shimmer` | `2s linear infinite` | Skeletons |
| `pulse-glow` | `2s` | Status emphasis |

- Login Framer Motion stagger: container `0.1s`, children `0.2s` stagger, `0.5s easeOut` per item.
- **Do not invent new keyframes.**

### 4.8 Bilingual / RTL

- Language state via `useAppStore` (`language` field).
- Root element: `dir={isRTL ? "rtl" : "ltr"}`.
- Sidebar margin flips between `ml-[260px]` and `mr-[260px]` with direction.
- Every visible string has EN + AR variants (titles, labels, toasts, validation, status, empty states, print).

### 4.9 Strict rules (non-negotiables)

- No new color tokens beyond section 3.2.
- No sidebar gradient change.
- No new utility classes beyond `.glass`, `.glass-dark`, `.shadow-modern`, `.shadow-modern-lg`, `.hover-lift`, `.gradient-elite-blue`, `.gradient-elite-orange`.
- No radius scale change.
- No spacing rhythm change.
- Icons: `lucide-react` only.
- Page headers are `text-2xl font-bold text-foreground` — no heavy decorative headers.
- No glow / neon / cyber aesthetic.
- Always use CSS custom properties or brand Tailwind classes; no raw one-off hexes in component markup except the brand anchors and gradients explicitly listed here.
- Every string is bilingual.
- Never remove the `EnterpriseModulePage` pattern.
- Never remove the global `200ms` transition.
- Never change login split-screen + Framer Motion stagger.
- Only the defined animation keyframes are allowed.
- Always use `group` / `group-hover` for row actions.
- Always `backdrop-blur-sm` on tables and `backdrop-blur-xl` on header / command palette.
- Always use the gradient avatar for users.

---

## 5. Platform-wide standards (apply to all modules)

### 5.1 Storage buckets

Supabase Storage. Buckets are private unless marked PUBLIC. Private files are served via signed URLs only.

| Bucket | Visibility | Max size | Signed URL TTL | Notes |
| --- | --- | --- | --- | --- |
| `driver-photos` | private | 5 MB | 1 h | Driver profile photo |
| `driver-documents` | private | 20 MB | 30 min | Access log retained |
| `vehicle-photos` | private | 10 MB | 1 h | Vehicle imagery |
| `vehicle-documents` | private | 20 MB | 30 min | Registration, insurance, etc. |
| `violation-evidence` | private | 50 MB | 1 h | Evidence attachments |
| `company-assets` | **PUBLIC** | 5 MB | CDN | Logo, branding assets |
| `generated-reports` | private | 100 MB | 24 h | Auto-purge after expiry |
| `payroll-payslips` | private | 10 MB | 15 min | Role-gated: Accountant + Admin + GM |
| `import-files` | private | 20 MB | 1 h | Auto-purge after 7 days |

Bucket creation (single INSERT, see migration `026_storage_buckets_and_policies.sql`):

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('driver-photos',      'driver-photos',      false,  5242880,   null),
  ('driver-documents',   'driver-documents',   false, 20971520,   null),
  ('vehicle-photos',     'vehicle-photos',     false, 10485760,   null),
  ('vehicle-documents',  'vehicle-documents',  false, 20971520,   null),
  ('violation-evidence', 'violation-evidence', false, 52428800,   null),
  ('company-assets',     'company-assets',      true,  5242880,   null),
  ('generated-reports',  'generated-reports',  false,104857600,   null),
  ('payroll-payslips',   'payroll-payslips',   false, 10485760,   null),
  ('import-files',       'import-files',       false, 20971520,   null);
```

RLS policy pattern — authenticated users read only files in their own tenant folder (tenant id is the first path segment). Repeat per bucket, tightening per-bucket roles where required (e.g., `payroll-payslips`):

```sql
create policy "tenant read own files"
on storage.objects for select
to authenticated
using (
  bucket.id = 'driver-documents'
  and storage.foldername(name)[1] = (
    select organization_id::text from profiles where id = auth.uid()
  )
);
```

### 5.2 Error code taxonomy

All API errors return a bilingual envelope. Codes are surfaced as `ERR_<PREFIX>` (e.g., `ERR_PAY001`).

```json
{ "code": "ERR_XXX", "message_ar": "...", "message_en": "..." }
```

| Prefix range | Module | Example | Meaning |
| --- | --- | --- | --- |
| `AUTH001`–`AUTH007` | Auth | `AUTH001` | `account_locked` |
| `AUTH002` | Auth | `AUTH002` | `invalid_2fa_code` |
| `AUTH003` | Auth | `AUTH003` | `session_expired` |
| `AUTH004` | Auth | `AUTH004` | `invalid_credentials` |
| `AUTH005` | Auth | `AUTH005` | `must_change_password` |
| `AUTH006` | Auth | `AUTH006` | `2fa_required` |
| `AUTH007` | Auth | `AUTH007` | `insufficient_role` |
| `DRV001`–`DRV005` | Drivers | `DRV001` | `driver_not_found` |
| `PAY001`–`PAY006` | Payroll | `PAY001` | `attendance_not_locked` |
| `VIO001`–`VIO004` | Violations | `VIO001` | `violation_not_found` |
| `VEH001`–`VEH004` | Vehicles | `VEH003` | `odometer_regression` |
| `ATT001`–`ATT005` | Attendance | `ATT001` | `attendance_locked` |
| `ORD001`–`ORD005` | Orders & Platforms | `ORD001` | `session_not_found` |

### 5.3 Universal soft-delete index pattern

Every soft-deletable tenant-owned table gets a partial index scoped to active (non-deleted) rows, composite on `tenant_id` plus the table's primary access path.

```sql
create index concurrently idx_{table}_active
  on {table} (tenant_id, ...)
  where deleted_at is null;
```

Example indexes to provision:

- `idx_drivers_active` on `drivers(tenant_id, status)` where `deleted_at is null`
- `idx_violations_active` on `violations(tenant_id, status)` where `deleted_at is null`
- `idx_driver_attendance_active` on `driver_attendance(tenant_id, driver_id, work_date)` where `deleted_at is null`
- `idx_daily_order_entries_active` on `daily_order_entries(tenant_id, platform_id, shift_date)` where `deleted_at is null`

### 5.4 Database migration strategy

- Supabase CLI migrations only. Never run raw SQL against production.
- Apply via `supabase db push`.
- Never run `supabase db reset` in production.
- Every migration is numbered, idempotent where possible, and includes rollback notes in its header.

Migration files (1–28):

| # | File |
| --- | --- |
| 001 | `001_extensions.sql` |
| 002 | `002_organizations_and_members.sql` |
| 003 | `003_profiles_and_roles.sql` |
| 004 | `004_permissions_and_rbac.sql` |
| 005 | `005_audit_logs.sql` |
| 006 | `006_notifications.sql` |
| 007 | `007_app_settings.sql` |
| 008 | `008_document_number_sequences.sql` |
| 009 | `009_drivers.sql` |
| 010 | `010_driver_documents.sql` |
| 011 | `011_vehicles.sql` |
| 012 | `012_vehicle_documents.sql` |
| 013 | `013_driver_vehicle_assignments.sql` |
| 014 | `014_attendance_records.sql` |
| 015 | `015_leave_requests_balances.sql` |
| 016 | `016_violations.sql` |
| 017 | `017_expenses_and_advances.sql` |
| 018 | `018_orders.sql` |
| 019 | `019_maintenance.sql` |
| 020 | `020_platforms_and_performance.sql` |
| 021 | `021_invoices.sql` |
| 022 | `022_payroll_periods_runs_lines.sql` |
| 023 | `023_payroll_ledger_and_deductions.sql` |
| 024 | `024_document_templates.sql` |
| 025 | `025_generated_documents.sql` |
| 026 | `026_storage_buckets_and_policies.sql` |
| 027 | `027_rls_tenant_isolation.sql` |
| 028 | `028_seed_defaults.sql` |

### 5.5 Health check endpoint (FastAPI)

- `GET /health` returns `{ status, database, timestamp, version, environment }`.
- `GET /ready` probes database connectivity and storage; returns `200` when healthy, `503` when either dependency is unavailable.

---

## 6. v2.0 production corrections (per original module M1–M8)

Each correction is summarized by what changed and why. Full SQL/TS is not reproduced here; see the referenced migration files.

### 6.1 M1 — Drivers

- **Orders proration synced with M4.** Prorated monthly target uses `Math.ceil`, never a flat `450` order assumption. Keeps the driver-order productivity math identical to payroll proration (see migration `009_drivers.sql`, `023_payroll_ledger_and_deductions.sql`).
- **COD reconciliation added.** New `driver_cod_sessions` table plus `cod_outstanding_amount` and `cod_risk_flag` columns on `drivers`. New Tab 16 "COD Reconciliation" surfaces outstanding cash and risk.
- **Driver salary history.** New `driver_salary_history` table for an auditable trail of salary changes (old, new, reason, actor, timestamp).
- **Completeness function.** `compute_driver_completeness()` DB function computes profile completeness from document presence and required fields; consumed by Driver Risk Score and dashboard.
- **Saudi IBAN validation.** Zod schema enforces Saudi IBAN checksum (SA + 22 digits, mod-97 check).
- **COD deduction source.** COD shortfalls are a first-class payroll deduction source (`source = 'cod'`) on the deduction ledger.
- **New audit events.** `cod_session_created`, `cod_session_reconciled`, `cod_deduction_created`, `cod_risk_flag_set`, `cod_risk_flag_cleared`, `salary_changed`.
- **Risk score.** COD risk is a factor in the Driver Risk Score.

### 6.2 M2 — Vehicles

- **Saudi plate validation.** Zod regex accepts Arabic, Latin, and numeric plate forms; rejects mixed-invalid combinations.
- **Odometer fraud trigger.** `prevent_odometer_regression` and `prevent_vehicle_odometer_regression` triggers block any update that lowers recorded odometer; raises `VEH003`.
- **Structured handover forms.** New `vehicle_handover_forms` table replaces the loose `handover_photos[]` array. Fields: `form_type` (handover / return), condition checklist, signatures, photos, timestamps.
- **Active documents view.** `vehicle_active_documents` VIEW exposes only currently-valid documents. The scoring engine must query the view, not the base table, to avoid counting expired docs.
- **Soft-delete partial indexes.** Applied per section 5.3.
- **Handover workflow gate.** A vehicle cannot be marked operational without a completed handover form. The gate is configurable: `warn` (allow with audit) or `block` (hard reject).

### 6.3 M3 — Violations

- **Sequence-based reference.** `violation_ref` is generated by a PostgreSQL `SEQUENCE`, never `COUNT(*)+1`. Race-condition safe.
- **Dispute window.** `dispute_window_days` plus a `dispute_deadline` `GENERATED` column (computed from violation date + window) with a supporting index.
- **External fine imports.** New `external_fine_imports` staging table is future-ready for NAJM / MOI / Absher integrations. Statuses: `matched`, `unmatched`, `violation_created`, `duplicate`, `ignored`.
- **Deduction ledger rollback formalized.** `rollbackPayrollDeductions()` rolls ledger rows back to `pending`, rolls linked violations back to `resolved`, and writes a per-violation audit event. Used by payroll cancellation and dispute approvals.
- **Workflow engine enforcement.** The violation workflow enforces the dispute window and the admin waiver limit before allowing deduction or waiver.
- **External fine import UI.** Dedicated page for reviewing and matching staged external fines.

### 6.4 M4 — Payroll

- **Canonical payroll formula.** Proration uses `Math.ceil` for the prorated target and is identical to M1's order proration. No flat-`450` fallback.
- **Attendance lock required.** Payroll run creation fails with `PAY001` if the period's attendance is not locked.
- **Ledger load.** Run loads the violation ledger, advances, and COD deductions as deduction sources.
- **Saudi minimum wage.** `4000 SAR` check for Saudi nationals, advisory only. Below-threshold lines are flagged `below_minimum_wage`; payroll is not blocked.
- **WPS SIF format.** SIF export defined: `EmployerMOLRef`, `EmployeeRef` = iqama, IBAN, Saudi bank codes, currency `682`, payment method `01`.
- **Journal entries hook.** New `payroll_journal_entries` table as the accounting hook (future-ready for Module 9 posting).
- **Cancellation flow.** `cancelPayrollPeriod()` calls `rollbackPayrollDeductions()`, rolls back advance repayments, and writes audit.
- **Table choice.** AG Grid Community + TanStack Table grouping. No Enterprise license at current scale.

### 6.5 M5 — Orders & Platforms

- **HungerStation distance rate card.** Base `5.00 SAR/order`, `0.50 SAR/km`, first 1 km free, 20 km cap, multi-order discount `1.50 SAR` when 2+ orders in a batch.
- **Rate card storage.** `delivery_platforms.rate_type` (`flat` | `distance_based`) plus `rate_card` JSONB.
- **Distance fields on entries.** `daily_order_entries` gains `total_distance_km`, `avg_order_distance_km`, `multi_order_batches`.
- **Revenue calculation.** `calculateSessionRevenue()` switches between flat and distance-based logic per platform rate type (see migration `018_orders.sql`).
- **NULL shift label handling.** `NULL shift_label` is handled via `COALESCE` in the unique partial index rather than a raw `UNIQUE` constraint, preventing constraint violations on nullable labels.
- **Import template.** Extended for distance columns; backward compatible with existing flat templates.

### 6.6 M6 — Attendance

- **Hijri holidays.** `public_holidays` table with `calendar_type` (`gregorian` | `hijri` | `fixed`). Eid al-Fitr (`hijri_month=10`, `hijri_day=1`) and Eid al-Adha (`hijri_month=12`, `hijri_day=10`), 5-day duration each. Uses `hijri-converter` package.
- **Late policy tiers.** Three distinct zones: `grace_period_minutes=15`, `late_threshold_minutes=30`, `half_day_threshold_minutes=120`.
- **Working-day value computed.** `working_day_value` is a `GENERATED ALWAYS AS` column (CASE on status); the API never submits it.
- **Leave balance concurrency fix.** `SELECT ... FOR UPDATE` on both the leave request and the balance row prevents the double-approval race.
- **Anomaly detector.** Flags: consecutive unexcused absence ≥ 3, high late rate ≥ 5, high absence rate > 20%, extreme late > 3 h, missing checkout.
- **Holiday generator.** Runs each January 1 by the GM to seed the year's holidays.

### 6.7 M7 — Dashboard & Reports

- **Async report generation.** FastAPI `BackgroundTasks` returns a `job_id`; client polls `/reports/status/{job_id}`; output uploaded to `generated-reports` bucket; 24 h expiry.
- **Cache invalidation.** Event-driven via Supabase Realtime broadcast. `CACHE_INVALIDATION_MAP` per event type; React Query `invalidateQueries` on receive.
- **Action item priority scoring.** Severity base + age multiplier + financial impact + scale, sorted by computed score.
- **HungerStation Reconciliation Report.** Added as a first-class financial report.
- **Report expiry.** Generated report files auto-expire after 24 h.

### 6.8 M8 — Settings & Auth

- **Auth sync trigger.** `sync_auth_user_to_custom_users` runs `AFTER UPDATE OR DELETE` on `auth.users`; sets custom user `status` to `locked`/`active`/`inactive`; soft-deletes the custom row when the auth user is deleted.
- **Tenant seeding.** `seedTenantDefaults()` seeds default `system_settings`, 5 delivery platforms (with HS distance rate card), 7 leave types, violation types, current-year holidays via the generator, and the current attendance period.
- **Middleware matcher narrowed.** Next.js middleware only matches dashboard routes; excludes `/login`, `/api`, `/_next`, `/favicon`.
- **Rate limiting.** `slowapi`: login `10/min`, forgot-password `3/hour`, 2FA verify `5/min`, reports generate `10/hour`, orders import `30/hour`.
- **RLS INSERT WITH CHECK.** All tenant-owned tables use `WITH CHECK (organization_id = get_my_tenant_id())` via the `get_my_tenant_id()` helper. Prevents forged `tenant_id` inserts.
- **No COUNT(*)+1 for references.** All reference numbers (users, invoices, violations, etc.) use sequences or `document_number_sequences`, never row count + 1.

---

## 7. Module 9 — Accounting & Finance Management (NEW)

Module 9 is new in v2.0. It is native to the same AIDesigner app shell — same sidebar, header, table patterns, cards, dialogs, spacing, typography, and color system. It is **not** visually isolated from the rest of the platform.

### 7.1 Scope

- Chart of accounts.
- Accounting periods.
- Journal entries (source-linked, immutable postings).
- Accounts receivable.
- Accounts payable.
- Customers and suppliers finance references.
- Rider settlement accounting linkage (consumes payroll and COD ledgers).
- VAT output ledger.
- VAT input ledger.
- Bank accounts and bank reconciliation.
- Payment allocation.
- Aging reports.
- Trial balance.
- Profit and loss.
- Balance sheet foundation.
- Audit trail for every finance action.
- Period close rules.
- Reversal-based correction flows for posted entries.

### 7.2 Saudi finance rules

- Output VAT and input VAT are tracked in **separate** ledgers. They are never netted silently.
- Customer invoice totals are **not** reduced by purchase invoices or input VAT.
- Posted entries are immutable; corrections use reversal entries only.
- ZATCA-relevant invoice data is source-linked and auditable from the invoice record back to its journal postings.
- Company profile, VAT rate, logo, QR, and invoice identity fields are DB-driven, not hardcoded.

### 7.3 UX rules

- Same AIDesigner language as every other module: page header + primary CTA, KPI cards where useful, search/filter/export toolbar, rounded glassmorphic tables, `group-hover` row actions, slide/fade motion, `rounded-2xl` modals.
- Bilingual EN/AR labels and toasts; full RTL.

### 7.4 Submodules (minimum)

1. Chart of Accounts
2. Journal Entries
3. Receivables
4. Payables
5. Customer Statements
6. Supplier Statements
7. Settlement Batches
8. Bank Reconciliation
9. VAT Center
10. Financial Reports
11. Accounting Period Close
12. Finance Settings

---

## 8. Final precedence and implementation directive

- Read the full v1.0 + v2.0 master file collection as the single source of truth. This reference summarizes v2.0; the underlying master prompts remain authoritative for any decision not captured here.
- Apply original module logic and platform standards exactly as specified.
- Apply Design DNA (section 4) for all visual design decisions.
- **On conflict, precedence is:** `AIDesigner UI lock` > `Design DNA` > `v1.0 generic visual guidance`. Business logic, DB, workflows, security, compliance, storage, migrations, APIs, audit, and Saudi rules remain in force regardless of visual decisions.
- **Do not** change data semantics, business math, module scope, or compliance behavior to fit the design. Design serves the domain, not the reverse.

---

## Document control

- **Status:** Canonical v2.0 reference.
- **Date:** 2026-07-19.
- **Supersedes:** `docs/elite-master-prompt.md` (v1.0) — **for the decisions captured above only**. All other v1.0 business logic remains in force.
- **Owner:** EliteDev engineering.
