// Shared outbound telemetry boundary. This module also runs in browsers/Edge:
// do not import Node APIs, environment secrets or runtime SDK code here.
import type { spanToJSON } from "@sentry/nextjs"
type SpanJSON = ReturnType<typeof spanToJSON>
const FILTERED = "[Filtered]"
const TRUNCATED = "[Truncated]"
const MAX_TEXT = 4096
const MAX_DEPTH = 8
const MAX_NODES = 512
const MAX_ITEMS = 64

// Match normalized keys, including dotted span attributes and HTTP headers.
const privateKey = /password|passwd|passphrase|token|secret|credential|authorization|cookie|apikey|servicerole|privatekey|certificate|csr|otp|vercelprotectionbypass|iban|bankaccount|nationalid|iqama|passport|email|phone|mobile|address|salary|wage|balance|amount|cardnumber|cvv|ipaddress|useragent|forwardedfor/
const privateContainers = new Set(["body", "requestbody", "formdata", "querystring", "user", "ip", "vars", "sdkprocessingmetadata"])
const normalized = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "")

/** Deliberately omit URL paths, queries, fragments and credentials. They may
 * contain signed capabilities, Storage object names or personal identifiers. */
export function scrubTelemetryText(value: string): string {
  if (value.length > MAX_TEXT) return TRUNCATED
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) return FILTERED
  return value
    .replace(/\b(?:https?|wss?|postgres(?:ql)?|rediss?|file):\/\/[^\s<>"'`]+/gi, (match) => {
      try {
        const url = new URL(match)
        return /^https?:$/.test(url.protocol) ? url.origin + "/[Filtered]" : FILTERED
      } catch { return FILTERED }
    })
    .replace(/\b[A-Za-z]:\\[^\s<>"']+/g, FILTERED)
    .replace(/\/[^\s<>"'`?#]*[?#][^\s<>"'`]+/g, FILTERED)
    .replace(/\bbot\d{5,}:[A-Za-z0-9_-]+/g, FILTERED)
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]+/gi, FILTERED)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, FILTERED)
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/g, FILTERED)
    .replace(/\b(?:password|passwd|passphrase|[a-z_]*token|secret|api[_-]?key|credential|authorization|cookie|x-vercel-protection-bypass|x-vercel-trusted-oidc-idp-token)\b["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}]+)/gi, FILTERED)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, FILTERED)
    .replace(/\bSA\d{22}\b/gi, FILTERED)
    .replace(/\b(?:966|00966)\d{9}\b|\b05\d{8}\b/g, FILTERED)
}

/** Copy only bounded JSON-like values. Never invoke getters or toJSON methods.
 * Failure, cycles, unsupported instances and exhausted budgets fail closed.
 * This is defense in depth: callers must still avoid free-form business data. */
function scrubWithResult(input: unknown): { value: unknown; complete: boolean } {
  let remaining = MAX_NODES
  let complete = true
  const ancestors = new WeakSet<object>()
  function visit(value: unknown, depth: number, parent = ""): unknown {
    if (--remaining < 0 || depth > MAX_DEPTH) { complete = false; return TRUNCATED }
    if (typeof value === "string") return scrubTelemetryText(value)
    if (value === null || typeof value === "boolean") return value
    if (typeof value === "number") {
      if (Number.isFinite(value)) return value
      complete = false
      return FILTERED
    }
    if (value === undefined) return undefined
    if (typeof value !== "object") { complete = false; return FILTERED }
    if (ancestors.has(value)) { complete = false; return FILTERED }
    ancestors.add(value)
    try {
      if (Array.isArray(value)) {
        const result: unknown[] = []
        for (let i = 0; i < Math.min(value.length, MAX_ITEMS); i++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i))
          if (descriptor && "value" in descriptor) result.push(visit(descriptor.value, depth + 1, parent))
          else { complete = false; result.push(FILTERED) }
          if (remaining <= 0) break
        }
        if (value.length > result.length) { complete = false; result.push(TRUNCATED) }
        return result
      }
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) { complete = false; return FILTERED }
      const result: Record<string, unknown> = Object.create(null)
      let count = 0
      for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue
        if (count++ >= MAX_ITEMS || remaining <= 0) { complete = false; result._truncated = TRUNCATED; break }
        // Untrusted keys can themselves contain credentials or personal data.
        const name = scrubTelemetryText(key)
        const kind = normalized(key)
        if (key.length > 128 || name !== key || ["__proto__", "constructor", "prototype"].includes(key)) continue
        // Omit whole protocol containers instead of replacing typed objects
        // (such as Sentry user/headers) with an invalid string.
        if (privateContainers.has(kind) || (parent === "request" && ["data", "headers", "cookies", "env"].includes(kind))) continue
        if (privateKey.test(kind)) {
          result[key] = FILTERED
          continue
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor || !("value" in descriptor)) { complete = false; result[key] = FILTERED }
        else if (typeof descriptor.value === "string" && /(?:url|uri|referer|referrer|filename)$/.test(kind)) {
          // Relative request/Storage URLs are capabilities too. Unknown paths
          // are omitted; absolute HTTP origins remain useful for diagnostics.
          try {
            const url = new URL(descriptor.value)
            result[key] = /^https?:$/.test(url.protocol) ? scrubTelemetryText(url.origin) : FILTERED
          } catch { result[key] = FILTERED }
        } else result[key] = visit(descriptor.value, depth + 1, kind)
      }
      return result
    } finally { ancestors.delete(value) }
  }
  try { const value = visit(input, 0); return { value, complete } }
  catch { return { value: FILTERED, complete: false } }
}

export function scrubTelemetry<T>(input: T): T {
  return scrubWithResult(input).value as T
}

/** SDK events/breadcrumbs/logs may be dropped. Never transmit a partial event
 * containing truncation markers in protocol arrays or required fields. */
export function scrubSentryTelemetry<T extends object>(input: T): T | null {
  const result = scrubWithResult(input)
  return result.complete && result.value !== null && typeof result.value === "object" ? result.value as T : null
}

/** The installed SDK cannot drop a span in this hook. On budget/shape failure,
 * retain only validated trace correlation/timing with an empty data object. */
export function scrubTelemetrySpan(input: SpanJSON): SpanJSON {
  const result = scrubSentryTelemetry(input)
  if (result) return result
  function own(key: keyof SpanJSON): unknown {
    try { return Object.getOwnPropertyDescriptor(input, key)?.value } catch { return undefined }
  }
  const trace = own("trace_id"), span = own("span_id"), start = own("start_timestamp"), end = own("timestamp")
  return {
    trace_id: typeof trace === "string" && /^[a-f0-9]{32}$/i.test(trace) ? trace : "0".repeat(32),
    span_id: typeof span === "string" && /^[a-f0-9]{16}$/i.test(span) ? span : "0".repeat(16),
    start_timestamp: typeof start === "number" && Number.isFinite(start) ? start : 0,
    ...(typeof end === "number" && Number.isFinite(end) ? { timestamp: end } : {}),
    description: FILTERED,
    data: {},
  }
}

/** Final Pino boundary, after interpolation, serializers and child bindings.
 * Never return the original line when parsing or scrubbing fails. */
export function scrubTelemetryLogLine(line: string): string {
  if (line.length > 65536) return '{"level":40,"msg":"[Telemetry omitted: size limit]"}\n'
  try {
    const entry: unknown = JSON.parse(line)
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("invalid log")
    return JSON.stringify(scrubTelemetry(entry)) + "\n"
  } catch { return '{"level":40,"msg":"[Telemetry omitted: invalid entry]"}\n' }
}
