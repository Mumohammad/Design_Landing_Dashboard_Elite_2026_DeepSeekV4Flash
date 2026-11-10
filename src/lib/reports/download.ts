export interface ReportDownloadRecord {
  id: string
  status: string
  file_url: string | null
  file_name: string | null
  file_size_bytes: number | null
  expires_at: string
}

type FailureCode = "expired" | "unavailable"
export class ReportDownloadError extends Error {
  constructor(readonly code: FailureCode) {
    super(code === "expired" ? "Report expired" : "Report download unavailable")
    this.name = "ReportDownloadError"
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_BYTES = 100 * 1024 * 1024
const unavailable = () => new ReportDownloadError("unavailable")

export function reportHasExpired(record: Pick<ReportDownloadRecord, "status" | "expires_at">, now = Date.now()): boolean {
  return record.status === "expired" || Number.isFinite(Date.parse(record.expires_at)) && Date.parse(record.expires_at) <= now
}

/** Presentation guard only. Storage RLS still authorizes signing the object. */
export function prepareReportDownload(record: ReportDownloadRecord, backendUrl: string, now = Date.now()) {
  if (reportHasExpired(record, now)) throw new ReportDownloadError("expired")
  const expiresAt = Date.parse(record.expires_at)
  const size = record.file_size_bytes
  if (record.status !== "completed" || !uuid.test(record.id) || !record.file_url || !record.file_name ||
      !Number.isFinite(expiresAt) || !Number.isFinite(now) || !Number.isSafeInteger(size) || size! < 1 || size! > MAX_BYTES ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.csv$/.test(record.file_name)) throw unavailable()
  const parts = record.file_url.split("/")
  if (parts.length !== 3 || !uuid.test(parts[0]) || parts[1] !== record.id || parts[2] !== record.file_name) throw unavailable()
  let backend: URL
  try { backend = new URL(backendUrl) } catch { throw unavailable() }
  if (backend.username || backend.password || backend.pathname !== "/" || backend.search || backend.hash ||
      backend.protocol !== "https:" && !(backend.protocol === "http:" && ["localhost", "127.0.0.1"].includes(backend.hostname))) throw unavailable()
  const ttl = Math.min(3600, Math.floor((expiresAt - now) / 1000))
  if (ttl < 1) throw new ReportDownloadError("expired")
  return {
    objectPath: record.file_url, filename: record.file_name, size: size!, expiresAt, ttl,
    origin: backend.origin,
    pathname: "/storage/v1/object/sign/generated-reports/" + parts.map(encodeURIComponent).join("/"),
  }
}

type Request = ReturnType<typeof prepareReportDownload>
export function validateReportDownloadUrl(value: string, request: Request): URL {
  let url: URL
  try { url = new URL(value) } catch { throw unavailable() }
  if (url.origin !== request.origin || url.username || url.password || url.hash || url.pathname !== request.pathname ||
      url.searchParams.getAll("token").length !== 1 || !url.searchParams.get("token") ||
      url.searchParams.getAll("download").length !== 1 || url.searchParams.get("download") !== request.filename ||
      [...url.searchParams.keys()].some(key => !["token", "download"].includes(key))) throw unavailable()
  return url
}

type SignUrl = (path: string, expiresIn: number, options: { download: string }) => PromiseLike<{
  data: { signedUrl: string } | null
  error: unknown
}>

/** Never navigate to an unvalidated URL or expose capability URLs in errors. */
export async function fetchReportDownload(
  record: ReportDownloadRecord,
  backendUrl: string,
  signUrl: SignUrl,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<{ blob: Blob; filename: string }> {
  try {
    const request = prepareReportDownload(record, backendUrl, now())
    const { data, error } = await signUrl(request.objectPath, request.ttl, { download: request.filename })
    if (error || !data?.signedUrl) throw unavailable()
    if (now() >= request.expiresAt) throw new ReportDownloadError("expired")
    const url = validateReportDownloadUrl(data.signedUrl, request)
    const response = await fetchImpl(url, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(60_000) })
    // The header may describe compressed transfer bytes; bound the decoded stream separately.
    const length = response.headers.get("content-length")
    const type = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
    if (!response.ok || !["text/csv", "application/octet-stream"].includes(type ?? "") ||
        length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) {
      await response.body?.cancel().catch(() => {})
      throw unavailable()
    }
    const reader = response.body?.getReader()
    if (!reader) throw unavailable()
    const chunks: BlobPart[] = []
    let bytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > request.size) throw unavailable()
        chunks.push(value.slice())
      }
    } catch (error) {
      await reader.cancel().catch(() => {})
      throw error
    } finally {
      reader.releaseLock()
    }
    if (bytes !== request.size) throw unavailable()
    const blob = new Blob(chunks, { type: response.headers.get("content-type") ?? "text/csv" })
    if (now() >= request.expiresAt) throw new ReportDownloadError("expired")
    return { blob, filename: request.filename }
  } catch (error) {
    if (error instanceof ReportDownloadError) throw error
    throw unavailable()
  }
}
