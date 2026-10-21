import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

/**
 * Prompt M2 font policy — fonts are bundled and served via next/font/local
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
  // This scans the entire source tree with filesystem I/O. Windows release
  // verification can exceed the default 5s while other checks are running.
  it("src never references fonts.googleapis.com / fonts.gstatic.com at runtime", { timeout: 20_000 }, () => {
    const offenders: string[] = []
    for (const file of walk("src")) {
      const content = readFileSync(file, "utf8")
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(content)) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it("builds do not depend on a Google Fonts network download", { timeout: 20_000 }, () => {
    const offenders = [...walk("src")].filter(file => /next\/font\/google/.test(readFileSync(file, "utf8")))
    expect(offenders).toEqual([])
  })

  it("ships the four complete WOFF2 assets with matching integrity and OFL licenses", () => {
    const root = join("src", "assets", "fonts")
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"))
    expect(manifest.fonts.map((font: { family: string }) => font.family).sort()).toEqual([
      "Cairo", "Inter", "Noto Nastaliq Urdu", "Noto Sans Bengali",
    ])
    for (const font of manifest.fonts) {
      expect(font.ref).toMatch(/^[a-f0-9]{40}$/)
      expect(font.font.source).toMatch(new RegExp(`^https://github\\.com/google/fonts/blob/${font.ref}/ofl/`))
      expect(font.file).toMatch(/^[a-z]+\.woff2$/)
      expect(font.licenseFile).toMatch(/^licenses\/[a-z]+\.txt$/)
      const bytes = readFileSync(join(root, font.file))
      expect(bytes.subarray(0, 4).toString()).toBe("wOF2")
      expect(bytes.length).toBe(font.output.bytes)
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(font.output.sha256)
      const license = readFileSync(join(root, font.licenseFile))
      expect(license.length).toBe(font.license.bytes)
      expect(createHash("sha256").update(license).digest("hex")).toBe(font.license.sha256)
      expect(license.toString()).toMatch(/SIL OPEN FONT LICENSE\s+Version 1\.1/i)
    }
  })
})
