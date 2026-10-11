import { describe, expect, it, vi } from "vitest"
const redirect = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ redirect }))
import PlatformLoginPage from "./page"
describe("platform sign-in handoff", () => {
  it("keeps the supported auth route and carries a valid language", async () => {
    await PlatformLoginPage({ searchParams: Promise.resolve({ lang: "en" }) })
    expect(redirect).toHaveBeenLastCalledWith("/auth/sign-in?lang=en")
  })
  it("does not forward arbitrary language values", async () => {
    await PlatformLoginPage({ searchParams: Promise.resolve({ lang: "//foreign.test" }) })
    expect(redirect).toHaveBeenLastCalledWith("/auth/sign-in")
  })
})
