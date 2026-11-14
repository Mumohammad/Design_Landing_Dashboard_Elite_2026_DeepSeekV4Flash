import { readFileSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const projectRoot = fileURLToPath(new URL("../", import.meta.url))
export function verifyMigrationVersions(files, bindings) {
  const versions = new Map()
  for (const { name, sql } of files) {
    const match = /^(\d{3}|\d{14})_([a-z0-9_]+)\.sql$/.exec(name)
    if (!match || typeof sql !== "string" || !sql.trim()) throw Error("Invalid or empty migration file")
    if (versions.has(match[1])) throw Error("Duplicate migration version: " + match[1])
    versions.set(match[1], { name: match[2], sql })
  }
  const bound = new Set()
  for (const binding of bindings) {
    if (!/^\d{14}$/.test(binding.version) || !/^[a-z0-9_]+$/.test(binding.name) ||
        !/^[a-f0-9]{64}$/.test(binding.sourceSha256) || bound.has(binding.version)) throw Error("Invalid applied version binding")
    bound.add(binding.version)
    const file = versions.get(binding.version)
    if (!file || file.name !== binding.name) throw Error("Applied migration version was removed or reassigned: " + binding.version)
    const hash = createHash("sha256").update(file.sql.replaceAll("\r\n", "\n")).digest("hex")
    if (hash !== binding.sourceSha256) throw Error("Applied migration source changed; use a forward migration: " + binding.version)
  }
  return versions.size
}

export function verifyRepositoryMigrationVersions(root = projectRoot) {
  const directory = resolve(root, "supabase/migrations")
  const files = readdirSync(directory).filter(name => name.endsWith(".sql")).map(name => ({ name, sql: readFileSync(resolve(directory, name), "utf8") }))
  const manifest = JSON.parse(readFileSync(resolve(root, "supabase/history/applied-version-bindings.json"), "utf8"))
  if (!Array.isArray(manifest.bindings) || !manifest.bindings.length) throw Error("Applied version bindings required")
  return verifyMigrationVersions(files, manifest.bindings)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log("Migration version/source bindings verified: " + verifyRepositoryMigrationVersions() + " unique populated files; no database connection")
}
