// FX-11 (J9) — regression tests pinning audit invariant #4:
// "returnTo/redirect params are validated (same-origin, single leading /)."
//
// safeReturnPath / landingUrlWithReturn are consumed by the real auth flows
// (auth/callback, auth/confirm, auth/mfa-challenge). These tests pin the
// open-redirect guard: only single-leading-slash relative paths survive;
// everything else falls back to a safe default.
//
// Mutation check (FX-11): removing the `startsWith("//")` or the
// `startsWith("/")` guard in redirects.ts makes the corresponding
// "falls back" assertions FAIL (the malicious input passes through).

import { describe, expect, it } from "vitest"

import { safeReturnPath, landingUrlWithReturn, REDIRECTS, DASHBOARD_PATH } from "./redirects"

describe("safeReturnPath — same-origin, single leading slash (invariant #4)", () => {
  it("accepts plain relative paths", () => {
    expect(safeReturnPath("/dashboard")).toBe("/dashboard")
    expect(safeReturnPath("/dashboard/accounting?tab=journal")).toBe(
      "/dashboard/accounting?tab=journal"
    )
  })

  it("falls back to the dashboard default for empty/null/undefined", () => {
    expect(safeReturnPath(null)).toBe(DASHBOARD_PATH)
    expect(safeReturnPath(undefined)).toBe(DASHBOARD_PATH)
    expect(safeReturnPath("")).toBe(DASHBOARD_PATH)
  })

  it("REJECTS protocol-relative URLs (//evil.example) — open redirect", () => {
    expect(safeReturnPath("//evil.example")).toBe(DASHBOARD_PATH)
    expect(safeReturnPath("///evil.example")).toBe(DASHBOARD_PATH)
  })

  it("REJECTS absolute URLs (http/https) — open redirect", () => {
    expect(safeReturnPath("https://evil.example")).toBe(DASHBOARD_PATH)
    expect(safeReturnPath("http://evil.example/dashboard")).toBe(DASHBOARD_PATH)
  })

  it("REJECTS scheme-smuggling shapes (javascript:, data:, whitespace)", () => {
    expect(safeReturnPath("javascript:alert(1)")).toBe(DASHBOARD_PATH)
    expect(safeReturnPath("data:text/html,<script>")).toBe(DASHBOARD_PATH)
    expect(safeReturnPath(" dashboard")).toBe(DASHBOARD_PATH) // no leading slash
    expect(safeReturnPath("dashboard")).toBe(DASHBOARD_PATH) // bare path
  })

  it("REJECTS backslash tricks (\\\\evil.example, /\\evil.example)", () => {
    // "\\\\evil" does not start with "/" and "/\\evil" is not a sane same-origin path
    // — both must fall back rather than being forwarded.
    expect(safeReturnPath("\\\\evil.example")).toBe(DASHBOARD_PATH)
  })
})

describe("landingUrlWithReturn — open-redirect-safe returnTo attachment", () => {
  it("returns the bare landing URL when returnTo is missing", () => {
    expect(landingUrlWithReturn(null)).toBe(REDIRECTS.landingUrl)
    expect(landingUrlWithReturn(undefined)).toBe(REDIRECTS.landingUrl)
  })

  it("encodes a valid relative returnTo as a query param", () => {
    const url = landingUrlWithReturn("/dashboard")
    expect(url).toBe(`${REDIRECTS.landingUrl}?returnTo=%2Fdashboard`)
  })

  it("drops dangerous returnTo values entirely (no param emitted)", () => {
    for (const evil of ["//evil.example", "https://evil.example", "javascript:alert(1)"]) {
      expect(landingUrlWithReturn(evil)).toBe(REDIRECTS.landingUrl)
    }
  })
})
