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
  platforms: PlatformMetric[]
  driverTargets: DriverTargetRow[]
  targetBuckets: { bucket: string; count: number }[]
  compliance: ComplianceSummary
  actions: ActionItem[]
  insights: Insight[]
  activity: ActivityEvent[]
}
