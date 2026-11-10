import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import type { ZatcaCsidEnvironment, ZatcaCsidKind } from "./zatca-csid"

// Not a Server Action: full credentials must never be serializable through
// Next's action endpoint. Authorization also protects future server callers.
export async function getZatcaCsidCredential(
  environment: ZatcaCsidEnvironment,
  kind: ZatcaCsidKind,
  tenantId: string
): Promise<{ csidBase64: string; secret: string; privateKeyPem: string | null } | null> {
  await requirePermission("accounting", "approve")
  const user = await getCurrentUser()
  if (!user || user.tenantId !== tenantId) throw new Error("Forbidden ZATCA credential access.")
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("zatca_csids")
    .select("csid_base64,secret,private_key")
    .eq("tenant_id", user.tenantId)
    .eq("environment", environment)
    .eq("kind", kind)
    .eq("status", "issued")
    .maybeSingle()
  if (error) throw new Error("Unable to load ZATCA credentials.")
  if (!data) return null
  return { csidBase64: data.csid_base64, secret: data.secret, privateKeyPem: data.private_key ?? null }
}
