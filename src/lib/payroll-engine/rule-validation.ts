import { DEFAULT_RULE_DEFINITIONS, getDefaultRuleMap, type RuleDefinition } from "./rules"

export type RuleValue = number | string | boolean | string[]
export type RuleValues = Record<string, RuleValue>

const BY_KEY = new Map<string, RuleDefinition>(DEFAULT_RULE_DEFINITIONS.map(d => [d.key, d]))

/** Every defined rule with its default — the upstream backfill on first use. */
export function completeRuleValues(stored: Record<string, unknown> | null | undefined): RuleValues {
  const values = getDefaultRuleMap() as RuleValues
  for (const [key, v] of Object.entries(stored ?? {})) {
    const def = BY_KEY.get(key)
    if (!def) continue
    const checked = coerceRuleValue(def, v)
    if (checked.ok) values[key] = checked.value
  }
  return values
}

export function coerceRuleValue(def: RuleDefinition, v: unknown): { ok: true; value: RuleValue } | { ok: false; error: string } {
  switch (def.valueType) {
    case "numeric": {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN
      if (!Number.isFinite(n)) return { ok: false, error: `${def.label}: a number is required` }
      if (def.min !== undefined && n < def.min) return { ok: false, error: `${def.label}: minimum is ${def.min}` }
      if (def.max !== undefined && n > def.max) return { ok: false, error: `${def.label}: maximum is ${def.max}` }
      return { ok: true, value: n }
    }
    case "boolean":
      if (typeof v === "boolean") return { ok: true, value: v }
      if (v === "true" || v === "false") return { ok: true, value: v === "true" }
      return { ok: false, error: `${def.label}: true or false is required` }
    case "select": {
      const s = String(v ?? "")
      if (def.options && !def.options.includes(s)) return { ok: false, error: `${def.label}: choose one of ${def.options.join(", ")}` }
      return { ok: true, value: s }
    }
    case "json":
      if (Array.isArray(v) && v.every(x => typeof x === "string")) return { ok: true, value: v as string[] }
      return { ok: false, error: `${def.label}: a list of text values is required` }
    default:
      return { ok: true, value: String(v ?? "").slice(0, 200) }
  }
}

export function validateRuleUpdates(updates: Record<string, unknown>): { ok: true; values: RuleValues } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const values: RuleValues = {}
  for (const [key, v] of Object.entries(updates)) {
    const def = BY_KEY.get(key)
    if (!def) { errors.push(`Unknown rule: ${key}`); continue }
    const checked = coerceRuleValue(def, v)
    if (checked.ok) values[key] = checked.value
    else errors.push(checked.error)
  }
  // Division guards the engine relies on.
  for (const key of ["standard_working_days", "monthly_target_orders"]) {
    if (key in values && Number(values[key]) <= 0) errors.push(`${BY_KEY.get(key)?.label ?? key}: must be greater than zero`)
  }
  return errors.length ? { ok: false, errors } : { ok: true, values }
}
