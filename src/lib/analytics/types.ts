// src/lib/analytics/types.ts
// Shared contract between the server-side aggregation action and the dashboard UI.
// Every number in the dashboard flows through this snapshot — no hardcoded KPIs.

export type DashboardPeriod = "7d" | "30d" | "90d" | "12m"

export interface DashboardFilters {
  /** Date range preset. */
  period: DashboardPeriod
  /** Platform code from delivery_platforms, or "all". */
  platform: string
  /** Driver category, or "all". */
  category: string
}

/** Approval queue depth by type (from fetch_pending_approvals, #52). */
export interface ApprovalsDepth {
  total: number
  expenses: number
  leaves: number
  applications: number
  /** Older than the stale threshold (approvals-utils isStale). */
  stale: number
}

/** COD reconciliation rollup (driver_cod_sessions, #53 rollup shape). */
export interface CodSnapshot {
  /** Sessions with unresolved variance. */
  pendingSessions: number
  /** Sum of cod_variance over pending sessions (positive = driver owes). */
  pendingVariance: number
  collected: number
  submitted: number
}

/** Accounting-sourced financial aggregates (Prompt I, src/lib/accounting/kpis.ts). */
export interface AccountingKpis {
  /** Finalized sales-invoice totals in the window. */
  revenue: number
  revenuePrevious: number
  /** Issued sales invoices not yet paid/credited (any issue date). */
  pendingInvoicesAmount: number
  pendingInvoicesCount: number
  /** Recorded expenses in the window. */
  expenses: number
  expensesPrevious: number
  /** revenue − expenses (invoice-side revenue; informational). */
  netResult: number
  available: boolean
}

/** A single KPI with previous-period comparison. */
export interface MetricValue {
  value: number
  previous: number
  /** value - previous */
  delta: number
  /** percentage change vs previous (0 when previous is 0). Rounded to 1dp. */
  pct: number
  /** Whether the source table/module is reachable. */
  available: boolean
}

export interface TrendPoint {
  /** ISO date (yyyy-MM-dd) — the client localizes the label. */
  date: string
  orders?: number
  completed?: number
  cancelled?: number
  failed?: number
  revenue?: number
  payroll?: number
  violations?: number
  penalties?: number
}

export interface PlatformMetric {
  code: string
  name: string
  orders: number
  revenue: number
  drivers: number
  /** 0–100 */
  completionRate: number
}

export type TargetStatus = "exceeded" | "on_track" | "below"

export interface DriverTargetRow {
  driverId: string
  name: string
  target: number
  actual: number
  /** 0–100+ */
  achievement: number
  netPayroll: number
  status: TargetStatus
}

export interface ComplianceBucket {
  valid: number
  expiring: number
  expired: number
}

export interface ComplianceSummary {
  iqama: ComplianceBucket
  license: ComplianceBucket
  insurance: ComplianceBucket
  registration: ComplianceBucket
}

export type ActionModule =
  | "documents"
  | "violations"
  | "applications"
  | "maintenance"
  | "payroll"

export interface ActionItem {
  id: string
  module: ActionModule
  severity: "critical" | "warning" | "info"
  count: number
  href: string
}

export type InsightKind = "positive" | "negative" | "neutral"

export interface Insight {
  id: string
  kind: InsightKind
  /** Template key rendered client-side (localized). */
  key:
    | "orders"
    | "completion"
    | "revenue"
    | "maintenance"
    | "best_platform"
    | "below_target"
  value: number
  /** Extra context, e.g. platform name for best_platform. */
  secondary?: string
}

export interface ActivityEvent {
  id: string
  type: "application" | "violation" | "maintenance" | "driver"
  /** Entity reference (application number, violation ref, driver name). */
  ref: string
  time: string
}

export interface DashboardSnapshot {
  generatedAt: string
  periodStart: string
  periodEnd: string
  /** Module reachability — false when a table is missing/query fails. */
  availability: Record<string, boolean>
  kpis: {
    totalDrivers: MetricValue
    activeDrivers: MetricValue
    totalVehicles: MetricValue
    inMaintenance: MetricValue
    totalOrders: MetricValue
    completionRate: MetricValue
    revenue: MetricValue
    netPayroll: MetricValue
    openViolations: MetricValue
    pendingApplications: MetricValue
    expiringDocuments: MetricValue
    expiredDocuments: MetricValue
    /** vehicles.status = 'available' right now. */
    availableVehicles: MetricValue
    /** vehicles.status = 'assigned' right now (#53 assignment wiring). */
    assignedVehicles: MetricValue
    /** Unified pending-decision queue depth (#52 RPC). Count-only — no PII. */
    openApprovals: MetricValue
    /** audit_log rows in the trailing window (#51). Count-only. */
    auditEvents: MetricValue
    /** COD sessions awaiting reconciliation. */
    codPendingSessions: MetricValue
  }
  /** Payroll module results for the latest calculated period. */
  payroll: {
    period: string
    gross: number
    bonuses: number
    deductions: number
    net: number
    avgNet: number
    aboveTarget: number
    belowTarget: number
    negativeBalance: number
    available: boolean
  }
  trends: {
    orders: TrendPoint[]
    revenue: TrendPoint[]
    violations: TrendPoint[]
  }
  approvals: ApprovalsDepth & { available: boolean }
  cod: CodSnapshot & { available: boolean }
  accounting: AccountingKpis
  platforms: PlatformMetric[]
  driverTargets: DriverTargetRow[]
  targetBuckets: { bucket: string; count: number }[]
  compliance: ComplianceSummary
  actions: ActionItem[]
  insights: Insight[]
  activity: ActivityEvent[]
}
