"use client"

// Violation-types admin tab (Prompt O Part 3): the `violation_types` manager —
// code, category, severity, default deduction, warning threshold. Types are
// soft-deactivated (never hard-deleted: violations reference them by FK).

import { useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { deactivateViolationType, upsertViolationType } from "@/lib/violations-module/actions"
import { Pencil, Plus, PowerOff, Loader2 } from "lucide-react"

export interface ViolationTypeRow {
  id: string
  code: string
  name_ar: string
  name_en: string | null
  category: string
  severity: string
  default_deduction: number | null
  warning_threshold: number | null
  is_active: boolean
}

const SEVERITIES = ["minor", "moderate", "major", "critical"] as const

export function TypesTab({
  rows,
  isLoading,
  onRefresh,
}: {
  rows: ViolationTypeRow[]
  isLoading: boolean
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const vm = t.violationsModule
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ViolationTypeRow | null>(null)
  const [busy, setBusy] = useState(false)

  async function deactivate(ty: ViolationTypeRow) {
    if (!confirm(vm.deactivateTypeConfirm)) return
    setBusy(true)
    const res = await deactivateViolationType(ty.id)
    setBusy(false)
    if (res.success) {
      toast.success(t.common.saved)
      onRefresh()
    } else {
      toast.error(res.error ?? "Error")
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => { setEditing(null); setDialogOpen(true) }}>
          <Plus className="mr-1 h-4 w-4" />
          {vm.addType}
        </Button>
      </div>
      <div className="rounded-2xl border border-border/50 bg-card/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/20">
              <tr>
                {[vm.colTypeCode, vm.fieldTypeNameAr, vm.colCategory, vm.colSeverity, vm.colDefaultDeduction, vm.colWarningThreshold, t.common.actions].map((h) => (
                  <th key={h} className="px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">{t.common.loading}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">{vm.noTypes}</td></tr>
              ) : (
                rows.map((ty) => (
                  <tr key={ty.id} className={ty.is_active ? "" : "opacity-50"}>
                    <td className="px-4 py-2.5 text-sm"><span dir="ltr" className="font-mono text-xs">{ty.code}</span></td>
                    <td className="px-4 py-2.5 text-sm">{ty.name_ar}{ty.name_en ? <span className="ms-1 text-xs text-muted-foreground">{ty.name_en}</span> : null}</td>
                    <td className="px-4 py-2.5 text-sm">{ty.category}</td>
                    <td className="px-4 py-2.5 text-sm" dir="ltr">{ty.severity}</td>
                    <td className="px-4 py-2.5 text-sm tabular-nums" dir="ltr">{ty.default_deduction != null ? Number(ty.default_deduction).toFixed(2) : "—"}</td>
                    <td className="px-4 py-2.5 text-sm tabular-nums" dir="ltr">{ty.warning_threshold ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" title={t.common.edit} onClick={() => { setEditing(ty); setDialogOpen(true) }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {ty.is_active && (
                          <Button size="sm" variant="ghost" title={vm.deactivateType} onClick={() => void deactivate(ty)} disabled={busy}>
                            <PowerOff className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {dialogOpen && (
        <TypeDialog
          key={`type-${editing?.id ?? "new"}`}
          open
          typeRow={editing}
          onClose={() => { setDialogOpen(false); setEditing(null) }}
          onDone={(err) => {
            if (err) toast.error(err)
            else {
              toast.success(t.common.saved)
              setDialogOpen(false)
              setEditing(null)
              onRefresh()
            }
          }}
        />
      )}
    </div>
  )
}

function TypeDialog({
  open,
  typeRow,
  onClose,
  onDone,
}: {
  open: boolean
  typeRow: ViolationTypeRow | null
  onClose: () => void
  onDone: (err: string | null) => void
}) {
  const { t } = useTranslation()
  const vm = t.violationsModule
  const editing = typeRow != null

  const [code, setCode] = useState(typeRow?.code ?? "")
  const [nameAr, setNameAr] = useState(typeRow?.name_ar ?? "")
  const [nameEn, setNameEn] = useState(typeRow?.name_en ?? "")
  const [category, setCategory] = useState(typeRow?.category ?? "")
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>(
    (typeRow?.severity as (typeof SEVERITIES)[number]) ?? "minor"
  )
  const [deduction, setDeduction] = useState(typeRow?.default_deduction != null ? String(typeRow.default_deduction) : "0")
  const [threshold, setThreshold] = useState(String(typeRow?.warning_threshold ?? 3))
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!code.trim()) return onDone(vm.errCodeRequired ?? vm.fieldTypeCode)
    if (!nameAr.trim() || !category.trim()) return onDone(vm.errDescriptionRequired)
    const ded = Number(deduction)
    if (!Number.isFinite(ded) || ded < 0) return onDone(vm.errAmountInvalid)
    setBusy(true)
    const res = await upsertViolationType({
      ...(editing ? { id: typeRow.id } : {}),
      code,
      name_ar: nameAr,
      name_en: nameEn || null,
      category,
      severity,
      default_deduction: ded,
      warning_threshold: Number(threshold) || 3,
      is_active: editing ? typeRow.is_active : true,
    })
    setBusy(false)
    onDone(res.success ? null : (res.error ?? "Error"))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? vm.editType : vm.addType}</DialogTitle>
          <DialogDescription>{vm.addTypeDesc}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{vm.fieldTypeCode}</Label>
              <Input dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} />
            </div>
            <div className="grid gap-1.5">
              <Label>{vm.fieldTypeCategory}</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{vm.fieldTypeNameAr}</Label>
              <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} maxLength={120} />
            </div>
            <div className="grid gap-1.5">
              <Label>{vm.fieldTypeNameEn}</Label>
              <Input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} maxLength={120} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>{vm.fieldTypeSeverity}</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as (typeof SEVERITIES)[number])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{vm.fieldTypeDeduction}</Label>
              <Input dir="ltr" type="number" min={0} step="0.01" value={deduction} onChange={(e) => setDeduction(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{vm.fieldTypeThreshold}</Label>
              <Input dir="ltr" type="number" min={1} step="1" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.common.cancel}</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
