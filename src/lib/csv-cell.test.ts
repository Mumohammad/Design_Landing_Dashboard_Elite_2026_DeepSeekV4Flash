import { describe, expect, it } from "vitest"
import { escapeCsvCell } from "./csv-cell"

describe("spreadsheet CSV cells", () => {
  it.each(["=1+1", "+SUM(A1)", "-cmd|'x'!A0", "@SUM(A1)", " \t=1", "\r=1", "＝1+1", "＠SUM(A1)"])("neutralizes formula-like text %j", value => {
    expect(escapeCsvCell(value)).toBe(`"\t${value}"`)
  })
  it("keeps numeric balances and numeric database strings unchanged", () => {
    for (const value of [-123.45, "-123.45", "+4.50", "-1e3", 0]) expect(escapeCsvCell(value)).toBe(String(value))
  })
  it("contains injected separators and quotes inside a single inert cell", () => {
    expect(escapeCsvCell('=1,"=2"')).toBe('"\t=1,""=2"""')
    expect(escapeCsvCell('safe,"=2"')).toBe('"safe,""=2"""')
  })
})
