import { expect, it } from "vitest"
import { oppositeTheme } from "./theme-policy"

it.each([
  ["system", true, "light"],
  ["system", false, "dark"],
  ["dark", true, "light"],
  ["dark", false, "light"],
  ["light", true, "dark"],
  ["light", false, "dark"],
] as const)("switches the resolved %s theme with system dark=%s to %s", (theme, systemDark, expected) => {
  expect(oppositeTheme(theme, systemDark)).toBe(expected)
})
