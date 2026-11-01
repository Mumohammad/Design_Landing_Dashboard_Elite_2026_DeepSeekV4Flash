"use client"

// Lightweight WYSIWYG editor for invoice notes/terms (Daftra-style toolbar):
// bold, italic, underline, clear formatting, strikethrough, font size, text &
// highlight colour, bullet/numbered lists, alignment, link/unlink, rule.
// Output is always passed through the allowlist sanitizer before it leaves
// the component, and the same sanitizer runs again when the invoice prints.

import * as React from "react"
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, Eraser, Italic, Link2, List, ListOrdered,
  Minus, Strikethrough, Underline, Unlink,
} from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { RICH_TEXT_MAX_TEXT, normalizeRichText, richTextToPlain, richTextToSafeHtml } from "@/lib/rich-text/sanitize"

const FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32]
const TEXT_COLORS = ["#000000", "#374151", "#6b7280", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#1e5a99", "#7c3aed", "#db2777", "#ffffff"]
const HIGHLIGHTS = ["transparent", "#fef08a", "#fde68a", "#bbf7d0", "#bae6fd", "#ddd6fe", "#fbcfe8", "#fecaca", "#e5e7eb"]

type Cmd = "bold" | "italic" | "underline" | "strikeThrough" | "insertUnorderedList" | "insertOrderedList" | "justifyLeft" | "justifyCenter" | "justifyRight" | "justifyFull"
const STATE_CMDS: Cmd[] = ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList", "justifyLeft", "justifyCenter", "justifyRight", "justifyFull"]

export interface RichTextEditorProps {
  id?: string
  value: string
  onChange: (html: string) => void
  ar?: boolean
  placeholder?: string
  disabled?: boolean
  maxLength?: number
  className?: string
  "aria-label"?: string
  "data-testid"?: string
}

function ToolButton({ label, active, onClick, children, disabled }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep the editor selection
      onClick={onClick}
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center px-1.5 text-foreground/80 transition-colors hover:bg-muted disabled:opacity-40",
        active && "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
      )}
    >
      {children}
    </button>
  )
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center divide-x divide-border/70 overflow-hidden rounded-md border border-border/80 bg-background rtl:divide-x-reverse">{children}</div>
}

export function RichTextEditor({
  id, value, onChange, ar = false, placeholder, disabled, maxLength = RICH_TEXT_MAX_TEXT, className, "aria-label": ariaLabel, "data-testid": testId,
}: RichTextEditorProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  const lastEmitted = React.useRef<string | null>(null)
  const savedRange = React.useRef<Range | null>(null)
  const [active, setActive] = React.useState<Record<string, boolean>>({})
  const [fontSize, setFontSize] = React.useState<number | null>(null)
  const [length, setLength] = React.useState(() => richTextToPlain(value).length)
  const [linkOpen, setLinkOpen] = React.useState(false)
  const [linkUrl, setLinkUrl] = React.useState("https://")
  const [linkError, setLinkError] = React.useState(false)
  const t = (a: string, e: string) => (ar ? a : e)

  // Sync external value (load/edit another invoice, reset) without clobbering typing.
  React.useEffect(() => {
    const el = ref.current
    if (!el || value === lastEmitted.current) return
    el.innerHTML = richTextToSafeHtml(value)
    lastEmitted.current = value
    setLength(richTextToPlain(value).length)
  }, [value])

  const emit = React.useCallback(() => {
    const el = ref.current
    if (!el) return
    const html = normalizeRichText(el.innerHTML)
    setLength(richTextToPlain(html).length)
    lastEmitted.current = html
    onChange(html)
  }, [onChange])

  const refreshState = React.useCallback(() => {
    const el = ref.current
    const sel = typeof document !== "undefined" ? document.getSelection() : null
    if (!el || !sel || !sel.anchorNode || !el.contains(sel.anchorNode)) return
    savedRange.current = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null
    const next: Record<string, boolean> = {}
    for (const c of STATE_CMDS) { try { next[c] = document.queryCommandState(c) } catch { next[c] = false } }
    setActive(next)
    const node = sel.anchorNode.nodeType === 1 ? (sel.anchorNode as Element) : sel.anchorNode.parentElement
    const px = node ? Math.round(parseFloat(getComputedStyle(node).fontSize)) : NaN
    setFontSize(Number.isFinite(px) ? px : null)
  }, [])

  React.useEffect(() => {
    document.addEventListener("selectionchange", refreshState)
    return () => document.removeEventListener("selectionchange", refreshState)
  }, [refreshState])

  const restore = () => {
    const el = ref.current
    if (!el) return
    el.focus()
    const range = savedRange.current
    if (range && el.contains(range.commonAncestorContainer)) {
      const sel = document.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }

  const exec = (command: string, arg?: string) => {
    if (disabled) return
    restore()
    document.execCommand("styleWithCSS", false, command === "hiliteColor" || command === "foreColor" || command.startsWith("justify") ? "true" : "false")
    document.execCommand(command, false, arg)
    emit()
    refreshState()
  }

  const applyFontSize = (px: number) => {
    if (disabled) return
    restore()
    const el = ref.current
    if (!el) return
    document.execCommand("styleWithCSS", false, "false")
    document.execCommand("fontSize", false, "7")
    const spans: HTMLSpanElement[] = []
    el.querySelectorAll('font[size="7"]').forEach((font) => {
      const span = document.createElement("span")
      span.style.fontSize = `${px}px`
      while (font.firstChild) span.appendChild(font.firstChild)
      font.replaceWith(span)
      spans.push(span)
    })
    // Keep the resized text selected so the next action (colour, bold…) applies to it.
    if (spans.length) {
      const range = document.createRange()
      range.setStartBefore(spans[0].firstChild ?? spans[0])
      range.setEndAfter(spans[spans.length - 1].lastChild ?? spans[spans.length - 1])
      const sel = document.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      savedRange.current = range.cloneRange()
    }
    emit()
    setFontSize(px)
  }

  const clearFormatting = () => {
    exec("removeFormat")
    exec("unlink")
  }

  const insertLink = () => {
    const url = linkUrl.trim()
    if (!/^(https?:\/\/[^\s.]+\.[^\s]+|mailto:[^\s@]+@[^\s]+)$/i.test(url)) { setLinkError(true); return }
    setLinkOpen(false)
    setLinkError(false)
    const sel = savedRange.current
    if (sel && sel.collapsed) {
      restore()
      document.execCommand("insertText", false, url)
      const s = document.getSelection()
      if (s && s.rangeCount) {
        const r = s.getRangeAt(0)
        r.setStart(r.endContainer, Math.max(0, r.endOffset - url.length))
        s.removeAllRanges(); s.addRange(r)
        savedRange.current = r.cloneRange()
      }
    }
    exec("createLink", url)
  }

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const html = e.clipboardData.getData("text/html")
    const text = e.clipboardData.getData("text/plain")
    if (html) document.execCommand("insertHTML", false, normalizeRichText(html) || richTextToSafeHtml(text))
    else document.execCommand("insertText", false, text)
    emit()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const sel = document.getSelection()
    const replacing = sel && !sel.isCollapsed
    if (length >= maxLength && !replacing && (e.key.length === 1 || e.key === "Enter") && !e.ctrlKey && !e.metaKey) e.preventDefault()
  }

  const alignIcon = active.justifyCenter ? AlignCenter : active.justifyFull ? AlignJustify : active.justifyLeft ? AlignLeft : active.justifyRight ? AlignRight : ar ? AlignRight : AlignLeft
  const AlignIcon = alignIcon
  const over = length > maxLength

  return (
    <div className={cn("overflow-hidden rounded-xl border border-border/70 bg-background focus-within:border-sky-400 focus-within:ring-1 focus-within:ring-sky-300/50", disabled && "opacity-60", className)} dir={ar ? "rtl" : "ltr"}>
      <div role="toolbar" aria-label={t("أدوات التنسيق", "Formatting")} className="flex flex-wrap items-center gap-1.5 border-b border-border/60 bg-muted/40 px-2 py-1.5">
        <Group>
          <ToolButton label={t("عريض", "Bold")} active={active.bold} onClick={() => exec("bold")} disabled={disabled}><Bold className="h-3.5 w-3.5" /></ToolButton>
          <ToolButton label={t("مائل", "Italic")} active={active.italic} onClick={() => exec("italic")} disabled={disabled}><Italic className="h-3.5 w-3.5" /></ToolButton>
          <ToolButton label={t("تسطير", "Underline")} active={active.underline} onClick={() => exec("underline")} disabled={disabled}><Underline className="h-3.5 w-3.5" /></ToolButton>
          <ToolButton label={t("مسح التنسيق", "Clear formatting")} onClick={clearFormatting} disabled={disabled}><Eraser className="h-3.5 w-3.5" /></ToolButton>
        </Group>
        <Group>
          <ToolButton label={t("يتوسطه خط", "Strikethrough")} active={active.strikeThrough} onClick={() => exec("strikeThrough")} disabled={disabled}><Strikethrough className="h-3.5 w-3.5" /></ToolButton>
        </Group>
        <Group>
          <label className="sr-only" htmlFor={id ? `${id}-size` : undefined}>{t("حجم الخط", "Font size")}</label>
          <select
            id={id ? `${id}-size` : undefined}
            title={t("حجم الخط", "Font size")}
            aria-label={t("حجم الخط", "Font size")}
            disabled={disabled}
            value={fontSize && FONT_SIZES.includes(fontSize) ? String(fontSize) : ""}
            onMouseDown={() => { const s = document.getSelection(); if (s?.rangeCount && ref.current?.contains(s.anchorNode)) savedRange.current = s.getRangeAt(0).cloneRange() }}
            onChange={(e) => e.target.value && applyFontSize(Number(e.target.value))}
            className="h-7 cursor-pointer bg-transparent px-1.5 text-xs tabular-nums outline-none"
            dir="ltr"
          >
            <option value="">{fontSize ?? 13}</option>
            {FONT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Group>
        <Group>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" disabled={disabled} onMouseDown={(e) => e.preventDefault()} title={t("لون النص والتمييز", "Text & highlight colour")} aria-label={t("لون النص والتمييز", "Text & highlight colour")} className="inline-flex h-7 items-center gap-0.5 px-1.5 hover:bg-muted disabled:opacity-40">
                <span className="rounded-sm bg-yellow-300 px-1 text-xs font-bold leading-5 text-black">A</span>
                <ChevronDown className="h-3 w-3 opacity-70" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 space-y-3 p-3" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("لون النص", "Text colour")}</p>
                <div className="grid grid-cols-6 gap-1.5">
                  {TEXT_COLORS.map((c) => (
                    <button key={c} type="button" aria-label={c} title={c} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("foreColor", c)} className="h-6 w-6 rounded border border-border shadow-sm" style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("لون التمييز", "Highlight")}</p>
                <div className="grid grid-cols-6 gap-1.5">
                  {HIGHLIGHTS.map((c) => (
                    <button key={c} type="button" aria-label={c === "transparent" ? t("بدون", "None") : c} title={c === "transparent" ? t("بدون", "None") : c} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("hiliteColor", c)} className={cn("h-6 w-6 rounded border border-border shadow-sm", c === "transparent" && "bg-[linear-gradient(45deg,transparent_45%,#ef4444_45%,#ef4444_55%,transparent_55%)]")} style={c === "transparent" ? undefined : { backgroundColor: c }} />
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </Group>
        <Group>
          <ToolButton label={t("قائمة نقطية", "Bulleted list")} active={active.insertUnorderedList} onClick={() => exec("insertUnorderedList")} disabled={disabled}><List className="h-3.5 w-3.5" /></ToolButton>
          <ToolButton label={t("قائمة مرقمة", "Numbered list")} active={active.insertOrderedList} onClick={() => exec("insertOrderedList")} disabled={disabled}><ListOrdered className="h-3.5 w-3.5" /></ToolButton>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" disabled={disabled} onMouseDown={(e) => e.preventDefault()} title={t("محاذاة", "Alignment")} aria-label={t("محاذاة", "Alignment")} className="inline-flex h-7 items-center gap-0.5 px-1.5 hover:bg-muted disabled:opacity-40">
                <AlignIcon className="h-3.5 w-3.5" />
                <ChevronDown className="h-3 w-3 opacity-70" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="flex w-auto gap-1 p-1.5" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
              <ToolButton label={t("محاذاة لليمين", "Align right")} active={active.justifyRight} onClick={() => exec("justifyRight")}><AlignRight className="h-4 w-4" /></ToolButton>
              <ToolButton label={t("توسيط", "Center")} active={active.justifyCenter} onClick={() => exec("justifyCenter")}><AlignCenter className="h-4 w-4" /></ToolButton>
              <ToolButton label={t("محاذاة لليسار", "Align left")} active={active.justifyLeft} onClick={() => exec("justifyLeft")}><AlignLeft className="h-4 w-4" /></ToolButton>
              <ToolButton label={t("ضبط", "Justify")} active={active.justifyFull} onClick={() => exec("justifyFull")}><AlignJustify className="h-4 w-4" /></ToolButton>
            </PopoverContent>
          </Popover>
        </Group>
        <Group>
          <Popover open={linkOpen} onOpenChange={(o) => { setLinkOpen(o); setLinkError(false); if (o) setLinkUrl("https://") }}>
            <PopoverTrigger asChild>
              <button type="button" disabled={disabled} onMouseDown={(e) => e.preventDefault()} title={t("إدراج رابط", "Insert link")} aria-label={t("إدراج رابط", "Insert link")} className="inline-flex h-7 min-w-7 items-center justify-center px-1.5 hover:bg-muted disabled:opacity-40">
                <Link2 className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-2 p-3" align="start">
              <label className="text-xs font-medium" htmlFor={id ? `${id}-link` : undefined}>{t("عنوان الرابط", "Link URL")}</label>
              <input
                id={id ? `${id}-link` : undefined}
                dir="ltr"
                value={linkUrl}
                onChange={(e) => { setLinkUrl(e.target.value); setLinkError(false) }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); insertLink() } }}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-sky-400"
                aria-invalid={linkError}
              />
              {linkError && <p className="text-xs text-red-600">{t("أدخل رابطاً يبدأ بـ https:// أو mailto:", "Enter a link starting with https:// or mailto:")}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" className="rounded-md px-3 py-1.5 text-xs hover:bg-muted" onClick={() => setLinkOpen(false)}>{t("إلغاء", "Cancel")}</button>
                <button type="button" className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700" onClick={insertLink}>{t("إدراج", "Insert")}</button>
              </div>
            </PopoverContent>
          </Popover>
          <ToolButton label={t("إزالة الرابط", "Remove link")} onClick={() => exec("unlink")} disabled={disabled}><Unlink className="h-3.5 w-3.5" /></ToolButton>
        </Group>
        <Group>
          <ToolButton label={t("خط فاصل", "Horizontal line")} onClick={() => exec("insertHorizontalRule")} disabled={disabled}><Minus className="h-3.5 w-3.5" /></ToolButton>
        </Group>
      </div>
      <div
        id={id}
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        aria-invalid={over}
        data-testid={testId}
        data-placeholder={placeholder}
        contentEditable={!disabled}
        suppressContentEditableWarning
        dir="auto"
        onInput={emit}
        onBlur={emit}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        onKeyUp={refreshState}
        onMouseUp={refreshState}
        className={cn(
          "rich-text-content min-h-28 max-h-[60vh] resize-y overflow-auto px-3 py-2.5 text-[13px] leading-relaxed outline-none",
          "empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]",
        )}
      />
      <div className={cn("flex justify-end border-t border-border/50 px-3 py-1 text-[11px] tabular-nums text-muted-foreground", over && "text-red-600")} dir="ltr">
        {length} / {maxLength}
      </div>
    </div>
  )
}
