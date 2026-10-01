import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Prompt M2 font policy — fonts are self-hosted via next/font/google
 * (src/lib/fonts.ts) so the runtime never requests fonts.googleapis.com or
 * fonts.gstatic.com. The owner's console showed a blocked
 * `fonts.googleapis.com/css2?family=Inter...` stylesheet; this contract
 * fails if anyone reintroduces a runtime Google Fonts request (a <link>, an
 * @import, or a preconnect) that the CSP would have to allow.
 */
function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) yield* walk(full)
    // *.test.ts files are excluded — this contract's own source mentions the
    // domains it polices.
    else if (/\.(tsx?|css|html)$/.test(entry) && !/\.test\.[tj]sx?$/.test(entry)) yield full
  }
}

describe("font policy (Prompt M2 regression guard)", () => {
  it("src never references fonts.googleapis.com / fonts.gstatic.com at runtime", () => {
    const offenders: string[] = []
    for (const file of walk("src")) {
      const content = readFileSync(file, "utf8")
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(content)) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it("fonts are declared through next/font/google (self-hosted at build)", () => {
    const fonts = readFileSync(join("src", "lib", "fonts.ts"), "utf8")
    expect(fonts).toMatch(/from ['"]next\/font\/google['']/)
    expect(fonts).toContain("Inter({")
    expect(fonts).toContain("Cairo({")
  })
})
