import { notFound } from "next/navigation"
import { RegistrationApp } from "@/app/driver-registration/registration-app"
import { createAdminClient } from "@/lib/supabase/admin"

const TENANT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export default async function TenantDriverApplicationPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  if (!TENANT_SLUG.test(tenantSlug)) notFound()

  const admin = createAdminClient()
  const { data: tenant, error } = await admin
    .from("tenants")
    .select("slug")
    .eq("slug", tenantSlug)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle()

  if (error || !tenant) notFound()

  return <RegistrationApp tenantSlug={tenant.slug} />
}
