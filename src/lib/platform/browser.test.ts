import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules() })

it('continues the dashboard cookie session in platform admin and shares local sign-out', async () => {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://session-fixture.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-public-key')
  const session = { access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: 'bearer', user: { id: '10000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated' } }
  const cookies = new Map([['sb-session-fixture-auth-token', 'base64-'+Buffer.from(JSON.stringify(session)).toString('base64url')]])
  const doc = { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} }
  Object.defineProperty(doc, 'cookie', { get: () => [...cookies].map(([name,value]) => name+'='+value).join('; '), set: (value: string) => { const [pair,...attributes]=value.split(';');const split=pair.indexOf('=');const name=pair.slice(0,split),data=pair.slice(split+1);if(attributes.some(part=>/^\s*max-age=0$/i.test(part))||!data)cookies.delete(name);else cookies.set(name,data) } })
  const localRead=vi.fn(() => null)
  vi.stubGlobal('document', doc)
  vi.stubGlobal('BroadcastChannel', undefined)
  vi.stubGlobal('window', { document: doc, location: { href: 'http://localhost/platform/admin', hash: '', search: '' }, addEventListener() {}, removeEventListener() {}, localStorage: { getItem: localRead, setItem() {}, removeItem() {} } })
  const request=vi.fn(async (input: RequestInfo | URL) => {
    expect(String(input)).toMatch(/^https:\/\/session-fixture\.supabase\.co\/auth\/v1\/logout\?scope=local$/)
    return new Response('{}',{status:200,headers:{'content-type':'application/json'}})
  })
  vi.stubGlobal('fetch', request)
  const { createClient }=await import('../supabase/client')
  const { getBrowserSupabase }=await import('./browser')
  const dashboard=createClient(), platform=getBrowserSupabase()
  try {
    expect(platform).toBe(dashboard)
    expect((await platform.auth.getSession()).data.session?.access_token).toBe(session.access_token)
    expect(request).not.toHaveBeenCalled()
    expect(localRead).not.toHaveBeenCalled()
    expect((await platform.auth.signOut({scope:'local'})).error).toBeNull()
    expect(request).toHaveBeenCalledTimes(1)
    expect((await dashboard.auth.getSession()).data.session).toBeNull()
    expect([...cookies.keys()].some(name=>name.startsWith('sb-session-fixture-auth-token'))).toBe(false)
  } finally { await dashboard.auth.stopAutoRefresh() }
})
