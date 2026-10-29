export type PlatformUserCompany = { id: string; name_en: string; name_ar: string | null; status: 'active' | 'suspended' | 'terminated' }
export type PlatformUserRole = { tenant_id: string; name: string }
export type PlatformUserChoices = { companies: PlatformUserCompany[]; roles: PlatformUserRole[] }
type Endpoint = 'companies' | 'roles'
export class PlatformUserChoicesError extends Error {
  constructor(public endpoint: Endpoint, public status?: number) { super('Company and role choices could not be verified. Retry.') }
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export async function loadPlatformUserChoices(request: (path: string) => Promise<unknown>): Promise<PlatformUserChoices> {
  // Creation depends on these two verified sources, independently of overview/billing.
  const results = await Promise.allSettled([request('/api/platform/admin/companies'), request('/api/platform/admin/users')])
  for (const [index, result] of results.entries()) if (result.status === 'rejected') {
    const value = result.reason as unknown
    const status = record(value) && typeof value.status === 'number' && value.status >= 400 && value.status <= 599 ? value.status : undefined
    throw new PlatformUserChoicesError(index === 0 ? 'companies' : 'roles', status)
  }
  const companyBody = results[0].status === 'fulfilled' ? results[0].value : undefined
  const roleBody = results[1].status === 'fulfilled' ? results[1].value : undefined
  if (!record(companyBody) || !Array.isArray(companyBody.companies)) throw new PlatformUserChoicesError('companies')
  const companies: PlatformUserCompany[] = [], ids = new Set<string>()
  for (const row of companyBody.companies) {
    if (!record(row) || !uuid(row.id) || typeof row.name_en !== 'string' || !(row.name_ar === null || row.name_ar === undefined || typeof row.name_ar === 'string') || !['active','suspended','terminated'].includes(String(row.status)) || ids.has(row.id)) throw new PlatformUserChoicesError('companies')
    ids.add(row.id)
    companies.push({ id: row.id, name_en: row.name_en, name_ar: typeof row.name_ar === 'string' ? row.name_ar : null, status: row.status as PlatformUserCompany['status'] })
  }
  if (!record(roleBody) || !Array.isArray(roleBody.active_roles)) throw new PlatformUserChoicesError('roles')
  const roles: PlatformUserRole[] = [], keys = new Set<string>()
  for (const row of roleBody.active_roles) {
    if (!record(row) || !uuid(row.tenant_id) || typeof row.name !== 'string' || !row.name || keys.has(row.tenant_id + ':' + row.name)) throw new PlatformUserChoicesError('roles')
    keys.add(row.tenant_id + ':' + row.name); roles.push({ tenant_id: row.tenant_id, name: row.name })
  }
  return { companies, roles }
}
export function canCreatePlatformUser(choices: PlatformUserChoices | null, selection: { tenant_id: string; role: string }, allowedRoles: readonly string[]): boolean {
  return !!choices && selection.role !== 'general_manager' && allowedRoles.includes(selection.role) && choices.companies.some(c => c.id === selection.tenant_id && c.status === 'active') && choices.roles.some(r => r.tenant_id === selection.tenant_id && r.name === selection.role)
}
