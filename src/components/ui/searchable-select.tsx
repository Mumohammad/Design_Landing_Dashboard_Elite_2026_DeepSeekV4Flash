"use client"

import { useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"

export interface SearchableOption {
  value: string
  label: string
  /** Extra text matched by search (e.g. the other language, ISO code). */
  keywords?: string[]
  hint?: string
  group?: string
}

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u064B-\u065F\u0300-\u036f]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")

/** Substring match (prefix ranked first) — predictable for names in Arabic and English. */
function substringFilter(value: string, search: string, keywords?: string[]): number {
  const q = fold(search.trim())
  if (!q) return 1
  const words = [value, ...(keywords ?? [])].map(fold)
  if (words.some((w) => w.split(/[\s:]+/).some((part) => part.startsWith(q)))) return 1
  return words.some((w) => w.includes(q)) ? 0.5 : 0
}

/** Accessible combobox: a button trigger with a filterable option list. */
export function SearchableSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  className,
  disabled,
  allowClear = true,
  clearLabel = "—",
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  id?: string
  value: string | null | undefined
  onChange: (value: string) => void
  options: SearchableOption[]
  placeholder: string
  searchPlaceholder: string
  emptyText: string
  className?: string
  disabled?: boolean
  allowClear?: boolean
  clearLabel?: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)
  const groups = Array.from(new Set(options.map((o) => o.group ?? "")))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          disabled={disabled}
          className={cn("h-10 w-full justify-between px-3 font-normal", !selected && !value && "text-muted-foreground", className)}
        >
          <span className="truncate">{selected?.label ?? (value || placeholder)}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command filter={substringFilter}>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>{emptyText}</CommandEmpty>
            {allowClear && value ? (
              <CommandGroup>
                <CommandItem value="__clear__" onSelect={() => { onChange(""); setOpen(false) }} className="text-muted-foreground">
                  {clearLabel}
                </CommandItem>
              </CommandGroup>
            ) : null}
            {groups.map((g) => (
              <CommandGroup key={g || "_"} heading={g || undefined}>
                {options.filter((o) => (o.group ?? "") === g).map((o) => (
                  <CommandItem
                    key={o.value}
                    value={`${o.value} ${o.label}`}
                    keywords={o.keywords}
                    onSelect={() => { onChange(o.value); setOpen(false) }}
                  >
                    <Check className={cn("size-4", o.value === value ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{o.label}</span>
                    {o.hint ? <span className="ms-auto text-xs text-muted-foreground" dir="ltr">{o.hint}</span> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
