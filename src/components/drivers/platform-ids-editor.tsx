"use client"

import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DELIVERY_PLATFORMS, RIDER_ID_PATTERN, platformByCode } from "@/lib/drivers/platforms"

export interface PlatformIdRow { code: string; riderId: string }

export function PlatformDot({ code, className = "size-2.5" }: { code: string; className?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ring-1 ring-black/10 ${className}`} style={{ background: platformByCode(code)?.color ?? "#1E5A99" }} />
}

export function platformRowsError(rows: PlatformIdRow[], isAr: boolean): string | null {
  const filled = rows.filter((r) => r.code || r.riderId.trim())
  for (const r of filled) {
    if (!r.code) return isAr ? "اختر المنصة لكل رقم مندوب." : "Choose a platform for every rider ID."
    if (!RIDER_ID_PATTERN.test(r.riderId.trim())) return isAr ? "رقم المندوب يقبل الحروف والأرقام والنقطة والشرطة فقط." : "Rider IDs may contain letters, digits, dot, dash, slash or underscore."
  }
  if (new Set(filled.map((r) => r.code)).size !== filled.length) return isAr ? "لكل منصة رقم مندوب واحد فقط." : "Each platform can have only one rider ID."
  return null
}

/** Repeatable platform + rider ID rows (HungerStation, Keeta, Jahez, ...). */
export function PlatformIdsEditor({ rows, onChange, isAr, idPrefix }: { rows: PlatformIdRow[]; onChange: (rows: PlatformIdRow[]) => void; isAr: boolean; idPrefix: string }) {
  const used = new Set(rows.map((r) => r.code))
  const update = (i: number, patch: Partial<PlatformIdRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="grid gap-2">
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
          <Select value={row.code || undefined} onValueChange={(v) => update(i, { code: v })}>
            <SelectTrigger id={`${idPrefix}-platform-${i}`} aria-label={isAr ? "المنصة" : "Platform"} className="w-full data-[size=default]:h-10">
              <SelectValue placeholder={isAr ? "اختر المنصة" : "Choose platform"} />
            </SelectTrigger>
            <SelectContent>
              {DELIVERY_PLATFORMS.map((p) => (
                <SelectItem key={p.code} value={p.code} disabled={used.has(p.code) && p.code !== row.code}>
                  <PlatformDot code={p.code} />
                  {isAr ? p.ar : p.en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            id={`${idPrefix}-rider-${i}`}
            aria-label={isAr ? "رقم المندوب على المنصة" : "Platform rider ID"}
            value={row.riderId}
            onChange={(e) => update(i, { riderId: e.target.value })}
            className="h-10 font-mono"
            dir="ltr"
            maxLength={64}
            placeholder={isAr ? "رقم المندوب" : "Rider ID"}
          />
          <Button type="button" variant="ghost" size="icon" aria-label={isAr ? "حذف" : "Remove"} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" disabled={used.size >= DELIVERY_PLATFORMS.length}
        onClick={() => onChange([...rows, { code: DELIVERY_PLATFORMS.find((p) => !used.has(p.code))?.code ?? "", riderId: "" }])}>
        <Plus className="size-3.5" />
        {isAr ? "إضافة منصة" : "Add platform"}
      </Button>
      <p className="text-[11px] text-muted-foreground">
        {isAr ? "أول منصة تُعتمد كمنصة رئيسية، وتُنشأ بطاقة هوية بشعار كل منصة تلقائياً." : "The first platform becomes primary; a branded ID card is generated for every platform automatically."}
      </p>
    </div>
  )
}
