"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type BankOption = { id: string; bank_name: string; account_name: string; currency: string }
const pageSize = 25

/** Loads active choices independently of the paginated bank-management list. */
export function BankAccountPicker({ value, onChange, ar, disabled = false, idPrefix = "pay", legend, testId = "payment-bank-picker" }: {
  value: string; onChange: (id: string) => void; ar: boolean; disabled?: boolean
  /** Distinct control IDs when more than one picker can be mounted. */
  idPrefix?: string; legend?: string; testId?: string
}) {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{ rows: BankOption[]; count: number; loading: boolean; error: boolean }>({
    rows: [], count: 0, loading: true, error: false,
  })
  const [selected, setSelected] = useState<BankOption | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setResult({ rows: [], count: 0, loading: true, error: false })
      try {
        const literal = search.trim().replace(/[\\%_]/g, "\\$&")
        const { data, count, error } = await createClient().from("bank_accounts")
          .select("id,bank_name,account_name,currency", { count: "exact" })
          .eq("is_active", true).is("deleted_at", null)
          .ilike("bank_name", `%${literal}%`)
          .order("bank_name").order("id")
          .range(page * pageSize, (page + 1) * pageSize - 1)
          .abortSignal(controller.signal)
        if (!controller.signal.aborted) setResult({ rows: data ?? [], count: count ?? 0, loading: false, error: !!error })
      } catch {
        if (!controller.signal.aborted) setResult({ rows: [], count: 0, loading: false, error: true })
      }
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [search, page, retry])

  const options = selected?.id === value && !result.rows.some((bank) => bank.id === value)
    ? [selected, ...result.rows] : result.rows
  function resetResults() { setResult({ rows: [], count: 0, loading: true, error: false }) }

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2 rounded-lg border p-3" data-testid={testId}>
      <legend className="px-1 text-sm font-medium">{legend ?? (ar ? "الحساب البنكي" : "Bank account")}</legend>
      <Label htmlFor={`${idPrefix}BankSearch`}>{ar ? "البحث باسم البنك" : "Search bank name"}</Label>
      <Input id={`${idPrefix}BankSearch`} value={search} maxLength={200} onChange={(event) => {
        setSearch(event.target.value); setPage(0); resetResults()
      }} />
      <Label htmlFor={`${idPrefix}Bank`} className="sr-only">{ar ? "اختيار الحساب البنكي" : "Select bank account"}</Label>
      <select id={`${idPrefix}Bank`} value={value} disabled={result.loading || result.error}
        onChange={(event) => {
          onChange(event.target.value)
          setSelected(options.find((bank) => bank.id === event.target.value) ?? null)
        }} className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring">
        <option value="">{ar ? "اختر حساباً" : "Choose an account"}</option>
        {options.map((bank) => <option key={bank.id} value={bank.id}>{bank.bank_name} · {bank.account_name} ({bank.currency})</option>)}
      </select>
      <div role="status" className="text-xs text-muted-foreground">
        {result.loading ? (ar ? "جارٍ التحميل…" : "Loading…") : result.error ? (
          <><span>{ar ? "تعذر تحميل الحسابات." : "Unable to load accounts."}</span>{" "}<Button type="button" size="sm" variant="outline" onClick={() => { resetResults(); setRetry((n) => n + 1) }}>{ar ? "إعادة المحاولة" : "Retry"}</Button></>
        ) : result.count === 0 ? (ar ? "لا توجد حسابات نشطة مطابقة." : "No matching active accounts.")
          : `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, result.count)} / ${result.count}`}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={result.loading || result.error || page === 0}
          onClick={() => { resetResults(); setPage((n) => n - 1) }}>{ar ? "السابق" : "Previous accounts"}</Button>
        <Button type="button" variant="outline" size="sm" disabled={result.loading || result.error || (page + 1) * pageSize >= result.count}
          onClick={() => { resetResults(); setPage((n) => n + 1) }}>{ar ? "التالي" : "Next accounts"}</Button>
      </div>
    </fieldset>
  )
}
