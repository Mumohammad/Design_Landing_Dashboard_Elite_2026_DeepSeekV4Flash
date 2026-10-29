import { describe, expect, it } from "vitest"
import { calculateVat, decimalRound, multiplyMoney, sumMoney } from "./decimal"

describe("exact decimal arithmetic", () => {
  it("uses PostgreSQL half-away-from-zero rounding", () => {
    expect(decimalRound("1.005")).toBe(1.01)
    expect(decimalRound("-1.005")).toBe(-1.01)
    expect(decimalRound("0.0049")).toBe(0)
  })
  it("accepts decimal and scientific notation without binary products", () => {
    expect(multiplyMoney("0.5", "8.21")).toBe(4.11)
    expect(decimalRound(1e-7)).toBe(0)
    expect(calculateVat("4.10", "15")).toBe(0.62)
  })
  it("accumulates integer minor units and subtracts exactly", () => {
    expect(sumMoney(...Array<number>(1000).fill(0.01))).toBe(10)
    expect(sumMoney(0.3, -0.2, -0.1)).toBe(0)
  })
  it("rejects non-decimal, nonfinite and unsafe values", () => {
    for (const value of [NaN, Infinity, "", "0x10", "1e999", "9007199254740992"]) {
      expect(() => decimalRound(value)).toThrow()
    }
  })
})

it.each(["70368744177664.01","90071992547409.91","-70368744177664.01","-90071992547409.91"])("rejects a decimal whose cents cannot survive the UI Number boundary: %s",value=>{expect(()=>decimalRound(value)).toThrow("Decimal out of range")})
it("retains exact large decimal values that round-trip at cents precision",()=>{expect(decimalRound("70368744177664.02")).toBe(70368744177664.02);expect(sumMoney("35000000000000.00","35000000000000.00")).toBe(70000000000000)})
