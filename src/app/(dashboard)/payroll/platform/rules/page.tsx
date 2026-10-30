"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DEFAULT_RULE_DEFINITIONS, RULE_GROUPS } from "@/lib/payroll-engine/rules"
import { getPayrollRules, resetPayrollRules, savePayrollRules } from "@/lib/payroll-engine/server/admin-actions"
import type { RuleValues } from "@/lib/payroll-engine/rule-validation"
import { Notice, PageShell, buttonClass, inputClass, primaryButtonClass, useLang } from "@/components/payroll-engine/shared"

export default function PlatformPayrollRulesPage() {
  const { ar, tx } = useLang()
  const [saved, setSaved] = useState<RuleValues | null>(null)
  const [values, setValues] = useState<RuleValues>({})
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null)

  const load = useCallback(async () => {
    const r = await getPayrollRules()
    if (r.success) { setSaved(r.data.values); setValues(r.data.values); setName(r.data.name) } else setMessage({ kind: "err", text: r.error })
  }, [])
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t) }, [load])

  const changed = useMemo(() => saved ? Object.keys(values).filter(k => JSON.stringify(values[k]) !== JSON.stringify(saved[k])) : [], [values, saved])

  async function save() {
    setBusy(true); setMessage(null)
    const r = await savePayrollRules({ values: Object.fromEntries(changed.map(k => [k, values[k]])) })
    setBusy(false)
    if (!r.success) { setMessage({ kind: "err", text: r.error }); return }
    setMessage({ kind: "ok", text: tx(`${r.data.changed} rule(s) saved. Open draft runs and press Recalculate to apply them.`, `تم حفظ ${r.data.changed} قاعدة. افتح المسودات واضغط "إعادة احتساب" لتطبيقها.`) })
    await load()
  }

  async function reset(group: string | null) {
    if (!window.confirm(tx("Restore default values for this section?", "استعادة القيم الافتراضية لهذا القسم؟"))) return
    setBusy(true); setMessage(null)
    const r = await resetPayrollRules({ group })
    setBusy(false)
    if (!r.success) setMessage({ kind: "err", text: r.error }); else { setMessage({ kind: "ok", text: tx("Defaults restored", "تمت استعادة الافتراضيات") }); await load() }
  }

  return (
    <PageShell title={tx("Payroll rules", "قواعد الرواتب")} subtitle={`${tx("Active rule set", "مجموعة القواعد النشطة")}: ${name || "—"}`}
      actions={<><button className={buttonClass} disabled={busy || changed.length === 0} onClick={() => saved && setValues(saved)}>{tx("Discard changes", "تجاهل التغييرات")}</button>
        <button className={primaryButtonClass} disabled={busy || changed.length === 0} onClick={save}>{busy ? tx("Saving…", "جارٍ الحفظ…") : `${tx("Save", "حفظ")}${changed.length ? ` (${changed.length})` : ""}`}</button></>}>
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <Notice kind="info">{tx("Rule changes never alter approved runs. Each run stores the exact rules it was calculated with (see “Applied rules” on the run).", "لا تؤثر تغييرات القواعد على المسيرات المعتمدة. كل مسير يحفظ القواعد التي احتُسب بها (انظر \"القواعد المطبقة\").")}</Notice>
      {!saved ? <p className="text-sm text-muted-foreground">{tx("Loading…", "جارٍ التحميل…")}</p> : RULE_GROUPS.map(g => {
        const defs = DEFAULT_RULE_DEFINITIONS.filter(d => d.group === g.id).sort((a, b) => a.displayOrder - b.displayOrder)
        if (!defs.length) return null
        return (
          <section key={g.id} className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-semibold">{ar ? g.labelAr : g.label}</h2>
              <button className={buttonClass} disabled={busy} onClick={() => reset(g.id)}>{tx("Reset section", "استعادة القسم")}</button>
            </div>
            <div className="grid gap-4 p-4 md:grid-cols-2">
              {defs.map(d => {
                const v = values[d.key]
                const dirty = changed.includes(d.key)
                const label = `${ar ? d.labelAr : d.label}${d.unit ? ` (${d.unit})` : ""}`
                return (
                  <div key={d.key} className={`grid gap-1.5 rounded-lg p-2 ${dirty ? "bg-amber-50 dark:bg-amber-950/40" : ""}`}>
                    {d.valueType === "boolean" ? (
                      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={v === true} onChange={e => setValues({ ...values, [d.key]: e.target.checked })} />{label}</label>
                    ) : (
                      <label className="grid gap-1.5 text-sm font-medium">{label}
                        {d.valueType === "select" ? (
                          <select className={inputClass} value={String(v ?? "")} onChange={e => setValues({ ...values, [d.key]: e.target.value })}>{d.options?.map(o => <option key={o} value={o}>{o}</option>)}</select>
                        ) : d.valueType === "numeric" ? (
                          <input type="number" step="any" min={d.min} max={d.max} className={inputClass} value={String(v ?? "")} onChange={e => setValues({ ...values, [d.key]: e.target.value === "" ? "" : Number(e.target.value) })} />
                        ) : d.valueType === "json" ? (
                          <input className={inputClass} value={Array.isArray(v) ? v.join(", ") : String(v ?? "")} onChange={e => setValues({ ...values, [d.key]: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} />
                        ) : (
                          <input className={inputClass} value={String(v ?? "")} onChange={e => setValues({ ...values, [d.key]: e.target.value })} />
                        )}
                      </label>
                    )}
                    <span className="text-xs text-muted-foreground">{d.helpText}{d.helpText ? " · " : ""}{tx("Default", "الافتراضي")}: {Array.isArray(d.defaultValue) ? d.defaultValue.join(", ") : String(d.defaultValue)}</span>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </PageShell>
  )
}
