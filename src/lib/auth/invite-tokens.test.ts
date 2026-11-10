// Financial/auth Phase 2 close-out — unit tests for invite-token hashing.
// bcrypt hashes are salted, so two hashes of the same token differ — assert
// the VERIFY result, never the hash equality.
import { describe, expect, it } from "vitest"
import { hashInviteToken, hashTokenLegacy, verifyInviteToken } from "./invite-tokens"

const TOKEN = "c98f0a5f-9b6e-4b3a-8c2d-1e2f3a4b5c6d"

describe("hashInviteToken (bcrypt, current format)", () => {
  it("produces a bcrypt `$2` hash with cost 10", async () => {
    const h = await hashInviteToken(TOKEN)
    expect(h.startsWith("$2")).toBe(true)
    expect(h.length).toBe(60)
  })

  it("is salted — two hashes of the same token differ", async () => {
    const [a, b] = await Promise.all([hashInviteToken(TOKEN), hashInviteToken(TOKEN)])
    expect(a).not.toBe(b)
  })
})

describe("verifyInviteToken — bcrypt format", () => {
  it("verifies a correct token", async () => {
    const h = await hashInviteToken(TOKEN)
    expect(await verifyInviteToken(TOKEN, h)).toBe(true)
  })

  it("rejects a wrong token", async () => {
    const h = await hashInviteToken(TOKEN)
    expect(await verifyInviteToken(`${TOKEN}-wrong`, h)).toBe(false)
  })

  it("rejects an empty token / empty hash", async () => {
    expect(await verifyInviteToken("", "anything")).toBe(false)
    expect(await verifyInviteToken(TOKEN, "")).toBe(false)
  })
})

describe("verifyInviteToken — legacy SHA-256 format (pre-057)", () => {
  it("verifies a legacy SHA-256 hash", async () => {
    const legacy = hashTokenLegacy(TOKEN)
    expect(await verifyInviteToken(TOKEN, legacy)).toBe(true)
  })

  it("rejects a wrong token against a legacy hash", async () => {
    const legacy = hashTokenLegacy(TOKEN)
    expect(await verifyInviteToken(`${TOKEN}-wrong`, legacy)).toBe(false)
  })

  it("is case-insensitive on the stored hex", async () => {
    const legacy = hashTokenLegacy(TOKEN).toUpperCase()
    expect(await verifyInviteToken(TOKEN, legacy)).toBe(true)
  })
})

describe("verifyInviteToken — malformed storage", () => {
  it("rejects a hash format that is neither bcrypt nor 64-hex", async () => {
    expect(await verifyInviteToken(TOKEN, "not-a-hash")).toBe(false)
    expect(await verifyInviteToken(TOKEN, "abc")).toBe(false)
    // 63 hex chars — not a valid 64-char SHA-256 digest.
    expect(await verifyInviteToken(TOKEN, "a".repeat(63))).toBe(false)
  })

  it("never throws on a corrupt bcrypt hash", async () => {
    await expect(verifyInviteToken(TOKEN, "$2a$10$broken")).resolves.toBe(false)
  })
})
