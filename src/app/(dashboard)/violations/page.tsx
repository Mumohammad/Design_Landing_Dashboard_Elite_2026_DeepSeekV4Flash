"use client"

// /violations — violations + deductions workflow (Prompt O Part 3).
// Composes `violations` + `violation_types` + `violation_deduction_ledger` +
// `external_fine_imports` over RLS reads; mutations ride the server actions.
// Tabs: violations list · deduction ledger · external fines · types admin.
// Cross-surface refresh rides the driver-events bus.

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ShieldAlert,
  Eye,
  DollarSign,
  Plus,
  Pencil,
  Scale,
  ReceiptText,
  FileDown,
  Settings2,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useTranslation } from "@/hooks/use-translation"
import { toast } from "sonner"
import { EnterpriseModulePage, type KpiCardData, type TableColumn } from "@/components/dashboard/enterprise-module-page"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { exportViolationsCsv } from "@/lib/violations-module/actions"
import { violationKpis } from "@/lib/violations-module/module-utils"
import { subscribeDriverChanged } from "@/lib/drivers/driver-events"
import {
  ApproveDialog,
  ViolationDetailDialog,
  ViolationDialog,
  WaiveDialog,
  type DriverOption,
  type ViolationRow,
  type ViolationTypeOption,
} from "./components/violation-dialogs"
import { LedgerTab, type LedgerRow } from "./components/ledger-tab"
import { FinesTab, type FineRow } from "./components/fines-tab"
import { TypesTab, type ViolationTypeRow } from "./components/types-tab"

const SEVERITY_META: Record<string, { ar: string; en: string; className: string }> = {
  minor: { ar: "بسيطة", en: "Minor", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  moderate: { ar: "متوسطة", en: "Moderate", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  major: { ar: "كبيرة", en: "Major", className: "bg-orange-500/15 text-orange-600 border-orange-500/20" },
  critical: { ar: "حرجة", en: "Critical", className: "bg-red-500/15 text-red-600 border-red-500/20" },
}

const STATUS_META: Record<string, { ar: string; en: string; className: string }> = {
  open: { ar: "مفتوحة", en: "Open", className: "bg-amber-500/15 text-amber-600 border-amber-500/20" },
  under_review: { ar: "تحت المراجعة", en: "Under review", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  disputed: { ar: "معترض", en: "Disputed", className: "bg-orange-500/15 text-orange-600 border-orange-500/20" },
  resolved: { ar: "محسومة", en: "Resolved", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" },
  deduction_applied: { ar: "خصم مطبق", en: "Deducted", className: "bg-purple-500/15 text-purple-600 border-purple-500/20" },
  waived: { ar: "معفاة", en: "Waived", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
  acknowledged: { ar: "معتمدة", en: "Acknowledged", className: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  escalated: { ar: "مصعدّة", en: "Escalated", className: "bg-red-500/15 text-red-600 border-red-500/20" },
  closed: { ar: "مغلقة", en: "Closed", className: "bg-gray-500/15 text-gray-600 border-gray-500/20" },
}

export default function ViolationsPage() {
  const { t } = useTranslation()
  const vm = t.violationsModule
  const isAr = t.common.status === "الحالة"

  const [violations, setViolations] = useState<ViolationRow[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [fines, setFines] = useState<FineRow[]>([])
  const [types, setTypes] = useState<ViolationTypeRow[]>([])
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [vehicles, setVehicles] = useState<{ id: string; plate_number: string | null }[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tab, setTab] = useState("violations")

  // Filters (list tab)
  const [search, setSearch] = useState("")
  const [fStatus, setFStatus] = useState("all")
  const [fSeverity, setFSeverity] = useState("all")
  const [fType, setFType] = useState("all")
  const [fDateFrom, setFDateFrom] = useState("")
  const [fDateTo, setFDateTo] = useState("")

  // Dialog state
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ViolationRow | null>(null)
  const [detailFor, setDetailFor] = useState<ViolationRow | null>(null)
  const [approveFor, setApproveFor] = useState<ViolationRow | null>(null)
  const [waiveFor, setWaiveFor] = useState<ViolationRow | null>(null)
  const [dialogSession, setDialogSession] = useState(0)

  const loadData = useCallback(async () => {
    const supabase = createClient()
    const [violRes, ledRes, fineRes, typeRes] = await Promise.all([
      supabase
        .from("violations")
        .select(
          "id,violation_ref,driver_id,vehicle_id,violation_type_id,source,severity,status,incident_date,incident_location,incident_description,deduction_amount,evidence_urls,reported_at,reported_by,reviewed_at,reviewed_by,review_notes,waiver_reason,waived_at,waived_by,dispute_deadline," +
            "driver:drivers(full_name_ar,driver_code),vehicle:vehicles(plate_number),violation_types(name_ar,name_en,category)"
        )
        .is("deleted_at", null)
        .order("reported_at", { ascending: false })
        .limit(500),
      supabase
        .from("violation_deduction_ledger")
        .select("id,violation_id,driver_id,deduction_amount,deduction_month,status,payroll_period_id,applied_at,rolled_back_at,rollback_reason,violation:violations(violation_ref),driver:drivers(full_name_ar,driver_code)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("external_fine_imports")
        .select("id,source,external_ref,external_source,vehicle_plate,violation_date,violation_location,violation_type_code,fine_amount,payment_deadline,status,match_notes,matched_driver_id")
        .order("imported_at", { ascending: false })
        .limit(500),
      supabase
        .from("violation_types")
        .select("id,code,name_ar,name_en,category,severity,default_deduction,warning_threshold,is_active")
        .is("deleted_at", null)
        .order("code", { ascending: true }),
    ])
    setViolations((violRes.data as unknown as ViolationRow[]) ?? [])
    setLedger((ledRes.data as unknown as LedgerRow[]) ?? [])
    setFines((fineRes.data as unknown as FineRow[]) ?? [])
    setTypes((typeRes.data as unknown as ViolationTypeRow[]) ?? [])
    setIsLoading(false)
  }, [])

  const loadPickers = useCallback(async () => {
    const supabase = createClient()
    const [drvRes, vehRes] = await Promise.all([
      supabase
        .from("drivers")
        .select("id,full_name_ar,driver_code")
        .is("deleted_at", null)
        .order("full_name_ar", { ascending: true })
        .limit(1000),
      supabase
        .from("vehicles")
        .select("id,plate_number")
        .is("deleted_at", null)
        .order("plate_number", { ascending: true })
        .limit(1000),
    ])
    setDrivers((drvRes.data as DriverOption[]) ?? [])
    setVehicles((vehRes.data as { id: string; plate_number: string | null }[]) ?? [])
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await loadData()
      await loadPickers()
      void cancelled
    })()
    return () => {
      cancelled = true
    }
  }, [loadData, loadPickers])

  // Cross-surface refresh: a violation created from a driver profile tab
  // refreshes this module (and vice versa).
  useEffect(() => {
    return subscribeDriverChanged((detail) => {
      if (detail.action === "violation") void loadData()
    })
  }, [loadData])

  const typeOptions: ViolationTypeOption[] = useMemo(
    () => types.filter((ty) => ty.is_active).map((ty) => ({
      id: ty.id,
      code: ty.code,
      name_ar: ty.name_ar,
      severity: ty.severity,
      default_deduction: ty.default_deduction,
    })),
    [types]
  )

  // Ledger rows per violation (feeds the detail timeline).
  const ledgerByViolation = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of ledger) m.set(r.violation_id, (m.get(r.violation_id) ?? 0) + 1)
    return m
  }, [ledger])

  const kpis = useMemo(
    () =>
      violationKpis(
        violations.map((v) => ({ status: v.status })),
        ledger.map((l) => ({ deduction_amount: l.deduction_amount, status: l.status, applied_at: l.applied_at })),
        new Date()
      ),
    [violations, ledger]
  )

  const kpiCards: KpiCardData[] = [
    { label: vm.kpiOpen, value: kpis.open, icon: ShieldAlert, color: "#F59E0B" },
    { label: vm.kpiUnderReview, value: kpis.underReview, icon: Eye, color: "#1E5A99" },
    { label: vm.kpiDeductedMonth, value: kpis.deductedThisMonth.toFixed(0), icon: DollarSign, color: "#8B5CF6" },
    { label: vm.kpiTotalDeductions, value: kpis.totalDeductions.toFixed(0), icon: Scale, color: "#EF4444" },
  ]

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return violations.filter((r) => {
      if (fStatus !== "all" && r.status !== fStatus) return false
      if (fSeverity !== "all" && r.severity !== fSeverity) return false
      if (fType !== "all" && r.violation_type_id !== fType) return false
      if (fDateFrom && (r.incident_date ?? "") < fDateFrom) return false
      if (fDateTo && (r.incident_date ?? "") > fDateTo) return false
      if (q && !`${r.violation_ref} ${r.driver?.full_name_ar ?? ""} ${r.driver?.driver_code ?? ""}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [violations, search, fStatus, fSeverity, fType, fDateFrom, fDateTo])

  async function handleExport() {
    const res = await exportViolationsCsv()
    if (res.success && res.csv) {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `violations-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(t.common.export)
    } else {
      toast.error(res.error ?? "Error")
    }
  }

  function refreshAll() {
    void loadData()
  }

  function openDetail(r: ViolationRow) {
    setDialogSession((s) => s + 1)
    setDetailFor(r)
  }

  const columns: TableColumn<ViolationRow>[] = [
    {
      key: "violation_ref",
      header: vm.colRef,
      render: (r) => (
        <button type="button" className="font-mono text-xs hover:underline" dir="ltr" onClick={() => openDetail(r)}>
          {r.violation_ref}
        </button>
      ),
    },
    {
      key: "driver",
      header: vm.colDriver,
      render: (r) =>
        r.driver_id ? (
          <Link href={`/drivers/${r.driver_id}`} className="font-medium hover:underline">{r.driver?.full_name_ar ?? "—"}</Link>
        ) : (
          <span className="font-medium">—</span>
        ),
    },
    { key: "type", header: vm.colType, render: (r) => r.violation_types?.name_ar ?? "—" },
    {
      key: "severity",
      header: vm.colSeverity,
      render: (r) => {
        const s = SEVERITY_META[r.severity] ?? SEVERITY_META.minor
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{isAr ? s.ar : s.en}</span>
      },
    },
    { key: "incident_date", header: vm.colIncidentDate, render: (r) => <span dir="ltr">{r.incident_date}</span> },
    {
      key: "status",
      header: t.common.status,
      render: (r) => {
        const s = STATUS_META[r.status] ?? STATUS_META.open
        return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.className}`}>{isAr ? s.ar : s.en}</span>
      },
    },
    {
      key: "deduction_amount",
      header: vm.colDeduction,
      render: (r) => <span dir="ltr" className="tabular-nums">{Number(r.deduction_amount ?? 0).toFixed(2)}</span>,
    },
    {
      key: "dispute_deadline",
      header: vm.colDisputeDeadline,
      render: (r) => (r.dispute_deadline ? <span dir="ltr" className="text-xs">{r.dispute_deadline}</span> : <span className="text-muted-foreground">—</span>),
    },
  ]

  const filterBar = (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-36">
        <Select value={fStatus} onValueChange={setFStatus}>
          <SelectTrigger className="h-9"><SelectValue placeholder={vm.filterStatus} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.common.all}</SelectItem>
            {Object.entries(STATUS_META).map(([k, v]) => (
              <SelectItem key={k} value={k}>{isAr ? v.ar : v.en}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="w-32">
        <Select value={fSeverity} onValueChange={setFSeverity}>
          <SelectTrigger className="h-9"><SelectValue placeholder={vm.filterSeverity} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.common.all}</SelectItem>
            {Object.entries(SEVERITY_META).map(([k, v]) => (
              <SelectItem key={k} value={k}>{isAr ? v.ar : v.en}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="w-40">
        <Select value={fType} onValueChange={setFType}>
          <SelectTrigger className="h-9"><SelectValue placeholder={vm.filterType} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.common.all}</SelectItem>
            {types.map((ty) => <SelectItem key={ty.id} value={ty.id}>{ty.name_ar}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Input dir="ltr" type="date" className="h-9 w-36" value={fDateFrom} onChange={(e) => setFDateFrom(e.target.value)} placeholder={vm.filterDateFrom} />
      <Input dir="ltr" type="date" className="h-9 w-36" value={fDateTo} onChange={(e) => setFDateTo(e.target.value)} placeholder={vm.filterDateTo} />
    </div>
  )

  return (
    <div className="px-4 lg:px-6 py-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-3">
          <TabsTrigger value="violations">{vm.tabViolations}</TabsTrigger>
          <TabsTrigger value="ledger">{vm.tabLedger}</TabsTrigger>
          <TabsTrigger value="fines">{vm.tabFines}</TabsTrigger>
          <TabsTrigger value="types"><Settings2 className="mr-1 inline h-3.5 w-3.5" />{vm.tabTypes}</TabsTrigger>
        </TabsList>

        <TabsContent value="violations" className="mt-0">
          <EnterpriseModulePage
            title={t.nav.violations}
            subtitle={vm.subtitle}
            kpiCards={kpiCards}
            searchPlaceholder={t.common.searchPlaceholder}
            searchValue={search}
            onSearchChange={setSearch}
            primaryCtaLabel={vm.addViolation}
            primaryCtaIcon={Plus}
            onPrimaryCta={() => { setDialogSession((s) => s + 1); setEditing(null); setCreateOpen(true) }}
            toolbarActions={
              <>
                {filterBar}
                <Button variant="outline" size="sm" onClick={handleExport}>
                  <FileDown className="mr-1 h-4 w-4" />
                  {t.common.export}
                </Button>
              </>
            }
            columns={columns}
            data={filtered}
            isLoading={isLoading}
            emptyStateMessage={t.common.noData}
            rowActions={(r) => (
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" title={t.common.details} onClick={() => openDetail(r)}>
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                {(r.status === "open" || r.status === "under_review") && (
                  <Button size="sm" variant="ghost" title={vm.editViolation} onClick={() => { setDialogSession((s) => s + 1); setEditing(r); setCreateOpen(true) }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
                {(r.status === "open" || r.status === "under_review") && (
                  <Button size="sm" variant="ghost" title={vm.approve} onClick={() => { setApproveFor(r) }}>
                    <ReceiptText className="h-3.5 w-3.5" />
                  </Button>
                )}
                {(r.status === "open" || r.status === "under_review") && (
                  <Button size="sm" variant="ghost" title={vm.waive} onClick={() => { setWaiveFor(r) }}>
                    <Scale className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )}
          />
        </TabsContent>

        <TabsContent value="ledger" className="mt-0">
          <LedgerTab rows={ledger} isLoading={isLoading} onRefresh={refreshAll} />
        </TabsContent>

        <TabsContent value="fines" className="mt-0">
          <FinesTab rows={fines} drivers={drivers} isLoading={isLoading} onRefresh={refreshAll} />
        </TabsContent>

        <TabsContent value="types" className="mt-0">
          <TypesTab rows={types} isLoading={isLoading} onRefresh={refreshAll} />
        </TabsContent>
      </Tabs>

      {createOpen && (
        <ViolationDialog
          key={`vio-${editing?.id ?? "new"}-${dialogSession}`}
          open
          violation={editing}
          drivers={drivers}
          vehicles={vehicles}
          types={typeOptions}
          onClose={() => { setCreateOpen(false); setEditing(null) }}
          onDone={(err) => {
            if (err) toast.error(err)
            else {
              toast.success(t.common.saved)
              setCreateOpen(false)
              setEditing(null)
              refreshAll()
            }
          }}
        />
      )}
      {detailFor != null && (
        <ViolationDetailDialog
          key={`detail-${detailFor.id}-${dialogSession}`}
          open
          violation={detailFor}
          ledgerCount={ledgerByViolation.get(detailFor.id) ?? 0}
          onClose={() => setDetailFor(null)}
          onAction={(action) => {
            const current = detailFor
            setDetailFor(null)
            if (action === "approve") setApproveFor(current)
            else setWaiveFor(current)
          }}
        />
      )}
      {approveFor != null && (
        <ApproveDialog
          key={`approve-${approveFor.id}-${dialogSession}`}
          open
          violation={approveFor}
          onClose={() => setApproveFor(null)}
          onDone={(err) => {
            if (err) toast.error(err)
            else {
              toast.success(t.common.saved)
              setApproveFor(null)
              refreshAll()
            }
          }}
        />
      )}
      {waiveFor != null && (
        <WaiveDialog
          key={`waive-${waiveFor.id}-${dialogSession}`}
          open
          violation={waiveFor}
          onClose={() => setWaiveFor(null)}
          onDone={(err) => {
            if (err) toast.error(err)
            else {
              toast.success(t.common.saved)
              setWaiveFor(null)
              refreshAll()
            }
          }}
        />
      )}
    </div>
  )
}
