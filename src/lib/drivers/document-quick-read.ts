import type { SupabaseClient } from "@supabase/supabase-js"
export type DocumentDriverRow = { id: string; driver_code: string | null; full_name_en: string | null; full_name_ar: string | null; primary_mobile: string | null; profile_version: number | null }
export type DocumentDriverTarget = { driverId: string; version: number; name: string }
export const documentDriverNeedle = (query: string) => query.slice(0, 200).trim().replace(/[%,()*\\"]/g, " ").trim()

export async function readDocumentDriver(client: SupabaseClient, id: string, signal: AbortSignal): Promise<DocumentDriverTarget> {
  const { data, error } = await client.from("drivers").select("id,full_name_en,full_name_ar,profile_version")
    .eq("id", id).is("deleted_at", null).abortSignal(signal).maybeSingle()
  if (error || !data || data.id !== id || !Number.isSafeInteger(data.profile_version) || data.profile_version < 1) throw Error("Driver is unavailable")
  return { driverId: data.id, version: data.profile_version, name: data.full_name_en || data.full_name_ar || "" }
}
export async function searchDocumentDrivers(client: SupabaseClient, query: string, signal: AbortSignal): Promise<DocumentDriverRow[]> {
  const needle = documentDriverNeedle(query)
  if (needle.length < 2) return []
  const like = `"%${needle}%"`
  const { data, error } = await client.from("drivers").select("id,driver_code,full_name_en,full_name_ar,primary_mobile,profile_version")
    .or(`full_name_en.ilike.${like},full_name_ar.ilike.${like},driver_code.ilike.${like},primary_mobile.ilike.${like},iqama_number.ilike.${like}`)
    .is("deleted_at", null).order("full_name_en").order("id").limit(10).abortSignal(signal)
  if (error || !Array.isArray(data)) throw Error("Driver search is unavailable")
  return data as DocumentDriverRow[]
}
