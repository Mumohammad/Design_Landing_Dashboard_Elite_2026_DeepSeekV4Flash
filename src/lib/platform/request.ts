type SessionGetter = () => Promise<{ data: { session: { access_token: string } | null }; error?: unknown }>
export class PlatformRequestError extends Error { constructor(message: string, public status: number) { super(message) } }
/** Read the shared browser session for every request; never retain a token snapshot. */
export function createPlatformRequest(getSession: SessionGetter, locale: string, fetcher: typeof fetch = fetch) {
  const unavailable = () => new PlatformRequestError(locale === 'ar' ? 'تعذر تأكيد العملية. تحقق من الاتصال وأعد المحاولة.' : 'The operation could not be confirmed. Check your connection and retry.', 503)
  return async (path: string, init?: RequestInit) => {
    if (!/^\/api\/platform\/admin\/[a-z-]+(?:\?.*)?$/.test(path)) throw new PlatformRequestError('Invalid platform request.', 400)
    let auth: Awaited<ReturnType<SessionGetter>>
    try { auth = await getSession() } catch { throw unavailable() }
    if (auth.error) throw unavailable()
    if (!auth.data.session?.access_token) throw new PlatformRequestError(locale === 'ar' ? 'انتهت الجلسة. سجل الدخول مجدداً.' : 'Your session has ended. Sign in again.', 401)
    const headers = new Headers(init?.headers)
    headers.set('Authorization', 'Bearer ' + auth.data.session.access_token)
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    let response: Response
    try { response = await fetcher(path, { ...init, headers, redirect: 'error', cache: 'no-store', credentials: 'same-origin' }) } catch { throw unavailable() }
    let body
    try { body = await response.json() } catch { throw unavailable() }
    if (!response.ok) {
      if (response.status >= 500) throw unavailable()
      const message = (locale === 'ar' ? body?.error_ar : body?.error) || body?.error
      throw new PlatformRequestError(typeof message === 'string' ? message : (locale === 'ar' ? 'تعذر إكمال الطلب.' : 'The request could not be completed.'), response.status)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw unavailable()
    return body
  }
}
