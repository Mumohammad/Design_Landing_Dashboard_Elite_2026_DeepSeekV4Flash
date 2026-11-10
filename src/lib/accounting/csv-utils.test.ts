// Financial Phase 14 — unit tests for the shared CSV helpers + error mapper.
import { describe, expect, it } from "vitest"
import { mapFinancialError, parseCsv, toCsv } from "./csv-utils"

describe("toCsv", () => {
  it("joins headers and rows with commas", () => {
    expect(toCsv(["a", "b"], [[1, 2], [3, 4]])).toBe("a,b\n1,2\n3,4")
  })

  it("quotes fields containing commas", () => {
    expect(toCsv(["note"], [["x, y"]])).toBe('note\n"x, y"')
  })

  it("escapes embedded double quotes by doubling them", () => {
    expect(toCsv(["note"], [['he said "hi"']])).toBe('note\n"he said ""hi"""')
  })

  it("quotes fields containing newlines", () => {
    expect(toCsv(["note"], [["line1\nline2"]])).toBe('note\n"line1\nline2"')
  })

  it("serializes null as empty fields", () => {
    expect(toCsv(["a", "b"], [[null, null]])).toBe("a,b\n,")
  })

  it("round-trips through parseCsv", () => {
    const csv = toCsv(["name", "amount"], [["شركة, تجارية", "1,000.50"], ['q"uote', null]])
    expect(parseCsv(csv)).toEqual([
      ["name", "amount"],
      ["شركة, تجارية", "1,000.50"],
      ['q"uote', ""],
    ])
  })
})

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b\nc,d\n")).toEqual([["a", "b"], ["c", "d"]])
  })

  it("normalizes CRLF line endings", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([["a", "b"], ["c", "d"]])
  })

  it("keeps commas inside quoted fields", () => {
    expect(parseCsv('"x,y",z')).toEqual([["x,y", "z"]])
  })

  it("un-escapes doubled quotes inside quoted fields", () => {
    expect(parseCsv('"a ""b"" c"')).toEqual([['a "b" c']])
  })

  it("drops fully empty trailing rows", () => {
    expect(parseCsv("a,b\n\n\n")).toEqual([["a", "b"]])
  })

  it("returns an empty array for empty input", () => {
    expect(parseCsv("")).toEqual([])
  })
})

describe("mapFinancialError", () => {
  it("maps a known DB-raised code to its bilingual English message", () => {
    expect(mapFinancialError("JRN004: Posted journal entry does not balance (debits ≠ credits)."))
      .toBe("Posted journal entry does not balance (debits ≠ credits).")
    expect(mapFinancialError("INV003: some message")).toBe("Finalized invoices are immutable; use a credit or debit note.")
    expect(mapFinancialError("VAT004: reclassification locked")).toBe(
      "Review item is not pending review; reclassification is locked."
    )
  })

  it("returns the raw message for unknown codes", () => {
    expect(mapFinancialError("FOO123: something unexpected")).toBe("FOO123: something unexpected")
    expect(mapFinancialError("plain message without a code")).toBe("plain message without a code")
  })
})
