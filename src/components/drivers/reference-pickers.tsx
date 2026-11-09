"use client"

import { useMemo } from "react"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { COMMON_NATIONALITY_CODES, findNationality, nationalityByCode, nationalityOptions } from "@/lib/reference/nationalities"
import { SAUDI_CITIES, SAUDI_REGIONS, findSaudiCity, regionByCode } from "@/lib/reference/saudi-cities"

type A11y = { id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string; disabled?: boolean }

/**
 * Nationality combobox over all UN member states. Emits the localized name
 * (stored in drivers.nationality) and the ISO code (drivers.nationality_code).
 */
export function NationalityPicker({
  value,
  code,
  isAr,
  onChange,
  ...a11y
}: A11y & { value: string | null | undefined; code?: string | null; isAr: boolean; onChange: (name: string, code: string) => void }) {
  const options = useMemo(() => {
    const common = new Set<string>(COMMON_NATIONALITY_CODES)
    return nationalityOptions(isAr).map((n) => ({
      value: n.code,
      label: isAr ? n.ar : n.en,
      keywords: [n.en, n.ar, n.code],
      hint: n.code,
      group: common.has(n.code) ? (isAr ? "الأكثر شيوعاً" : "Most common") : (isAr ? "كل الجنسيات" : "All nationalities"),
    }))
  }, [isAr])
  const current = nationalityByCode(code) ?? findNationality(value)
  return (
    <SearchableSelect
      {...a11y}
      value={current?.code ?? (value || "")}
      options={options}
      placeholder={isAr ? "اختر الجنسية" : "Select nationality"}
      searchPlaceholder={isAr ? "ابحث بالعربية أو الإنجليزية…" : "Search in English or Arabic…"}
      emptyText={isAr ? "لا توجد نتائج" : "No results"}
      clearLabel={isAr ? "بدون" : "None"}
      onChange={(c) => {
        const n = nationalityByCode(c)
        onChange(n ? (isAr ? n.ar : n.en) : "", n?.code ?? "")
      }}
    />
  )
}

/** Saudi city combobox grouped by region. Emits city + region (localized). */
export function SaudiCityPicker({
  value,
  isAr,
  onChange,
  ...a11y
}: A11y & { value: string | null | undefined; isAr: boolean; onChange: (city: string, region: string) => void }) {
  const options = useMemo(
    () =>
      SAUDI_REGIONS.flatMap((r) =>
        SAUDI_CITIES.filter((c) => c.region === r.code).map((c) => ({
          value: `${r.code}:${c.en}`,
          label: isAr ? c.ar : c.en,
          keywords: [c.en, c.ar, r.en, r.ar],
          group: isAr ? r.ar : r.en,
        })),
      ),
    [isAr],
  )
  const current = findSaudiCity(value)
  return (
    <SearchableSelect
      {...a11y}
      value={current ? `${current.region}:${current.en}` : (value || "")}
      options={options}
      placeholder={isAr ? "اختر المدينة" : "Select city"}
      searchPlaceholder={isAr ? "ابحث عن مدينة أو منطقة…" : "Search city or region…"}
      emptyText={isAr ? "لا توجد نتائج" : "No results"}
      clearLabel={isAr ? "بدون" : "None"}
      onChange={(v) => {
        if (!v) return onChange("", "")
        const [regionCode, en] = v.split(":")
        const city = SAUDI_CITIES.find((c) => c.region === regionCode && c.en === en)
        const region = regionByCode(regionCode)
        onChange(city ? (isAr ? city.ar : city.en) : "", region ? (isAr ? region.ar : region.en) : "")
      }}
    />
  )
}

/** Region select for the 13 administrative regions. */
export function SaudiRegionPicker({
  value,
  isAr,
  onChange,
  ...a11y
}: A11y & { value: string | null | undefined; isAr: boolean; onChange: (region: string) => void }) {
  const v = value?.trim()
  const current = SAUDI_REGIONS.find((r) => r.ar === v || r.en.toLowerCase() === v?.toLowerCase())
  return (
    <SearchableSelect
      {...a11y}
      value={current?.code ?? (v || "")}
      options={SAUDI_REGIONS.map((r) => ({ value: r.code, label: isAr ? r.ar : r.en, keywords: [r.en, r.ar] }))}
      placeholder={isAr ? "اختر المنطقة" : "Select region"}
      searchPlaceholder={isAr ? "ابحث…" : "Search…"}
      emptyText={isAr ? "لا توجد نتائج" : "No results"}
      clearLabel={isAr ? "بدون" : "None"}
      onChange={(c) => {
        const r = regionByCode(c)
        onChange(r ? (isAr ? r.ar : r.en) : "")
      }}
    />
  )
}
