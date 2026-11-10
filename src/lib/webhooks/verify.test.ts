// FX-11 (J9) — regression tests pinning audit invariant #2:
// "Webhook HMAC signatures use a timing-safe comparison."
//
// verify.ts previously had NO unit tests. These tests pin:
//   - crypto.timingSafeEqual is actually invoked for the final comparison
//     (structural pin — a swap to `===` or a hand-rolled loop fails the test);
//   - the length-mismatch short-circuit happens BEFORE the constant-time
//     compare (no timingSafeEqual call, rejected);
//   - fail-closed behavior on missing signature/secret;
//   - freshness/replay window (MAX_WEBHOOK_AGE_MS, future timestamps);
//   - verifyZatcaWebhook / verifyPlatformWebhook fail closed in production
//     when their secret is missing (invariant #1 flavor).
//
// Mutation check (FX-11): replacing the timingSafeEqual call in verify.ts
// with `cleanSignature === expected` makes "uses crypto.timingSafeEqual…"
// FAIL (spy not called) while accept/reject outcomes stay identical —
// proving the pin targets the invariant, not incidental behavior.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import crypto from "crypto"

import {
  verifyIncomingWebhook,
  verifyIncomingWebhookWithFreshness,
  verifyZatcaWebhook,
  verifyPlatformWebhook,
  MAX_WEBHOOK_AGE_MS,
} from "./verify"

const SECRET = "test-webhook-secret"
const BODY = '{"event":"status.update","id":"evt_1"}'
const OTHER_BODY = '{"event":"status.update","id":"evt_2"}'

function sign(body: string, secret = SECRET): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex")
}

describe("verifyIncomingWebhook — timing-safe HMAC in use", () => {
  let spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    spy = vi.spyOn(crypto, "timingSafeEqual")
  })

  afterEach(() => {
    spy.mockRestore()
  })

  it("accepts a correctly signed body (with sha256= prefix)", () => {
    expect(verifyIncomingWebhook(SECRET, BODY, `sha256=${sign(BODY)}`)).toBe(true)
  })

  it("accepts a correctly signed body (raw hex, no prefix)", () => {
    expect(verifyIncomingWebhook(SECRET, BODY, sign(BODY))).toBe(true)
  })

  it("uses crypto.timingSafeEqual for the final comparison", () => {
    expect(verifyIncomingWebhook(SECRET, BODY, sign(BODY))).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    const [received, expected] = spy.mock.calls[0]
    expect(expected.toString("utf8")).toBe(sign(BODY))
    expect(received.equals(expected)).toBe(true)
  })

  it("short-circuits on length mismatch WITHOUT entering the timing-safe compare", () => {
    expect(verifyIncomingWebhook(SECRET, BODY, "deadbeef")).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it("rejects an equal-length signature that is wrong", () => {
    const wrong = sign(OTHER_BODY) // same length (64 hex), different content
    expect(wrong).not.toBe(sign(BODY))
    expect(verifyIncomingWebhook(SECRET, BODY, wrong)).toBe(false)
  })

  it("rejects a signature computed over a tampered body", () => {
    expect(verifyIncomingWebhook(SECRET, OTHER_BODY, sign(BODY))).toBe(false)
  })

  it("rejects a signature from a different secret (fail closed)", () => {
    expect(verifyIncomingWebhook(SECRET, BODY, sign(BODY, "attacker-secret"))).toBe(false)
  })

  it("rejects a missing / null / empty signature (fail closed)", () => {
    expect(verifyIncomingWebhook(SECRET, BODY, undefined)).toBe(false)
    expect(verifyIncomingWebhook(SECRET, BODY, null)).toBe(false)
    expect(verifyIncomingWebhook(SECRET, BODY, "")).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it("rejects when the secret is missing / empty (fail closed)", () => {
    expect(verifyIncomingWebhook("", BODY, sign(BODY))).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe("verifyIncomingWebhookWithFreshness — replay window", () => {
  it("accepts a fresh, correctly signed webhook", () => {
    const res = verifyIncomingWebhookWithFreshness(
      SECRET,
      BODY,
      `sha256=${sign(BODY)}`,
      new Date().toISOString()
    )
    expect(res.valid).toBe(true)
    expect(res.reason).toBeUndefined()
  })

  it("rejects a timestamp older than MAX_WEBHOOK_AGE_MS (replay)", () => {
    const old = new Date(Date.now() - (MAX_WEBHOOK_AGE_MS + 60_000)).toISOString()
    const res = verifyIncomingWebhookWithFreshness(SECRET, BODY, `sha256=${sign(BODY)}`, old)
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/too old/)
  })

  it("rejects a far-future timestamp (|age| window — replay forward)", () => {
    const future = new Date(Date.now() + (MAX_WEBHOOK_AGE_MS + 60_000)).toISOString()
    const res = verifyIncomingWebhookWithFreshness(SECRET, BODY, `sha256=${sign(BODY)}`, future)
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/too old/)
  })

  it("rejects an invalid timestamp format", () => {
    const res = verifyIncomingWebhookWithFreshness(SECRET, BODY, `sha256=${sign(BODY)}`, "not-a-date")
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/Invalid timestamp/)
  })

  it("rejects a missing signature before any other check", () => {
    const res = verifyIncomingWebhookWithFreshness(
      SECRET,
      BODY,
      undefined,
      new Date().toISOString()
    )
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/Missing signature/)
  })
})

describe("verifyZatcaWebhook / verifyPlatformWebhook — fail closed in production", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("ZATCA: returns false in production when ZATCA_WEBHOOK_SECRET is missing", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ZATCA_WEBHOOK_SECRET", "")
    expect(verifyZatcaWebhook(BODY, sign(BODY))).toBe(false)
  })

  it("ZATCA: verifies correctly when the secret is configured", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("ZATCA_WEBHOOK_SECRET", SECRET)
    expect(verifyZatcaWebhook(BODY, `sha256=${sign(BODY)}`)).toBe(true)
    expect(verifyZatcaWebhook(BODY, sign(OTHER_BODY))).toBe(false)
  })

  it("platform: returns false in production when the platform secret is missing", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("CAREEM_WEBHOOK_SECRET", "")
    expect(verifyPlatformWebhook("careem", BODY, sign(BODY))).toBe(false)
  })

  it("platform: verifies correctly when the secret is configured", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("CAREEM_WEBHOOK_SECRET", SECRET)
    expect(verifyPlatformWebhook("careem", BODY, sign(BODY))).toBe(true)
    expect(verifyPlatformWebhook("careem", BODY, "0".repeat(64))).toBe(false)
  })
})
