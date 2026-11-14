import type { SupabaseClient } from "@supabase/supabase-js"
import { collectRows } from "@/lib/reports/collect-rows"
import type { ClaimAttachment, ExpenseClaim } from "./constants"

/** Caller RLS is preserved. Counts and unique ordering prevent silent caps;
 * changing counts/duplicate IDs fail visibly. This is not a SQL snapshot. */
export async function readCompleteClaims(client: SupabaseClient): Promise<ExpenseClaim[]> {
  return await collectRows(() => client.from("expense_claims").select("*", { count: "exact" })
    .order("expense_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false }).order("id", { ascending: false })) as unknown as ExpenseClaim[]
}

export async function readCompleteAttachments(client: SupabaseClient, claimIds: string[]): Promise<ClaimAttachment[]> {
  const rows: ClaimAttachment[] = []
  const ids = [...new Set(claimIds)]
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200)
    const data = await collectRows(() => client.from("expense_claim_attachments")
      .select("id,claim_id,original_filename,mime_type,size_bytes,sha256,doc_kind,source,uploaded_at", { count: "exact" })
      .in("claim_id", batch).order("id", { ascending: true }))
    if (data.some(row => !batch.includes(String(row.claim_id)))) throw Error("Receipt evidence scope could not be verified")
    rows.push(...data as unknown as ClaimAttachment[])
  }
  return rows
}

/** Privileged name lookup accepts only IDs derived from caller-visible claims.
 * Email and other personal directory fields are deliberately excluded. */
export async function readClaimDisplayNames(client: SupabaseClient, tenantId: string, actorIds: string[]): Promise<Record<string, string>> {
  const names: Record<string, string> = {}
  const ids = [...new Set(actorIds)]
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200)
    const rows = await collectRows(() => client.from("users")
      .select("id,auth_user_id,full_name_en,full_name_ar,preferred_name", { count: "exact" })
      .eq("tenant_id", tenantId).in("auth_user_id", batch).is("deleted_at", null).order("id", { ascending: true }))
    for (const row of rows) {
      if (typeof row.auth_user_id !== "string" || !batch.includes(row.auth_user_id)) throw Error("Claim display identity could not be verified")
      names[row.auth_user_id] = String(row.preferred_name || row.full_name_en || row.full_name_ar || "—")
    }
  }
  return names
}
