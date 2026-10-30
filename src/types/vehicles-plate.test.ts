import { describe, expect, it } from "vitest"
import { isSaudiPlate, normalizeSaudiPlate, vehicleCreateSchema } from "./vehicles"

describe("Saudi plate normalization", () => {
  it.each([
    ["a b c 1234", "ABC 1234"],
    ["ABC1234", "ABC 1234"],
    ["أ ب ج 1234", "أبج 1234"],
    [" 1234567 ", "1234567"],
    ["ABC-1234", "ABC 1234"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeSaudiPlate(input)).toBe(expected)
    expect(isSaudiPlate(normalizeSaudiPlate(input))).toBe(true)
  })
  it("rejects garbage and stores the canonical form", () => {
    expect(isSaudiPlate(normalizeSaudiPlate("HELLO"))).toBe(false)
    const parsed = vehicleCreateSchema.parse({ plate_number: "x y z 987", make: "Toyota", model: "Hilux", status: "available" })
    expect(parsed.plate_number).toBe("XYZ 987")
  })
})
