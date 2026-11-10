import { describe, expect, it } from "vitest"
import { substringFilter } from "./search-filter"

describe("literal table search", () => {
  it("quotes commas, brackets, and filter-like user input as one value", () => {
    expect(substringFilter(["name", "code"], 'x),id.neq.1,("y'))
      .toBe('name.ilike."%x),id.neq.1,(\\"y%",code.ilike."%x),id.neq.1,(\\"y%"')
  })
  it("escapes SQL wildcard characters and backslashes", () => {
    expect(substringFilter(["name"], "  50%_\\  "))
      .toBe('name.ilike."%50\\\\%\\\\_\\\\\\\\%"')
  })
  it("preserves Arabic and limits the query length", () => {
    expect(substringFilter(["name"], "الرياض")).toBe('name.ilike."%الرياض%"')
    expect(substringFilter(["name"], "a".repeat(201))).toBe(`name.ilike."%${"a".repeat(200)}%"`)
  })
})
