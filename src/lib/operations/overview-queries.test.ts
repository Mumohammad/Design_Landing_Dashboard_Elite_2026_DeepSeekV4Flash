import { describe, expect, it, vi } from "vitest"
import { createClient } from "@supabase/supabase-js"
import {
  attendanceQuery, attendanceSummary, performanceQuery, performanceSummary,
  violationsQuery, violationsSummary,
} from "./overview-queries"
import { substringFilter } from "@/lib/supabase/search-filter"

function fixture(reply: (url: URL, method: string) => Response = () => new Response("[]", { headers: { "content-range": "0-0/0" } })) {
  const requests: { url: URL; method: string }[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? "GET"
    requests.push({ url, method })
    return reply(url, method)
  })
  const client = createClient("https://overview-fixture.test", "public-fixture-placeholder", {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false },
  })
  return { client, requests }
}
const signal = () => new AbortController().signal
const counted = (count: number, method: string, rows: unknown[] = []) => new Response(method === "HEAD" ? null : JSON.stringify(rows), {
  headers: { "content-range": `0-${Math.max(0, rows.length - 1)}/${count}`, "content-type": "application/json" },
})

describe("operational overview reads", () => {
  it.each([
    ["attendance", (c: ReturnType<typeof fixture>["client"], term: string) => attendanceQuery(c, term, "2026-10-19"), "created_at.desc,id.asc"],
    ["reviews", performanceQuery, "review_date.desc,id.asc"],
    ["violations", violationsQuery, "created_at.desc,id.asc"],
  ] as const)("%s uses bounded pages with exact counts, live rows and stable ordering", async (_, query, ordering) => {
    const { client, requests } = fixture()
    await query(client, "").range(100, 124)
    const params = requests[0].url.searchParams
    expect(params.get("offset")).toBe("100")
    expect(params.get("limit")).toBe("25")
    expect(params.get("order")).toBe(ordering)
    expect(params.get("deleted_at")).toBe("is.null")
    expect(params.get("select")).toContain("driver_id")
    expect(params.get("driver_search.or")).toBeNull()
  })

  it("attendance applies the chosen date and filters driver names/codes without a driver-ID cap", async () => {
    const { client, requests } = fixture()
    const term = 'أحمد "50%_,x)'
    await attendanceQuery(client, term, "2026-02-28").range(0, 24)
    const p = requests[0].url.searchParams
    expect(p.get("attendance_date")).toBe("eq.2026-02-28")
    expect(p.get("driver_search.or")).toBe(`(${substringFilter(["full_name_ar", "full_name_en", "driver_code"], term)})`)
    expect(p.get("driver_search")).toBe("not.is.null")
    expect(p.get("driver_id")).toBeNull()
  })

  it.each([[performanceQuery, ["review_period"]], [violationsQuery, ["violation_ref", "incident_description"]]] as const)(
    "searches document OR driver fields without filtering the displayed driver", async (query, columns) => {
      const { client, requests } = fixture()
      const term = 'x),id.neq.1,("50%_'
      await query(client, term).range(0, 24)
      const p = requests[0].url.searchParams
      expect(p.get("or")).toBe(`(${substringFilter(columns, term)},driver_search.not.is.null)`)
      expect(p.get("driver.or")).toBeNull()
      expect(p.get("select")).toContain("driver:drivers(full_name_ar,driver_code),driver_search:drivers()")
    },
  )

  it("attendance summaries count the full chosen date independently of page/search", async () => {
    const { client, requests } = fixture((url, method) => counted(url.searchParams.has("status") ? 30 : 106, method))
    expect(await attendanceSummary(client, "2026-10-19", signal())).toEqual([106, 30, 30, 30])
    for (const request of requests) {
      expect(request.method).toBe("HEAD")
      expect(request.url.searchParams.get("attendance_date")).toBe("eq.2026-10-19")
      expect(request.url.searchParams.get("limit")).toBeNull()
      expect(request.url.searchParams.get("deleted_at")).toBe("is.null")
    }
  })

  it("reviews count pending, completed and high scores across all rows", async () => {
    const { client, requests } = fixture((_, method) => counted(106, method))
    expect(await performanceSummary(client, signal())).toEqual([106, 106, 106, 106])
    expect(requests.some(({ url }) => url.searchParams.get("overall_score") === "gte.80")).toBe(true)
  })

  it.each(["failure", "missing count"])("rejects a summary %s instead of claiming zero", async (failure) => {
    const { client } = fixture(() => failure === "failure"
      ? new Response('{"message":"private database detail"}', { status: 403 }) : new Response(null))
    await expect(performanceSummary(client, signal())).rejects.toThrow("Could not load overview totals")
  })

  it("sums all deduction pages with exact decimal arithmetic", async () => {
    const { client, requests } = fixture((url, method) => {
      if (method === "HEAD") return counted(106, method)
      const offset = Number(url.searchParams.get("offset") ?? 0)
      return counted(501, method, offset === 0
        ? Array.from({ length: 500 }, (_, i) => ({ id: String(i), deduction_amount: "0.10" }))
        : [{ id: "last", deduction_amount: "0.20" }])
    })
    expect(await violationsSummary(client, signal())).toEqual({ counts: [106, 106, 106], deductions: 50.2 })
    const pages = requests.filter(({ method }) => method === "GET")
    expect(pages).toHaveLength(2)
    expect(pages[1].url.searchParams.get("offset")).toBe("500")
    expect(pages.every(({ url }) => url.searchParams.get("status") === "eq.deduction_applied" && url.searchParams.get("order") === "id.asc")).toBe(true)
  })

  it.each([null, "bad", -1, "1.001"])("rejects invalid deduction %s instead of inventing an amount", async amount => {
    const { client } = fixture((_, method) => counted(1, method, [{ id: "one", deduction_amount: amount }]))
    await expect(violationsSummary(client, signal())).rejects.toThrow("Could not load overview totals")
  })

  it("rejects truncated or failed deduction reads without returning partial metrics", async () => {
    let page = 0
    const { client } = fixture((_, method) => method === "HEAD" ? counted(2, method)
      : counted(2, method, page++ === 0 ? [{ id: "first", deduction_amount: 100 }] : []))
    await expect(violationsSummary(client, signal())).rejects.toThrow("incomplete report")
  })
})
