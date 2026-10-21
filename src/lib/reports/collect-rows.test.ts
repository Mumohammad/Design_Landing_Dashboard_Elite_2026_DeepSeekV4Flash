import { describe, expect, it, vi } from "vitest"
import { collectRows } from "./collect-rows"

function source(total: number, serverCap = 500) {
  const records = Array.from({ length: total }, (_, i) => ({ id: `row-${i}` }))
  const range = vi.fn(async (from: number, to: number) => ({
    data: records.slice(from, Math.min(to + 1, from + serverCap)), error: null, count: total,
  }))
  return { range, build: () => ({ range, then: Promise.resolve({ data: [], error: null, count: total }).then }) }
}

describe("complete report collection", () => {
  it("exports every row beyond the API's default 1,000-row cap", async () => {
    const q = source(1251)
    const rows = await collectRows(q.build)
    expect(rows).toHaveLength(1251)
    expect(rows[rows.length - 1]?.id).toBe("row-1250")
    expect(q.range.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499]])
  })

  it("continues if the server's cap is smaller than the requested batch", async () => {
    const q = source(751, 200)
    expect(await collectRows(q.build)).toHaveLength(751)
    expect(q.range.mock.calls.map(([start]) => start)).toEqual([0, 200, 400, 600])
  })

  it("accepts an explicitly empty result", async () => {
    expect(await collectRows(source(0).build)).toEqual([])
  })

  it.each([-1, 1.5, Number.NaN, Infinity, "1"])("rejects malformed count %s", async count => {
    const q = source(1)
    q.range.mockResolvedValue({ data: [{ id:"one" }], error:null, count } as never)
    await expect(collectRows(q.build)).rejects.toThrow("Could not read report data")
  })

  it("rejects database errors without exposing their contents", async () => {
    const q = source(1)
    q.range.mockResolvedValueOnce({ data: [], count: 0, error: { message: "private database detail" } } as never)
    await expect(collectRows(q.build)).rejects.toThrow("Could not read report data")
  })

  it("rejects a failed later page instead of exporting the first batch", async () => {
    const q = source(800)
    q.range.mockImplementationOnce(async () => ({ data: [{ id: "first" }], count: 800, error: null }))
    q.range.mockResolvedValueOnce({ data: [], count: 800, error: { message: "network failure" } } as never)
    await expect(collectRows(q.build)).rejects.toThrow("no partial file")
  })

  it.each([null, 502])("rejects a missing or changed count (%s)", async (count) => {
    const q = source(501)
    q.range.mockImplementationOnce(async () => ({ data: [{ id: "first" }], count: 501, error: null }))
    q.range.mockResolvedValueOnce({ data: [{ id: "second" }], count, error: null } as never)
    await expect(collectRows(q.build)).rejects.toThrow()
  })

  it("rejects a premature empty page", async () => {
    const q = source(501)
    q.range.mockImplementationOnce(async () => ({ data: [{ id: "first" }], count: 501, error: null }))
    q.range.mockResolvedValueOnce({ data: [], count: 501, error: null })
    await expect(collectRows(q.build)).rejects.toThrow("incomplete report")
  })

  it("rejects duplicate rows after a concurrent reorder", async () => {
    const q = source(2, 1)
    q.range.mockResolvedValue({ data: [{ id: "duplicate" }], count: 2, error: null })
    await expect(collectRows(q.build)).rejects.toThrow("changed during generation")
  })

  it("fails explicitly when the resource budget is exceeded", async () => {
    const q = source(100001)
    await expect(collectRows(q.build)).rejects.toThrow("exceeds 100,000 rows")
    expect(q.range).toHaveBeenCalledTimes(1)
  })
})
