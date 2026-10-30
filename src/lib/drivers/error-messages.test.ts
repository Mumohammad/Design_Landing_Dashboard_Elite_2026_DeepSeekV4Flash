import { describe, expect, it } from "vitest"
import { driverErrorMessage } from "./error-messages"

describe("driverErrorMessage", () => {
  it("maps database codes to bilingual text", () => {
    expect(driverErrorMessage("DRIVER_INVALID_IBAN", false)).toMatch(/IBAN is not valid/)
    expect(driverErrorMessage("DRIVER_STALE_VERSION: reload the driver before saving", true)).toMatch(/أعد التحميل/)
    expect(driverErrorMessage("AUTH007: driver permission required", false)).toMatch(/permission/)
  })
  it("passes unknown messages through and falls back when empty", () => {
    expect(driverErrorMessage("A driver with this code or identity already exists.", false)).toBe("A driver with this code or identity already exists.")
    expect(driverErrorMessage(undefined, false, "Save failed")).toBe("Save failed")
  })
})
