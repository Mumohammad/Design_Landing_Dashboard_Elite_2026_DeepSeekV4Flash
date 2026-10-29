import { readFileSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const projectRoot = fileURLToPath(new URL("../", import.meta.url))
export function verifyStagingHistory(root = projectRoot) {
  const archive = resolve(root, "supabase/history/staging")
  const manifest = JSON.parse(readFileSync(resolve(archive, "manifest.json"), "utf8"))
  if (manifest.project_ref !== "viowrovartosrkqukjxy" || manifest.active_migrations !== false ||
      !/^[a-f0-9]{40}$/.test(manifest.source_commit ?? "") || manifest.migrations?.length !== 8) {
    throw new Error("Historical staging manifest is invalid or executable")
  }
  const files = readdirSync(archive).filter(name => name.endsWith(".sql")).sort()
  const expected = manifest.migrations.map(row => {
    if (!/^\d{14}$/.test(row.version) || !/^[a-z0-9_]+$/.test(row.name) || !/^[a-f0-9]{64}$/.test(row.sha256)) {
      throw new Error("Historical staging entry has invalid metadata")
    }
    const file = row.version + "_" + row.name + ".sql"
    const sql = readFileSync(resolve(archive, file), "utf8").replaceAll("\r\n", "\n").replace(/[\r\n]+$/, "")
    if (createHash("sha256").update(sql).digest("hex") !== row.sha256) throw new Error("Historical staging SQL checksum mismatch")
    return file
  }).sort()
  if (new Set(expected).size !== 8 || JSON.stringify(expected) !== JSON.stringify(files)) {
    throw new Error("Historical staging archive contains missing, duplicate or untracked SQL")
  }
  const executable = readdirSync(resolve(root, "supabase/migrations"))
  if (manifest.migrations.some(row => executable.some(file => file.startsWith(row.version + "_")))) {
    throw new Error("Historical staging SQL must not be replayed as canonical migrations")
  }
  return expected.length
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log("Historical staging archive verified: " + verifyStagingHistory() + " versions; no database connection") }
  catch { console.error("Historical staging archive verification failed; inspect manifest, checksums and executable separation"); process.exitCode = 1 }
}
