-- 1) White-label columns on tenants
alter table public.tenants add column if not exists slug text;
alter table public.tenants add column if not exists brand_colors jsonb not null default '{"primary": "#3b82f6", "secondary": "#8b5cf6"}'::jsonb;

-- Generate slug for existing rows
update public.tenants
set slug = lower(regexp_replace(coalesce(nullif(name_en, ''), nullif(name_ar, ''), id::text), '[^a-zA-Z0-9]+', '-', 'g'))
where slug is null;

create unique index if not exists tenants_slug_uidx on public.tenants (slug);

-- 2) Missing RLS policies
-- zatca_csids: tenant isolation (table has tenant_id)
create policy "zatca_csids_tenant_isolation"
  on public.zatca_csids
  for all
  to authenticated
  using (tenant_id = public.get_my_tenant_id())
  with check (tenant_id = public.get_my_tenant_id());

-- public_lookup_rate_limits: internal system table, service role only
create policy "rate_limits_service_role_only"
  on public.public_lookup_rate_limits
  for all
  to service_role
  using (true)
  with check (true);

-- 3) Fix SECURITY DEFINER view -> SECURITY INVOKER
alter view public.vehicle_active_documents set (security_invoker = true);
