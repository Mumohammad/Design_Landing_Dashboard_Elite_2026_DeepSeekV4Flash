// Status-copy audit — Financial Phase 16 follow-up.
//
// ZATCA-BOUNDARY.md §5 forbids UI copy (and, by extension, any shipped code)
// from implying ZATCA compliance, approval, or certification. This test makes
// that guardrail enforceable in `pnpm test`: it scans every non-test file
// under `src/` for compliance-claim language and fails with the offending
// file:line if any slips in. It also pins the sandbox/no-compliance
// disclaimer in the ZATCA tab and the factual status vocabulary, so a future
// edit cannot silently delete the disclaimer or introduce a
// "compliant"-sounding badge.
//
// The audit deliberately bans *assertions* (X is compliant/certified/
// approved) — never the word "compliance" itself, so disclaimers like
// "no compliance claimed" / "دون ادعاء امتثال" keep passing.

import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const SRC = path.join(process.cwd(), "src")

// Assertion forms only — each requires "ZATCA" next to the claim word.
// English: "ZATCA-compliant", "ZATCA certified", "approved by ZATCA", …
const COMPLIANCE_CLAIM_PATTERNS: RegExp[] = [
  /\bZATCA[-\s]*(?:compliant|certified|approved)\b/i,
  /\b(?:compliant|certified|approved)[-\s]*(?:with|by)\s+ZATCA\b/i,
  // Arabic: "متوافق مع ZATCA", "معتمد من ZATCA", "ZATCA معتمد", …
  /متوافق[ة]?\s+مع\s+ZATCA/u,
  /معتمد[ة]?\s+(?:من|لدى)\s+ZATCA/u,
  /ZATCA\s+(?:متوافق|معتمد)/u,
]

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...walk(full))
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.ts$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

const SHIPPED_FILES = walk(SRC)

describe("ZATCA status-copy audit (ZATCA-BOUNDARY.md §5)", () => {
  it("no compliance-claim language anywhere in shipped code", { timeout: 20000 }, () => {
    const hits: string[] = []
    for (const file of SHIPPED_FILES) {
      const lines = readFileSync(file, "utf8").split("\n")
      lines.forEach((line, i) => {
        if (COMPLIANCE_CLAIM_PATTERNS.some((p) => p.test(line))) {
          hits.push(`${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(hits, "compliance-claim language found — ZATCA-BOUNDARY.md §5 forbids it").toEqual([])
  })
})

describe("ZATCA tab copy pins (Accounting page)", () => {
  const pagePath = path.join(SRC, "app", "(dashboard)", "accounting", "page.tsx")
  const page = readFileSync(pagePath, "utf8")

  it("keeps the sandbox / no-compliance disclaimer in both languages", () => {
    expect(page).toContain("no compliance claimed")
    expect(page).toContain("دون ادعاء امتثال")
  })

  it("keeps the ZATCA status badges to the factual status vocabulary", () => {
    const block = page.match(/const ZATCA_STATUS[\s\S]*?const ZATCA_DOC_TYPE/)![0]
    const keys = [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])
    const allowed = new Set(["not_transmitted", "pending", "reported", "cleared", "rejected", "failed"])
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(allowed.has(key), `ZATCA_STATUS key "${key}" is not in the factual vocabulary`).toBe(true)
    }
  })
})
