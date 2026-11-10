import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { verifyStagingHistory } from "./verify-staging-history.mjs"

test("eight exact archived versions verify without a database", () => assert.equal(verifyStagingHistory(), 8))
for (const mutation of ["tamper", "replay", "active", "extra"]) test("rejects historical archive " + mutation, () => {
  const root = mkdtempSync(join(tmpdir(), "elite-history-"))
  try {
    const archive = join(root, "supabase/history/staging")
    cpSync(new URL("../supabase/history/staging", import.meta.url), archive, { recursive: true })
    mkdirSync(join(root, "supabase/migrations"), { recursive: true })
    const path = join(archive, "manifest.json")
    const manifest = JSON.parse(readFileSync(path, "utf8"))
    const row = manifest.migrations[0]
    const file = row.version + "_" + row.name + ".sql"
    if (mutation === "tamper") writeFileSync(join(archive, file), "-- changed SQL")
    if (mutation === "replay") writeFileSync(join(root, "supabase/migrations", file), "-- forbidden replay")
    if (mutation === "active") { manifest.active_migrations = true; writeFileSync(path, JSON.stringify(manifest)) }
    if (mutation === "extra") writeFileSync(join(archive, "untracked.sql"), "-- extra")
    assert.throws(() => verifyStagingHistory(root))
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + requireSeparator()) || !root.split(/[\\/]/).at(-1).startsWith("elite-history-")) throw new Error("Unsafe temporary cleanup target")
    rmSync(root, { recursive: true, force: true })
  }
})
function requireSeparator() { return process.platform === "win32" ? "\\" : "/" }
