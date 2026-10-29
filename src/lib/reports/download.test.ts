import { describe, expect, it, vi } from "vitest"
import { fetchReportDownload, prepareReportDownload, reportHasExpired, ReportDownloadError, validateReportDownloadUrl, type ReportDownloadRecord } from "./download"

const now = Date.parse("2026-10-27T12:00:00Z")
const backend = "https://fixture.supabase.co"
const tenant = "10000000-0000-4000-8000-000000000001"
const report = "20000000-0000-4000-8000-000000000002"
const content = "Name,Amount\r\nشركة,23.45\r\n"
const record: ReportDownloadRecord = {
  id: report, status: "completed", file_url: `${tenant}/${report}/driver-performance-20261027.csv`,
  file_name: "driver-performance-20261027.csv", file_size_bytes: Buffer.byteLength(content),
  expires_at: "2026-10-28T12:00:00Z",
}
const signed = `${backend}/storage/v1/object/sign/generated-reports/${record.file_url}?token=synthetic-capability&download=${record.file_name}`
const sign = () => vi.fn(async () => ({ data: { signedUrl: signed }, error: null }))
const unavailable = (value: unknown) => expect(value).toMatchObject({ name: "ReportDownloadError", code: "unavailable", message: "Report download unavailable" })

describe("report expiry and object contract", () => {
  it("uses the report-owned path and caps its capability lifetime at one hour", () => {
    expect(prepareReportDownload(record, backend, now)).toMatchObject({ objectPath: record.file_url, filename: record.file_name, size: Buffer.byteLength(content), ttl: 3600, origin: backend })
    expect(prepareReportDownload({ ...record, expires_at: new Date(now + 30_000).toISOString() }, backend, now).ttl).toBe(30)
  })
  it.each(["expired", "completed"])("rejects an expired %s report before signing", async status => {
    const signer = sign(), request = vi.fn()
    const row = { ...record, status, expires_at: new Date(now).toISOString() }
    expect(reportHasExpired(row, now)).toBe(true)
    await expect(fetchReportDownload(row, backend, signer, request, () => now)).rejects.toMatchObject({ code: "expired" })
    expect(signer).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled()
  })
  it.each([
    { status: "failed" }, { file_size_bytes: null }, { file_size_bytes: 0 }, { file_size_bytes: 104857601 },
    { file_size_bytes: 1.5 }, { expires_at: "invalid" }, { id: "not-an-id" },
    { file_name: "../report.csv" }, { file_name: "report.html" }, { file_name: "report\r\n.csv" },
    { file_url: `${tenant}/${report}/different.csv` }, { file_url: `other/${report}/${record.file_name}` },
    { file_url: `${tenant}/${tenant}/${record.file_name}` }, { file_url: `${tenant}/${report}/../${record.file_name}` },
    { file_url: `${tenant}/${report}/${record.file_name}?token=private` },
  ])("rejects malformed, unbounded or mismatched report metadata: %o", async changes => {
    const signer = sign(), request = vi.fn()
    await expect(fetchReportDownload({ ...record, ...changes }, backend, signer, request, () => now)).rejects.toMatchObject({ code: "unavailable" })
    expect(signer).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled()
  })
  it.each(["https://fixture.supabase.co/other", "https://user:private@fixture.supabase.co", "https://fixture.supabase.co?key=private", "http://external.example", "not-a-url"])("rejects an unsafe backend config %s", value => {
    expect(() => prepareReportDownload(record, value, now)).toThrow(ReportDownloadError)
  })
})

describe("signed capability destination", () => {
  it("accepts only the exact backend bucket, object, filename and single token", () => {
    expect(validateReportDownloadUrl(signed, prepareReportDownload(record, backend, now)).href).toBe(signed)
  })
  it.each([
    signed.replace("fixture.supabase.co", "external.example"), signed.replace("https:", "http:"),
    signed.replace("generated-reports", "driver-documents"), signed.replace("/object/sign/", "/object/public/"),
    signed.replace(report, tenant), signed.replace("&download=driver", "&download=other"),
    signed + "#fragment", signed + "&token=another", signed + "&download=another.csv", signed + "&redirect=https://external.example",
    signed.replace("https://", "https://user:private@"), signed.replace("token=synthetic-capability", "token="),
  ])("rejects a changed signed destination without fetching", async value => {
    const signer = vi.fn(async () => ({ data: { signedUrl: value }, error: null })), request = vi.fn()
    await expect(fetchReportDownload(record, backend, signer, request, () => now)).rejects.toMatchObject({ code: "unavailable" })
    expect(request).not.toHaveBeenCalled()
  })
})

describe("bounded report download", () => {
  it("preserves the actual CSV bytes/filename and requests no cookies or redirect", async () => {
    const signer = sign(), request = vi.fn(async () => new Response(content, { headers: { "content-type": "text/csv; charset=utf-8", "content-length": String(Buffer.byteLength(content)) } }))
    const output = await fetchReportDownload(record, backend, signer, request, () => now)
    expect(await output.blob.text()).toBe(content); expect(output.filename).toBe(record.file_name)
    expect(signer).toHaveBeenCalledWith(record.file_url, 3600, { download: record.file_name })
    expect(request).toHaveBeenCalledWith(new URL(signed), { credentials: "omit", redirect: "error", signal: expect.any(AbortSignal) })
  })
  it("supports chunked private Storage output with no Content-Length", async () => {
    const output = await fetchReportDownload(record, backend, sign(), vi.fn(async () => new Response(content, { headers: { "content-type": "application/octet-stream" } })), () => now)
    expect(await output.blob.text()).toBe(content)
  })
  it("does not confuse a compressed Content-Length with decoded CSV bytes", async () => {
    const output = await fetchReportDownload(record, backend, sign(), vi.fn(async () => new Response(content, { headers: { "content-type": "text/csv", "content-length": "5", "content-encoding": "gzip" } })), () => now)
    expect(await output.blob.text()).toBe(content)
  })
  it("fails closed if the report expires while signing", async () => {
    const request = vi.fn(), clock = vi.fn().mockReturnValueOnce(now).mockReturnValue(Date.parse(record.expires_at))
    await expect(fetchReportDownload(record, backend, sign(), request, clock)).rejects.toMatchObject({ code: "expired" })
    expect(request).not.toHaveBeenCalled()
  })
  it("fails closed if the report expires during transfer", async () => {
    const clock = vi.fn().mockReturnValueOnce(now).mockReturnValueOnce(now).mockReturnValue(Date.parse(record.expires_at))
    await expect(fetchReportDownload(record, backend, sign(), vi.fn(async () => new Response(content, { headers: { "content-type": "text/csv" } })), clock)).rejects.toMatchObject({ code: "expired" })
  })
  it.each([
    () => new Response("private detail", { status: 503, headers: { "content-type": "text/csv" } }),
    () => new Response(content, { headers: { "content-type": "text/html" } }),
    () => new Response(content, { headers: { "content-type": "text/csv", "content-length": "104857601" } }),
    () => new Response(content + "extra", { headers: { "content-type": "text/csv" } }),
    () => new Response("short", { headers: { "content-type": "text/csv" } }),
  ])("rejects failure, non-CSV or truncated/oversized bytes", async response => {
    await expect(fetchReportDownload(record, backend, sign(), vi.fn(async () => response()), () => now)).rejects.toMatchObject({ code: "unavailable" })
  })
  it("cancels a body as soon as it exceeds the known maximum instead of buffering it", async () => {
    const cancelled = vi.fn(), stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(40)) }, cancel: cancelled })
    await expect(fetchReportDownload({ ...record, file_size_bytes: 3 }, backend, sign(), vi.fn(async () => new Response(stream, { headers: { "content-type": "text/csv" } })), () => now)).rejects.toMatchObject({ code: "unavailable" })
    expect(cancelled).toHaveBeenCalledTimes(1)
  })
  it("never returns internal messages or a signed capability in thrown errors", async () => {
    for (const signer of [vi.fn(async () => { throw Error(signed) }), vi.fn(async () => ({ data: null, error: { message: signed } }))]) {
      try { await fetchReportDownload(record, backend, signer, vi.fn(), () => now); expect.unreachable() } catch (error) { unavailable(error); expect(String(error)).not.toContain("synthetic-capability") }
    }
    try { await fetchReportDownload(record, backend, sign(), vi.fn(async () => { throw Error(signed) }), () => now); expect.unreachable() } catch (error) { unavailable(error); expect(String(error)).not.toContain("synthetic-capability") }
  })
})
