// Allowlist HTML sanitizer for user-authored rich text (invoice notes/terms).
// Dependency-free and isomorphic: the output is rebuilt token by token, so
// only known tags, a handful of validated inline styles and safe links can
// ever reach the printed invoice, PDF or preview. Anything else becomes text.

export const RICH_TEXT_MAX_HTML = 20_000
export const RICH_TEXT_MAX_TEXT = 2_000

const VOID_TAGS = new Set(["br", "hr"])
const ALLOWED_TAGS = new Set(["b", "strong", "i", "em", "u", "s", "strike", "del", "br", "hr", "p", "div", "span", "font", "ul", "ol", "li", "a"])
// Content of these is dropped entirely, not shown as text.
const DROP_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "noscript", "template", "textarea", "select", "svg", "math", "head", "title"])
const RENAME: Record<string, string> = { strong: "b", em: "i", strike: "s", del: "s", font: "span" }

const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)|transparent)$/i
const FONT_SIZE = /^(\d{1,2}(\.\d)?)px$/
const ALIGN = new Set(["left", "right", "center", "justify", "start", "end"])
const FONT_SIZE_KEYWORDS: Record<string, number> = { "x-small": 10, small: 13, medium: 16, large: 18, "x-large": 24, "xx-large": 32 }
const LEGACY_FONT_SIZES: Record<string, number> = { "1": 10, "2": 13, "3": 16, "4": 18, "5": 24, "6": 32, "7": 48 }

function escapeText(value: string): string {
  // Keep valid entities from contentEditable output; escape everything else.
  return value
    .replace(/&(?!(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});)/gi, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
function decodeAttr(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Math.min(Number(d), 0x10ffff)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
}

function parseAttrs(source: string): Map<string, string> {
  const attrs = new Map<string, string>()
  const re = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    const name = m[1].toLowerCase()
    if (!attrs.has(name)) attrs.set(name, decodeAttr(m[2] ?? m[3] ?? m[4] ?? ""))
  }
  return attrs
}

function cleanColor(value: string): string | null {
  const v = value.trim().toLowerCase()
  return COLOR.test(v) ? v : null
}

function cleanStyle(style: string | undefined, extra: { color?: string; size?: string; align?: string }): string {
  const out = new Map<string, string>()
  for (const decl of (style ?? "").split(";")) {
    const i = decl.indexOf(":")
    if (i < 0) continue
    const prop = decl.slice(0, i).trim().toLowerCase()
    const value = decl.slice(i + 1).trim().toLowerCase().replace(/\s*!important$/, "")
    if (/[\\(]/.test(value) && !/^rgba?\(/.test(value)) continue // no url(), expression(), escapes
    if (prop === "color" || prop === "background-color") {
      const c = cleanColor(value)
      if (c) out.set(prop, c)
    } else if (prop === "font-size") {
      const kw = FONT_SIZE_KEYWORDS[value]
      const px = kw ?? (FONT_SIZE.test(value) ? Number(value.slice(0, -2)) : NaN)
      if (px >= 8 && px <= 48) out.set(prop, `${px}px`)
    } else if (prop === "text-align") {
      if (ALIGN.has(value)) out.set(prop, value)
    } else if (prop === "font-weight") {
      if (value === "bold" || value === "700" || value === "normal" || value === "400") out.set(prop, value)
    } else if (prop === "font-style") {
      if (value === "italic" || value === "normal") out.set(prop, value)
    } else if (prop === "text-decoration" || prop === "text-decoration-line") {
      const parts = value.split(/\s+/).filter((p) => p === "underline" || p === "line-through")
      if (parts.length) out.set("text-decoration", parts.join(" "))
    }
  }
  if (extra.color) { const c = cleanColor(extra.color); if (c) out.set("color", c) }
  if (extra.size && LEGACY_FONT_SIZES[extra.size.trim()]) out.set("font-size", `${LEGACY_FONT_SIZES[extra.size.trim()]}px`)
  if (extra.align && ALIGN.has(extra.align.trim().toLowerCase())) out.set("text-align", extra.align.trim().toLowerCase())
  return [...out].map(([k, v]) => `${k}: ${v}`).join("; ")
}

function cleanHref(value: string | undefined): string | null {
  if (!value) return null
  // Strip whitespace/control chars browsers ignore inside schemes ("java\tscript:").
  const v = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, "")
  if (/^https?:\/\/[^\s]+$/i.test(v) || /^mailto:[^\s]+$/i.test(v) || /^tel:\+?[0-9-]{3,20}$/i.test(v)) return v.slice(0, 2000)
  return null
}

/** Sanitize rich-text HTML to a strict allowlist. Always returns balanced markup. */
export function sanitizeRichText(input: string | null | undefined): string {
  const html = (input ?? "").slice(0, RICH_TEXT_MAX_HTML * 2).replace(/<!--[\s\S]*?(-->|$)/g, "")
  const out: string[] = []
  const stack: string[] = [] // source tag names (for matching closers)
  const emitted: string[] = [] // tag actually written for each open element
  let dropDepth = 0
  let dropTag = ""
  const tokenRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*?)?)\s*\/?>|<|[^<]+/g
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(html))) {
    const token = m[0]
    if (!m[1]) {
      if (!dropDepth) out.push(token === "<" ? "&lt;" : escapeText(token))
      continue
    }
    const closing = token.startsWith("</")
    const raw = m[1].toLowerCase()
    if (DROP_CONTENT.has(raw)) {
      if (!closing && !token.endsWith("/>")) { if (!dropDepth) dropTag = raw; if (dropTag === raw) dropDepth++ }
      else if (closing && dropTag === raw && dropDepth) dropDepth--
      continue
    }
    if (dropDepth || !ALLOWED_TAGS.has(raw)) continue
    const tag = RENAME[raw] ?? raw
    if (closing) {
      const at = stack.lastIndexOf(tag)
      if (at < 0) continue
      while (stack.length > at) { stack.pop(); out.push(`</${emitted.pop()}>`) }
      continue
    }
    if (VOID_TAGS.has(tag)) { out.push(`<${tag}>`); continue }
    const attrs = parseAttrs(m[2] ?? "")
    const style = cleanStyle(attrs.get("style"), raw === "font" ? { color: attrs.get("color"), size: attrs.get("size") } : { align: attrs.get("align") })
    let open = `<${tag}`
    if (tag === "a") {
      const href = cleanHref(attrs.get("href"))
      if (!href) { stack.push("a"); emitted.push("span"); out.push("<span>"); continue }
      open += ` href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer nofollow"`
    }
    if (style) open += ` style="${escapeAttr(style)}"`
    if (tag === "p" || tag === "div") { const dir = attrs.get("dir"); if (dir === "rtl" || dir === "ltr" || dir === "auto") open += ` dir="${dir}"` }
    out.push(open + ">")
    stack.push(tag)
    emitted.push(tag)
    if (stack.length > 64) break
  }
  while (emitted.length) out.push(`</${emitted.pop()}>`)
  return out.join("").slice(0, RICH_TEXT_MAX_HTML)
}

const HAS_MARKUP = /<\/?(b|strong|i|em|u|s|strike|del|br|hr|p|div|span|font|ul|ol|li|a)\b[^>]*>/i

/** True when the stored value was authored in the rich editor (vs legacy plain text). */
export function isRichText(value: string | null | undefined): boolean {
  return HAS_MARKUP.test(value ?? "")
}

/** Safe HTML for display: rich values are sanitized, legacy plain text is escaped with line breaks kept. */
export function richTextToSafeHtml(value: string | null | undefined): string {
  const v = value ?? ""
  if (!v.trim()) return ""
  if (isRichText(v)) return sanitizeRichText(v)
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>")
}

/** Plain text (for lists, CSV, emails, length limits). */
export function richTextToPlain(value: string | null | undefined): string {
  const v = value ?? ""
  if (!isRichText(v)) return v
  return sanitizeRichText(v)
    .replace(/<(br|hr)>/g, "\n")
    .replace(/<(ul|ol)[^>]*>/g, "\n")
    .replace(/<li[^>]*>/g, "• ")
    .replace(/<\/(p|div|li|ul|ol)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Normalise editor output for storage: sanitized, empty editors become "". */
export function normalizeRichText(value: string | null | undefined): string {
  const clean = sanitizeRichText(value)
  return richTextToPlain(clean).trim() || /<hr>/.test(clean) ? clean : ""
}
