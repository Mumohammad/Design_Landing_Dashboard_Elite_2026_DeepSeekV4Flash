const HEADER = 'x-vercel-trusted-oidc-idp-token'
export const GITHUB_OIDC_AUDIENCE = 'https://github.com/Mumohammad'
const accesses = new Map()
const contexts = new WeakMap()
const issuedTokens = new Set()

export class VerificationAccessError extends Error {
  constructor(message) { super(message); this.name = 'VerificationAccessError' }
}
const fail = message => { throw new VerificationAccessError(message) }
const loopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host)

/** Credential-free, immutable preview origin; existing staging/CSP/commit guards still apply. */
export function verificationOrigin(value) {
  let url
  try { url = new URL(value) } catch { fail('A valid verification application origin is required') }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') fail('A canonical verification application origin is required')
  if (loopback(url.hostname) && ['http:', 'https:'].includes(url.protocol)) return url.origin
  if (url.protocol !== 'https:' || url.port || !/^elite-dashboard-[a-z0-9]+-elitesaasc-5643\.vercel\.app$/.test(url.hostname)) fail('An exact approved Preview origin is required')
  return url.origin
}

function claims(token, now) {
  try {
    if (typeof token !== 'string' || token.length > 32768 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw Error()
    const value = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    if (!Number.isFinite(value.exp) || value.exp * 1000 <= now + 30000 || (value.nbf !== undefined && (!Number.isFinite(value.nbf) || value.nbf * 1000 > now + 30000))) throw Error()
    return value
  } catch { fail('The short-lived Preview identity is missing, malformed or expired') }
}

function githubMask(token) {
  process.stdout.write('::add-mask::' + token.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A') + '\n')
}

export function redactVerificationText(value, secrets = []) {
  let text = String(value)
  for (const token of [...issuedTokens, ...secrets, process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN].filter(token => typeof token === 'string' && token.length >= 8)) text = text.replaceAll(token, '[REDACTED]')
  return text.replace(/(x-vercel-trusted-oidc-idp-token["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
}

/** Tokens live only in this closure and GitHub's masking channel, never files or step outputs. */
export function createVerificationAccess(appUrl, { env = process.env, fetchImpl = fetch, now = Date.now, mask = githubMask } = {}) {
  const origin = verificationOrigin(appUrl)
  const local = loopback(new URL(origin).hostname)
  let cached, pending
  const documentRedirectHops = new WeakMap()

  async function githubToken() {
    if (cached && cached.expires > now() + 60000) return cached.token
    if (pending) return pending
    pending = (async () => {
      try {
        const endpoint = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL)
        if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash || endpoint.port || !/^(?:[a-z0-9-]+\.)?actions\.githubusercontent\.com$/.test(endpoint.hostname) || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN || /[\r\n]/.test(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)) throw Error()
        endpoint.searchParams.set('audience', GITHUB_OIDC_AUDIENCE)
        const response = await fetchImpl(endpoint.href, { headers: { Authorization: 'Bearer ' + env.ACTIONS_ID_TOKEN_REQUEST_TOKEN }, redirect: 'manual', signal: AbortSignal.timeout(15000) })
        if (response.status !== 200) throw Error()
        const body = await response.json()
        const token = body?.value
        const identity = claims(token, now())
        if (identity.iss !== 'https://token.actions.githubusercontent.com' || !(Array.isArray(identity.aud) ? identity.aud : [identity.aud]).includes(GITHUB_OIDC_AUDIENCE)) throw Error()
        issuedTokens.add(token)
        mask(token)
        cached = { token, expires: identity.exp * 1000 }
        return token
      } catch {
        cached = undefined
        fail('GitHub short-lived Preview identity could not be obtained or validated')
      }
    })()
    try { return await pending } finally { pending = undefined }
  }

  async function token() {
    if (env.GITHUB_ACTIONS === 'true') return githubToken()
    const value = env.VERCEL_OIDC_TOKEN
    const identity = claims(value, now())
    if (!/^https:\/\/oidc\.vercel\.com(?:\/[^/?#]+)?$/.test(identity.iss ?? '')) fail('Use a short-lived local Vercel identity from vc env run')
    issuedTokens.add(value)
    return value
  }

  async function headersFor(url, initial) {
    const headers = new Headers(initial)
    headers.delete(HEADER)
    if (!local && new URL(url, origin).origin === origin) headers.set(HEADER, await token())
    return Object.fromEntries(headers)
  }

  async function fetchRequest(input, options = {}) {
    const url = new URL(input instanceof Request ? input.url : input, origin).href
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(options.headers).forEach((value, name) => headers.set(name, value))
    try { return await fetchImpl(input instanceof Request ? input : url, { ...options, headers: await headersFor(url, headers), redirect: 'manual' }) }
    catch (error) { if (error instanceof VerificationAccessError) throw error; fail('Verification HTTP request failed; response not confirmed') }
  }

  async function request(context, url, options = {}) {
    const target = new URL(url, origin).href
    try { return await context.fetch(target, { ...options, headers: await headersFor(target, options.headers), maxRedirects: 0 }) }
    catch (error) { if (error instanceof VerificationAccessError) throw error; fail('Verification API request failed; response not confirmed') }
  }

  async function routeFetch(route, options = {}) {
    const incoming = route.request()
    const url = options.url ?? incoming.url()
    try { return await route.fetch({ ...options, headers: await headersFor(url, options.headers ?? incoming.headers()), maxRedirects: 0 }) }
    catch (error) { if (error instanceof VerificationAccessError) throw error; fail('Verification route forwarding failed; response not confirmed') }
  }

  async function routeContinue(route, options = {}) {
    const incoming = route.request(), url = options.url ?? incoming.url()
    if (!local && new URL(url).origin === origin) {
      // continue({headers}) propagates overrides through redirects. Keep the
      // credential only on this server-side hop; the browser receives no header.
      const response = await routeFetch(route, options)
      if (incoming.isNavigationRequest?.() && incoming.resourceType?.() === 'document') {
        // Playwright routes only the first request in an HTTP redirect chain:
        // https://playwright.dev/docs/network#handle-requests
        // A credential-free meta refresh creates a separately intercepted GET.
        // This adapter is test transport only; API checks retain raw 3xx evidence.
        const frame = incoming.frame?.()
        const reject = async () => { await route.abort('blockedbyclient'); fail('Protected document redirect is outside the supported verification boundary') }
        if (!frame || typeof frame !== 'object') return reject()
        const location = response.headers().location
        if ([301,302,303,307,308].includes(response.status()) && location) {
          let destination
          try { destination = new URL(location, url) } catch { return reject() }
          const hops = documentRedirectHops.get(frame) ?? 0
          if (incoming.method() !== 'GET' || destination.origin !== origin || destination.username || destination.password || hops >= 8) return reject()
          documentRedirectHops.set(frame, hops + 1)
          const escape = value => value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]))
          const headers = { ...response.headers(), 'content-type':'text/html; charset=utf-8', 'cache-control':'private, no-store, max-age=0' }
          for (const key of ['location','content-length','content-encoding','transfer-encoding']) delete headers[key]
          const body = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=' + escape(destination.href) + '"></head><body>Continuing verification.</body></html>'
          return route.fulfill({ response, status:200, headers, body })
        }
        documentRedirectHops.delete(frame)
      }
      return route.fulfill({ response })
    }
    return route.continue({ ...options, headers: await headersFor(url, options.headers ?? incoming.headers()) })
  }

  async function install(context) {
    const installed = contexts.get(context)
    if (installed) {
      if (installed !== origin) fail('A browser context cannot share Preview identities across origins')
      return
    }
    contexts.set(context, origin)
    if (!local) {
      let closed = false
      context.once?.('close', () => { closed = true })
      await context.route(url => url.origin === origin, async route => {
        try { return await routeContinue(route) }
        catch (error) {
          // BrowserContext.close disposes its APIRequestContext, rejecting a
          // pending route.fetch after the test has finished. That is cancelled
          // work, not a confirmed response. Active-context failures still fail.
          if (!closed) throw error
        }
      })
    }
  }
  return { origin, local, headersFor, fetch: fetchRequest, request, routeFetch, routeContinue, install }
}

function configuredAccess(appUrl) {
  const values = [process.env.VERIFY_APP_URL, process.env.BASE_URL, appUrl].filter(Boolean)
  if (!values.length) return null
  const origins = values.map(verificationOrigin)
  if (new Set(origins).size !== 1) fail('Verification application origins disagree')
  if (!accesses.has(origins[0])) accesses.set(origins[0], createVerificationAccess(origins[0]))
  return accesses.get(origins[0])
}

export const verificationFetch = (url, options = {}, appUrl) => {
  const access = configuredAccess(appUrl)
  if (!access) fail('Configure the exact verification application origin before HTTP access')
  return access.fetch(url, options)
}
export const verificationRequest = (context, url, options = {}, appUrl) => {
  const access = configuredAccess(appUrl)
  if (!access) fail('Configure the exact verification application origin before API access')
  return access.request(context, url, options)
}
export const installVerificationAccess = (context, appUrl) => {
  const access = configuredAccess(appUrl)
  if (!access) fail('Configure the exact verification application origin before browser access')
  return access.install(context)
}
// Existing disposable-local response-loss helpers have no hosted target env.
// They retain their native route behavior; hosted children always have the
// coordinator's validated VERIFY_APP_URL and therefore use the scoped bridge.
export const forwardVerificationRoute = (route, options = {}, appUrl) => configuredAccess(appUrl)?.routeFetch(route, options) ?? route.fetch(options)
export const continueVerificationRoute = (route, options = {}, appUrl) => configuredAccess(appUrl)?.routeContinue(route, options) ?? route.continue(options)
