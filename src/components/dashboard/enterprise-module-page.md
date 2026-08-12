# EnterpriseModulePage

The reusable CRUD module page component pattern mandated by **ADR-015** (AIDesigner UI lock) and
the Design DNA in `docs/elite-master-prompt-v2.md` (sections 3.7, 3.8, 4.4, 4.5, 4.9). Every
CRUD module page (Drivers, Vehicles, Violations, Payroll, Accounting, …) renders its primary
list view through this component so the AIDesigner UI lock stays immutable across all 18 modules.

> **Phase status:** This is a **Phase 1 scaffold**. The component + this doc land in Phase 1.
> Actual module pages adopt it in **Phase 3+** (per `docs/implementation-plan.md`, line 333:
> _"Phase 1 documents the pattern; actual module pages adopt it in their phases"_).

---

## 1. Why it exists

ADR-015 declares the `EnterpriseModulePage` pattern immutable:

> _"EnterpriseModulePage pattern (header → KPI cards → toolbar → data table → pagination → dialog)"_
> and _"Never remove the EnterpriseModulePage pattern."_ (Design DNA §4.9)

Centralizing the pattern in one typed component means:

- The 6-section layout, token classes, gradient CTA, KPI decorative circle, hover row actions,
  skeleton/empty states, and pagination chrome can never drift between modules.
- Every module gets consistent accessibility, RTL behavior, and loading states for free.
- The AIDesigner UI lock is enforced by construction — a module author cannot accidentally swap
  the table container or drop the `backdrop-blur-sm`.

---

## 2. The six sections

The component renders, in order:

| # | Section | AIDesigner spec | Rendered when |
|---|---------|-----------------|---------------|
| 1 | **Page header** | `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4`; title `text-2xl font-bold tracking-tight text-foreground`; subtitle `text-sm text-muted-foreground mt-1`; primary CTA = elite-blue gradient. | Always (subtitle + CTA optional). |
| 2 | **KPI cards** | `grid grid-cols-2 md:grid-cols-4 gap-4`; each card `rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm p-4 shadow-sm hover:shadow-md`; decorative circle `opacity-[0.06]` in brand color. | `kpiCards` provided and non-empty. |
| 3 | **Toolbar** | `flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between`; search `pl-10 h-9 bg-muted/30 border-0 rounded-xl`; outline buttons `size="sm" rounded-lg h-8 text-xs`. | Always (search). `toolbarActions` optional. |
| 4 | **Data table** | Container `rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm shadow-sm`; header `bg-muted/30 uppercase`; body `divide-y divide-border/30 hover:bg-muted/20`; row actions `opacity-0 group-hover:opacity-100`. | Always. Skeleton when `isLoading`; empty state when `data.length === 0`. |
| 5 | **Pagination** | `border-t border-border/30 px-4 py-3`; left "X records · Page N of M" in `text-xs text-muted-foreground`; right `ChevronLeft`/`Right` ghost icon buttons `h-7 w-7 rounded-lg`. | `pagination` prop provided. |
| 6 | **Dialog / form** | `rounded-2xl max-w-4xl max-h-[85vh] overflow-y-auto`. | `children` provided. Parent controls dialog open state. |

---

## 3. Props

The component is generic over the row entity type: `EnterpriseModulePage<T extends { id?: string }>`.

```ts
import * as React from "react"

export interface KpiCardData {
  label: string
  value: string | number
  icon?: React.ComponentType<{ className?: string }>
  color?: string // brand color for decorative circle, e.g. "#1E5A99" (default)
}

export interface TableColumn<T> {
  key: keyof T | string
  header: string
  render?: (row: T) => React.ReactNode
  className?: string
}

export interface PaginationData {
  totalRecords: number
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

export interface EnterpriseModulePageProps<T> {
  // Header
  title: string
  subtitle?: string
  primaryCtaLabel?: string
  onPrimaryCta?: () => void
  primaryCtaIcon?: React.ComponentType<{ className?: string }>

  // KPI cards (optional)
  kpiCards?: KpiCardData[]

  // Toolbar
  searchPlaceholder?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  toolbarActions?: React.ReactNode // export/import dropdowns, filter buttons

  // Table
  columns: TableColumn<T>[]
  data: T[]
  rowActions?: (row: T) => React.ReactNode // rendered on hover
  onRowClick?: (row: T) => void
  emptyStateMessage?: string
  emptyStateAction?: { label: string; onClick: () => void }

  // Pagination (optional)
  pagination?: PaginationData

  // Loading
  isLoading?: boolean

  // Children (for dialog/form content rendered by parent)
  children?: React.ReactNode

  // className override
  className?: string
}
```

Exports from `@/components/dashboard/enterprise-module-page`:

- `EnterpriseModulePage` (the component)
- `KpiCardData`, `TableColumn`, `PaginationData`, `EnterpriseModulePageProps` (types)

---

## 4. Usage example (Drivers module)

The parent page owns all state (search, dialog open, form) and pulls **all** visible strings from
`useTranslation()` — the component itself never calls `useTranslation()`, so it can be used in both
client and server contexts.

```tsx
"use client"

import * as React from "react"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import {
  EnterpriseModulePage,
  type TableColumn,
  type KpiCardData,
  type PaginationData,
} from "@/components/dashboard/enterprise-module-page"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useTranslation } from "@/lib/i18n/use-translation"
import { DriverForm } from "./driver-form"

interface Driver {
  id: string
  name: string
  phone: string
  status: "active" | "inactive"
  ordersThisMonth: number
}

export function DriversPage() {
  const t = useTranslation()
  const [search, setSearch] = React.useState("")
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [drivers, setDrivers] = React.useState<Driver[]>([])

  const columns: TableColumn<Driver>[] = [
    { key: "name", header: t.common.name },
    { key: "phone", header: t.common.phone },
    {
      key: "status",
      header: t.common.status,
      render: (d) => <StatusBadge status={d.status} />,
    },
    {
      key: "ordersThisMonth",
      header: t.drivers.ordersThisMonth,
      render: (d) => <span className="tabular-nums">{d.ordersThisMonth}</span>,
    },
  ]

  const kpiCards: KpiCardData[] = [
    { label: t.drivers.totalDrivers, value: drivers.length, color: "#1E5A99" },
    { label: t.drivers.activeDrivers, value: 0, color: "#16a34a" },
    { label: t.drivers.onLeave, value: 0, color: "#E87D3E" },
    { label: t.drivers.avgOrders, value: 0, color: "#1E5A99" },
  ]

  const pagination: PaginationData = {
    totalRecords: drivers.length,
    currentPage: 1,
    totalPages: 1,
    onPageChange: () => {},
  }

  return (
    <EnterpriseModulePage<Driver>
      title={t.drivers.title}
      subtitle={t.drivers.subtitle}
      primaryCtaLabel={t.common.addNew}
      onPrimaryCta={() => setDialogOpen(true)}
      kpiCards={kpiCards}
      searchPlaceholder={t.common.searchPlaceholder}
      searchValue={search}
      onSearchChange={setSearch}
      columns={columns}
      data={drivers}
      isLoading={isLoading}
      emptyStateMessage={t.drivers.noDrivers}
      emptyStateAction={{ label: t.common.addNew, onClick: () => setDialogOpen(true) }}
      pagination={pagination}
      rowActions={(d) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setDialogOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" /> {t.common.edit}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" /> {t.common.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    >
      {/* 6. Dialog — parent controls open state */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-2xl max-w-4xl max-h-[85vh] overflow-y-auto">
          <DriverForm onSubmit={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </EnterpriseModulePage>
  )
}
```

---

## 5. Notes & conventions

- **KPI cards are optional.** Omit `kpiCards` (or pass `[]`) on modules that have no KPI strip
  (e.g. settings sub-pages). The grid section is skipped entirely.
- **The `children` prop is where the create/edit Dialog goes.** The parent owns the dialog's open
  state and renders a `Dialog`/`DialogContent` (with `rounded-2xl max-w-4xl max-h-[85vh]
  overflow-y-auto`) as the child. The component does not open/close dialogs itself.
- **Row actions appear on hover** via the `group` class on `<tr>` and `opacity-0
  group-hover:opacity-100 transition-opacity` on the action wrapper (Design DNA §4.5, §4.9). Pass
  `rowActions={(row) => <DropdownMenu>…</DropdownMenu>}`.
- **Skeleton loading state** shows when `isLoading === true`: 5 `SkeletonRow`s render with
  `animate-pulse` bars. Design DNA §4.5 notes a 300ms delay before showing skeletons; apply that
  delay in the parent's data-fetch hook, not here.
- **Empty state** shows when `data.length === 0 && !isLoading`, using `emptyStateMessage` and the
  optional `emptyStateAction` (renders an elite-blue "add" button).
- **Pagination is optional.** Pass `pagination` only for server-side paginated lists. For short
  client-filtered lists, omit it.
- **i18n:** the component never calls `useTranslation()`. Pass translated strings as props
  (`title`, `subtitle`, `searchPlaceholder`, `emptyStateMessage`, column `header`s, etc.) so the
  same component works in both client and server rendering contexts and respects the current
  EN/AR locale chosen by the parent.
- **Row keys** use `row.id ?? index`. Prefer entities with a stable `id`.
- **Token classes only.** The component uses AIDesigner tokens (`elite-blue-500/600/700`,
  `border-border/50`, `bg-card/60`, `bg-muted/30`, `backdrop-blur-sm`, `text-foreground`,
  `text-muted-foreground`, etc.). The **only** raw hex is the KPI decorative circle `color`, which
  is passed as a prop (defaults to `#1E5A99`, the elite-blue anchor) — this is the approved
  decorative-circle treatment from Design DNA §3.8 / §4.6.
- **Icons:** `lucide-react` only (Design DNA §4.9).

---

## 6. Phase roadmap

- **Phase 1 (this file + component):** pattern documented and component implemented. No module
  pages consume it yet.
- **Phase 3+:** each CRUD module page (Drivers, Vehicles, …) refactors its list view to render
  through `EnterpriseModulePage`, passing server-side data, real pagination, and translated strings.
- **Phase 2+** migrations provide the `id`, `status`, and counted KPI values the component
  expects.

---

## References

- `docs/architecture-decisions.md` — **ADR-015** (AIDesigner UI lock), ADR-016 (Design DNA tokens).
- `docs/elite-master-prompt-v2.md` — §3.7 (immutable layout rules), §3.8 (component rules),
  §4.4 (spacing & layout), §4.5 (component patterns), §4.9 (strict non-negotiables).
- `docs/implementation-plan.md` — line 331-333 (Shell + dashboard chrome, EnterpriseModulePage
  pattern), line 352 (acceptance criterion: pattern documented).
- `src/app/globals.css` — `elite-blue-*` / `elite-orange-*` scales and semantic tokens the
  component depends on.
- `src/lib/i18n/translations.ts` — `common.searchPlaceholder`, `common.addNew`, `common.actions`,
  `common.export`, `common.import`, `common.print`, `common.filter`, etc.
