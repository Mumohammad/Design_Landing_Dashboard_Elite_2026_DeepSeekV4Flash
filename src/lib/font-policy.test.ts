import { readFile, readdir } from "node:fs/promises"
import { readFileSync } from "node:fs"
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
describe("font policy (Prompt M2 regression guard)", () => {
  it("uses local fonts at build time and runtime", { timeout: 60_000 }, async () => {
    const remoteUrls: string[] = []
    const remoteImports: string[] = []
    const entries = await readdir("src", { recursive: true, withFileTypes: true })
    // Test sources may mention the domains and import this guard checks.
    const files = entries
      .filter(entry => entry.isFile() && /\.(tsx?|css|html)$/.test(entry.name) && !/\.test\.[tj]sx?$/.test(entry.name))
      .map(entry => join(entry.parentPath, entry.name))
    for (let index = 0; index < files.length; index += 32) {
      const batch = files.slice(index, index + 32)
      const contents = await Promise.all(batch.map(file => readFile(file, "utf8")))
      for (const [offset, content] of contents.entries()) {
        if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(content)) remoteUrls.push(batch[offset])
        if (/next\/font\/google/.test(content)) remoteImports.push(batch[offset])
      }
    }
    expect({ remoteUrls, remoteImports }).toEqual({ remoteUrls: [], remoteImports: [] })
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
