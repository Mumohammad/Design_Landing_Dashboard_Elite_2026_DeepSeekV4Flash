import { describe, expect, it } from "vitest"
import { createClient } from "@supabase/supabase-js"
import { GOV_CHECK_TYPES } from "./government-checks"
import { readDriverHandovers, readDriverScorecard, readHandoverEvidenceUrls, readLatestGovernmentChecks } from "./profile-operational-reads"

type Row = Record<string, unknown>
type Request = { url: URL; headers: Headers; body: unknown; signal: AbortSignal | null | undefined }
const signal = () => new AbortController().signal
function reply(data: unknown, count?: number, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json", ...(count === undefined ? {} : { "content-range": `0-0/${count}` }),
  } })
}
function fixture(read: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = []
  const db = createClient("https://driver-panel-fixture.test", "public-fixture-placeholder", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const request = { url: new URL(String(input)), headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null, signal: init?.signal }
      requests.push(request)
      return read(request)
    } },
  })
  return { db, requests }
}
function page(request: Request, rows: Row[]) {
  const offset = Number(request.url.searchParams.get("offset") ?? 0)
  const limit = Number(request.url.searchParams.get("limit") ?? rows.length)
  return reply(rows.slice(offset, offset + limit), rows.length)
}
function scoreReply(request: Request, overrides: Record<string, Row[]> = {}) {
  const table = request.url.pathname.split("/").pop() as string
  if (table === "drivers") return reply({ iqama_expiry_date: "2030-01-01", license_expiry_date: "2030-01-01", passport_expiry_date: "2030-01-01" })
  return page(request, overrides[table] ?? [])
}

describe("complete driver scorecard reads", () => {
  it("scores histories beyond the old caps and requests the exact three months across a year boundary", async () => {
    const attendance = Array.from({ length: 501 }, (_, index) => ({ id: `attendance-${index}`, status: "present" }))
    const orders = Array.from({ length: 501 }, (_, index) => ({ id: `order-${index}`, total_delivered: 20, total_failed: 0, total_returned: 0, working_days: 1 }))
    const { db, requests } = fixture(request => scoreReply(request, { driver_attendance: attendance, monthly_driver_orders: orders }))
    const card = await readDriverScorecard(db, "driver-a", "2027-01-02", signal())
    expect(card.pillars.find(pillar => pillar.key === "attendance")?.detail.en).toContain("501 days")
    expect(card.pillars.find(pillar => pillar.key === "productivity")?.detail.en).toContain("10,020 orders")
    const orderRequests = requests.filter(request => request.url.pathname.endsWith("/monthly_driver_orders"))
    expect(orderRequests.map(request => request.url.searchParams.get("offset"))).toEqual(["0", "500"])
    expect(orderRequests[0].url.searchParams.get("or")).toBe("(and(period_year.eq.2027,period_month.eq.1),and(period_year.eq.2026,period_month.eq.12),and(period_year.eq.2026,period_month.eq.11))")
    for (const request of orderRequests) {
      expect(request.headers.get("Prefer")).toContain("count=exact")
      expect(request.url.searchParams.get("order")).toBe("id.asc")
      expect(request.url.searchParams.get("driver_id")).toBe("eq.driver-a")
    }
    const review = requests.find(request => request.url.pathname.endsWith("/performance_reviews"))!
    expect(review.url.searchParams.get("order")).toBe("review_date.desc,id.desc")
    expect(review.url.searchParams.get("limit")).toBe("1")
  })

  it.each(["driver_attendance", "violations", "monthly_driver_orders", "drivers", "performance_reviews"])("does not produce a grade after %s fails", async table => {
    const { db } = fixture(request => request.url.pathname.endsWith(`/${table}`)
      ? reply({ message: "Read denied" }, undefined, 403) : scoreReply(request))
    await expect(readDriverScorecard(db, "driver-a", "2026-11-02", signal())).rejects.toThrow()
  })

  it("rejects a failed later page instead of grading the successful first page", async () => {
    const attendance = Array.from({ length: 501 }, (_, index) => ({ id: `attendance-${index}`, status: "present" }))
    const { db } = fixture(request => request.url.pathname.endsWith("/driver_attendance") && request.url.searchParams.get("offset") === "500"
      ? reply({ message: "Later page failed" }, undefined, 403) : scoreReply(request, { driver_attendance: attendance }))
    await expect(readDriverScorecard(db, "driver-a", "2026-11-02", signal())).rejects.toThrow()
  })
})

describe("latest government checks", () => {
  it("reads a deterministic latest result for every type even when another type has over 100 newer checks", async () => {
    const { db, requests } = fixture(request => {
      const type = request.url.searchParams.get("check_type")?.slice(3)
      return reply([{ id: `${type}-latest`, check_type: type, result: "ok", checked_on: "2026-10-01", created_at: "2026-10-01T00:00:00Z" }], type === "muqeem" ? 250 : 1)
    })
    const rows = await readLatestGovernmentChecks(db, "driver-a", signal())
    expect(rows.map(row => row.check_type)).toEqual([...GOV_CHECK_TYPES])
    expect(requests).toHaveLength(6)
    for (const request of requests) {
      expect(request.url.searchParams.get("driver_id")).toBe("eq.driver-a")
      expect(request.url.searchParams.get("order")).toBe("checked_on.desc,created_at.desc,id.desc")
      expect(request.url.searchParams.get("limit")).toBe("1")
      expect(request.headers.get("Prefer")).toContain("count=exact")
    }
  })

  it.each(["failure", "missing-count", "missing-row"])("rejects %s for a check type instead of showing Not checked", async fault => {
    const { db } = fixture(request => {
      if (request.url.searchParams.get("check_type") !== "eq.qiwa") return reply([], 0)
      return fault === "failure" ? reply({ message: "Denied" }, undefined, 403) : reply([], fault === "missing-count" ? undefined : 1)
    })
    await expect(readLatestGovernmentChecks(db, "driver-a", signal())).rejects.toThrow()
  })
})

describe("handover history and evidence", () => {
  it("collects every report and assignment with stable pages", async () => {
    const forms = Array.from({ length: 501 }, (_, index) => ({ id: `form-${index}`, photos: [], driver_signature_url: null, supervisor_signature_url: null }))
    const assignments = Array.from({ length: 501 }, (_, index) => ({ id: `assignment-${index}`, driver_id: "driver-a" }))
    const { db, requests } = fixture(request => page(request, request.url.pathname.endsWith("/vehicle_handover_forms") ? forms : assignments))
    const result = await readDriverHandovers(db, "driver-a", signal())
    expect(result.list).toHaveLength(501)
    expect(result.assignments).toHaveLength(501)
    expect(requests.filter(request => request.url.pathname.endsWith("/vehicle_handover_forms")).map(request => request.url.searchParams.get("offset"))).toEqual(["0", "500"])
    expect(requests[0].url.searchParams.get("order")).toBe("form_date.desc,created_at.desc,id.asc")
    expect(requests.every(request => request.headers.get("Prefer")?.includes("count=exact"))).toBe(true)
  })

  it.each(["vehicle_handover_forms", "vehicle_assignments"])("rejects a failed %s read", async table => {
    const { db } = fixture(request => request.url.pathname.endsWith(`/${table}`) ? reply({ message: "Denied" }, undefined, 403) : reply([], 0))
    await expect(readDriverHandovers(db, "driver-a", signal())).rejects.toThrow()
  })

  it("deduplicates and signs evidence in bounded batches", async () => {
    const { db, requests } = fixture(request => reply((request.body as { paths: string[] }).paths.map(path => ({ path, signedURL: `/object/sign/handover-evidence/${path}?token=fixture` }))))
    const paths = Array.from({ length: 101 }, (_, index) => `tenant/form/photo-${index}.png`)
    const urls = await readHandoverEvidenceUrls(db, [...paths, paths[0]])
    expect(Object.keys(urls)).toHaveLength(101)
    expect(requests.map(request => (request.body as { paths: string[] }).paths.length)).toEqual([100, 1])
  })

  it("rejects a missing evidence URL instead of silently omitting it from the report", async () => {
    const { db } = fixture(() => reply([{ path: "tenant/form/photo.png", error: "Not found" }]))
    await expect(readHandoverEvidenceUrls(db, ["tenant/form/photo.png"])).rejects.toThrow()
  })

  it("does not start storage work after the driver request is cancelled", async () => {
    const { db, requests } = fixture(() => reply([]))
    const controller = new AbortController()
    controller.abort()
    await expect(readHandoverEvidenceUrls(db, ["tenant/form/photo.png"], controller.signal)).rejects.toThrow("Read cancelled")
    expect(requests).toHaveLength(0)
  })
})
