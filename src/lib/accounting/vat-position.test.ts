import { describe, expect, it } from "vitest"
import { createClient } from "@supabase/supabase-js"
import { formatVatMoney, parseVatPosition, readVatPosition, vatNetAdjustments } from "./vat-position"

const position = { output_vat: "100.10", recoverable_input_vat: "20.20", non_recoverable_vat: "2.00", pending_review_vat: "3.00", adjustments_output: "5.50", adjustments_input: "1.10", net_position: "84.30", period_count: 1201 }

describe("complete VAT position", () => {
  it("uses the session RPC without accepting a tenant or row limit", async () => {
    let request: URL | undefined
    const client = createClient("https://vat-fixture.test", "public-fixture-placeholder", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        request = new URL(String(input))
        expect(init?.body ?? "{}").toBe("{}")
        return Response.json({ ...position, ignored_private_field: "omit" })
      } },
    })
    expect(await readVatPosition(client, new AbortController().signal)).toEqual(position)
    expect(request?.pathname).toBe("/rest/v1/rpc/read_my_vat_position")
    expect(request?.search).toBe("")
  })

  it("preserves exact cents beyond the safe integer range", () => {
    const large = { ...position, output_vat: "9007199254740993.01", net_position: "9007199254740977.21" }
    expect(parseVatPosition(large)).toEqual(large)
    expect(formatVatMoney(large.net_position)).toBe("9,007,199,254,740,977.21")
    expect(vatNetAdjustments(position)).toBe("4.40")
    expect(formatVatMoney("-0.01")).toBe("-0.01")
  })

  it.each([null, [], {}, { ...position, period_count: -1 }, { ...position, period_count: 1.1 }, { ...position, net_position: "84.31" }])("rejects incomplete or inconsistent responses", value => {
    expect(() => parseVatPosition(value)).toThrow("Could not load VAT position")
  })
  it.each([12, "NaN", "1e3", "Infinity", "1.001", "1junk", " 1", "01", "9".repeat(41)])("rejects an inexact amount %s", value => {
    expect(() => parseVatPosition({ ...position, pending_review_vat: value })).toThrow("Could not load VAT position")
  })
  it("accepts a genuine empty tenant and a refund position", () => {
    expect(parseVatPosition(Object.fromEntries(Object.keys(position).map(key => [key, key === "period_count" ? 0 : "0"])))).toHaveProperty("net_position", "0")
    expect(parseVatPosition({ ...position, output_vat: "0", net_position: "-15.80" }).net_position).toBe("-15.80")
  })
  it.each([503, 403])("does not replace HTTP %i with zero totals", async status => {
    const client = createClient("https://vat-fixture.test", "public-fixture-placeholder", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async () => new Response('{"message":"private provider detail"}', { status, headers: { "content-type": "application/json" } }) },
    })
    await expect(readVatPosition(client, new AbortController().signal)).rejects.toThrow("Could not load VAT position")
  })
  it("rejects a canceled read even if a transport returns data", async () => {
    const controller = new AbortController()
    const client = createClient("https://vat-fixture.test", "public-fixture-placeholder", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async () => { controller.abort(); return Response.json(position) } },
    })
    await expect(readVatPosition(client, controller.signal)).rejects.toThrow("Could not load VAT position")
  })
})
