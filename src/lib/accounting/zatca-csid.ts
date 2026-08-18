"use server"

// Financial Phase 18 — ZATCA CSID credential store.
//
// Persists the onboarding outputs (compliance CSID + production CSID) per
// tenant so the transmission transport can authenticate with the documented
// Basic auth (certificate:secret — zatca-transport.ts). The table
// (zatca_csids, migration 055) has NO RLS policies: every read/write here
// flows through the service-role admin client, and the secret is NEVER
// returned to the browser — the UI only sees a masked summary.
//
// Permission: accounting:approve for writes (same as the event dispatcher and
// the adapter), accounting:read for the masked listing.
//
// No ZATCA compliance is claimed (ZATCA-BOUNDARY.md §5).

import { randomUUID } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, requirePermission } from "@/lib/auth/authorization"
import { writeAuditLog } from "@/lib/auth/sessions"
import { generateZatcaKeyPair, buildZatcaCsr, ZATCA_CERT_TEMPLATES, type ZatcaCsrInput } from "./zatca-crypto"
import { requestComplianceCsid, requestProductionCsid } from "./zatca-onboarding"

export type ZatcaCsidEnvironment = "sandbox" | "simulation" | "production"
export type ZatcaCsidKind = "compliance" | "production"

export interface SaveCsidInput {
  environment: ZatcaCsidEnvironment
  kind: ZatcaCsidKind
  /** binarySecurityToken (X.509 certificate, base64) from the onboarding step. */
  csidBase64: string
  /** CSID secret — persisted, never returned to the browser. */
  secret: string
  /** PKCS#8 PEM secp256k1 private key bound to the CSID cert (for payload signing). */
  privateKey?: string | null
  /** Compliance requestID — required for the production step, stored for reference. */
  requestId?: string | null
  issuedAt?: string | null
  expiresAt?: string | null
}

export interface ZatcaCsidSummary {
  id: string
  environment: ZatcaCsidEnvironment
  kind: ZatcaCsidKind
  status: string
  issuedAt: string | null
  expiresAt: string | null
  /** Masked secret for the UI (first 4 chars + ellipsis) — the full secret never leaves the server. */
  secretPreview: string
  updatedAt: string | null
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error"
}

/** Mask a CSID secret for any UI surface: `ab12…` — the real value never leaves the server. */
function maskSecret(secret: string): string {
  return secret.length <= 4 ? "••••" : `${secret.slice(0, 4)}…`
}

/**
 * Upsert a CSID (compliance or production) for the current tenant.
 * accounting:approve. Re-running onboarding for the same (env, kind) refreshes
 * the row — no accumulating secrets.
 */
export async function saveZatcaCsid(input: SaveCsidInput): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermission("accounting", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    if (!input.csidBase64 || !input.secret) {
      return { success: false, error: "CSID certificate and secret are required." }
    }

    const admin = createAdminClient()
    const { error } = await admin.from("zatca_csids").upsert(
      {
        tenant_id: currentUser.tenantId,
        environment: input.environment,
        kind: input.kind,
        csid_base64: input.csidBase64,
        secret: input.secret,
        private_key: input.privateKey ?? null,
        request_id: input.requestId ?? null,
        status: "issued",
        issued_at: input.issuedAt ?? new Date().toISOString(),
        expires_at: input.expiresAt ?? null,
        created_by: currentUser.authUserId,
        updated_by: currentUser.authUserId,
      },
      { onConflict: "tenant_id,environment,kind" }
    )
    if (error) return { success: false, error: error.message }

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "zatca_csid_saved",
      entityType: "zatca_csids",
      newValues: {
        environment: input.environment,
        kind: input.kind,
        secret: maskSecret(input.secret),
        has_request_id: Boolean(input.requestId),
      },
    })

    return { success: true }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * List the current tenant's CSIDs as a MASKED summary (never the secret).
 * accounting:read. Used by the accounting page ZATCA tab.
 */
export async function listZatcaCsids(): Promise<{
  success: boolean
  error?: string
  csids?: ZatcaCsidSummary[]
}> {
  try {
    await requirePermission("accounting", "read")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("zatca_csids")
      .select("id,environment,kind,status,secret,issued_at,expires_at,updated_at")
      .eq("tenant_id", currentUser.tenantId)
      .order("environment", { ascending: true })
      .order("kind", { ascending: true })
    if (error) return { success: false, error: error.message }

    const csids: ZatcaCsidSummary[] = (data ?? []).map((r) => ({
      id: r.id,
      environment: r.environment as ZatcaCsidEnvironment,
      kind: r.kind as ZatcaCsidKind,
      status: r.status,
      issuedAt: r.issued_at,
      expiresAt: r.expires_at,
      secretPreview: maskSecret(r.secret),
      updatedAt: r.updated_at,
    }))

    return { success: true, csids }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Read the full CSID credential (cert + secret + private key) for the
 * transport — SERVER ONLY, never called from the browser. Returns null when
 * the tenant has no matching CSID so the adapter can fall back to env-config
 * / sandbox mode.
 */
export async function getZatcaCsidCredential(
  environment: ZatcaCsidEnvironment,
  kind: ZatcaCsidKind,
  tenantId: string
): Promise<{ csidBase64: string; secret: string; privateKeyPem: string | null } | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("zatca_csids")
    .select("csid_base64,secret,private_key")
    .eq("tenant_id", tenantId)
    .eq("environment", environment)
    .eq("kind", kind)
    .eq("status", "issued")
    .maybeSingle()
  if (!data) return null
  return { csidBase64: data.csid_base64, secret: data.secret, privateKeyPem: data.private_key ?? null }
}

// ── Onboarding orchestrator ────────────────────────────────────────────────

export interface OnboardZatcaInput {
  /** Target environment — selects the CSR certificateTemplate. */
  environment: ZatcaCsidEnvironment
  /**
   * One-time password from the Fatoora portal (compliance step). In the
   * sandbox any value is accepted by the mock (and historically by the
   * sandbox API); simulation/production require the real portal OTP.
   */
  otp: string
  /** Override CSR fields that aren't stored on the tenant (defaults apply). */
  organizationUnit?: string
  commonName?: string
  serialNumber?: string
  title?: string
  businessCategory?: string
}

export interface OnboardZatcaResult {
  success: boolean
  error?: string
  sandbox?: boolean
  complianceSaved?: boolean
  productionSaved?: boolean
}

/**
 * Run the full onboarding flow for the current tenant and persist both CSIDs:
 *
 *   1. Load tenant identity (VAT no., legal name, address) for the CSR.
 *   2. Generate a fresh secp256k1 keypair; build the ZATCA CSR (certificate
 *      template per environment).
 *   3. requestComplianceCsid (OTP header) → save compliance CSID + key.
 *   4. requestProductionCsid (Basic auth from the compliance CSID) → save
 *      production CSID + key.
 *
 * accounting:approve (same as the adapter). The private key is persisted
 * with the CSID so the transport can sign payloads per tenant — it never
 * reaches the browser (same service-role-only model as the cert/secret).
 *
 * In sandbox mode (no ZATCA_API_BASE_URL) the onboarding transport returns a
 * deterministic mock, so this action is exercisable offline end-to-end.
 */
export async function onboardZatcaCsids(input: OnboardZatcaInput): Promise<OnboardZatcaResult> {
  try {
    await requirePermission("accounting", "approve")
    const currentUser = await getCurrentUser()
    if (!currentUser) return { success: false, error: "Not authenticated." }
    if (!input.otp) return { success: false, error: "OTP is required for the compliance step." }

    const admin = createAdminClient()

    // 1. Tenant identity for the CSR.
    const { data: tenant } = await admin
      .from("tenants")
      .select("name_en,legal_name,vat_number,address,city,country")
      .eq("id", currentUser.tenantId)
      .maybeSingle<{
        name_en: string | null
        legal_name: string | null
        vat_number: string | null
        address: string | null
        city: string | null
        country: string | null
      }>()
    if (!tenant) return { success: false, error: "Tenant not found." }

    const orgName = tenant.legal_name || tenant.name_en || ""
    const vatNumber = /^\d{15}$/.test(tenant.vat_number ?? "") ? tenant.vat_number! : "310122993400001"
    const registeredAddress = [tenant.address, tenant.city].filter(Boolean).join(", ") || "Riyadh"

    // 2. Fresh keypair + CSR (template selected by environment).
    const keyPair = generateZatcaKeyPair()
    const csrInput: ZatcaCsrInput = {
      country: tenant.country || "SA",
      organizationUnit: input.organizationUnit || "EGS",
      organization: orgName || "Elite",
      commonName: input.commonName || orgName || "Elite EGS",
      serialNumber: input.serialNumber || `1-TST|2-TST|3-${randomUUID()}`,
      uid: vatNumber,
      title: input.title || "1100",
      registeredAddress,
      businessCategory: input.businessCategory || "Business",
      certificateTemplate: ZATCA_CERT_TEMPLATES[input.environment],
    }
    const csr = buildZatcaCsr(csrInput, keyPair)

    // 3. Compliance CSID → persist.
    const cc = await requestComplianceCsid({ csr, otp: input.otp })
    const complianceSaved = await saveZatcaCsidInternal(admin, currentUser, {
      environment: input.environment,
      kind: "compliance",
      csidBase64: cc.csidBase64,
      secret: cc.secret,
      privateKey: keyPair.privateKeyPem,
      requestId: cc.requestId,
    })
    if (!complianceSaved.success) return complianceSaved

    // 4. Production CSID → persist.
    const pc = await requestProductionCsid({
      complianceRequestId: cc.requestId,
      csidBase64: cc.csidBase64,
      csidSecret: cc.secret,
    })
    const productionSaved = await saveZatcaCsidInternal(admin, currentUser, {
      environment: input.environment,
      kind: "production",
      csidBase64: pc.csidBase64,
      secret: pc.secret,
      privateKey: keyPair.privateKeyPem,
      requestId: cc.requestId,
    })
    if (!productionSaved.success) return productionSaved

    await writeAuditLog({
      tenantId: currentUser.tenantId,
      actorId: currentUser.authUserId,
      module: "accounting",
      action: "zatca_onboarded",
      entityType: "zatca_csids",
      newValues: {
        environment: input.environment,
        sandbox: Boolean(cc.sandbox && pc.sandbox),
        vat: vatNumber,
      },
    })

    return {
      success: true,
      sandbox: Boolean(cc.sandbox && pc.sandbox),
      complianceSaved: true,
      productionSaved: true,
    }
  } catch (e) {
    return { success: false, error: errorMessage(e) }
  }
}

/**
 * Direct upsert used by the orchestrator (skips the permission re-check that
 * the public saveZatcaCsid does — this caller already holds accounting:approve).
 */
async function saveZatcaCsidInternal(
  admin: ReturnType<typeof createAdminClient>,
  currentUser: { tenantId: string; authUserId: string },
  input: SaveCsidInput
): Promise<{ success: boolean; error?: string }> {
  const { error } = await admin.from("zatca_csids").upsert(
    {
      tenant_id: currentUser.tenantId,
      environment: input.environment,
      kind: input.kind,
      csid_base64: input.csidBase64,
      secret: input.secret,
      private_key: input.privateKey ?? null,
      request_id: input.requestId ?? null,
      status: "issued",
      issued_at: input.issuedAt ?? new Date().toISOString(),
      expires_at: input.expiresAt ?? null,
      created_by: currentUser.authUserId,
      updated_by: currentUser.authUserId,
    },
    { onConflict: "tenant_id,environment,kind" }
  )
  if (error) return { success: false, error: error.message }
  return { success: true }
}
