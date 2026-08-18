// Financial Phase 14 — unit tests for the report CSV builder
// (TEST-STRATEGY.md §3.1): RFC-4180-ish quoting, CRLF line endings, UTF-8.
import { describe, expect, it } from "vitest"
import { buildCsv } from "./generator"

describe("buildCsv", () => {
  it("joins rows with CRLF and ends with a trailing CRLF", () => {
    expect(buildCsv(["a", "b"], [[1, 2]])).toBe("a,b\r\n1,2\r\n")
  })

  it("quotes fields containing commas", () => {
    expect(buildCsv(["note"], [["x, y"]])).toBe('note\r\n"x, y"\r\n')
  })

  it("escapes embedded double quotes by doubling them", () => {
    expect(buildCsv(["note"], [['say "hi"']])).toBe('note\r\n"say ""hi"""\r\n')
  })

  it("quotes fields containing CR/LF", () => {
    const csv = buildCsv(["note"], [["line1\nline2"]])
    expect(csv).toBe('note\r\n"line1\nline2"\r\n')
    expect(csv.startsWith('note\r\n"')).toBe(true)
  })

  it("serializes null/undefined as empty fields", () => {
    expect(buildCsv(["a", "b"], [[null, undefined]])).toBe("a,b\r\n,\r\n")
  })

  it("preserves Arabic (UTF-8) content", () => {
    const csv = buildCsv(["name"], [["شركة تجارية"]])
    expect(csv).toContain("شركة تجارية")
  })
})
