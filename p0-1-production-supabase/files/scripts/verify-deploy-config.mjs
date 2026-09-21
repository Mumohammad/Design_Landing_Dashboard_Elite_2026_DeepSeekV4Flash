#!/usr/bin/env node
/**
 * verify-deploy-config.mjs — regression guard for the P0-1 production
 * Supabase repoint (2026-09-07).
 *
 * Asserts that the production deployment job in .github/workflows/deploy.yml
 * builds against the PRODUCTION_* Supabase secrets and never references
 * STAGING_* secrets, while the preview job intentionally keeps using staging.
 *
 * Dependency-free (Node >= 18). Usage:
 *   node scripts/verify-deploy-config.mjs [path/to/deploy.yml]
 *
 * Exit code 0 when every invariant holds, 1 otherwise.
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workflowPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(scriptDir, "..", ".github", "workflows", "deploy.yml")

let text
let lines

try {
  text = readFileSync(workflowPath, "utf8")
  lines = text.split("\n")
} catch (error) {
  console.error(`❌ Cannot read workflow file: ${workflowPath}`)
  console.error(`   ${error.message}`)
  process.exit(1)
}

// Job keys sit at exactly two spaces of indentation under `jobs:`.
// Step keys are indented deeper, so this regex only matches job names.
const jobKeyRe = /^  ([A-Za-z0-9_-]+):\s*$/

const jobBlocks = new Map()
let current = null
for (const line of lines) {
  const match = line.match(jobKeyRe)
  if (match) {
    current = match[1]
    jobBlocks.set(current, [])
    continue
  }
  if (current !== null) jobBlocks.get(current).push(line)
}

const failures = []
const ok = (message) => console.log(`  ✅ ${message}`)
const fail = (message) => {
  failures.push(message)
  console.error(`  ❌ ${message}`)
}

const requireJob = (name) => {
  if (!jobBlocks.has(name)) {
    fail(`Job "${name}" is missing from ${workflowPath}`)
    return null
  }
  return jobBlocks.get(name)
}

const findEnvValues = (block, key) => {
  const re = new RegExp(`^\\s+${key}:\\s*(.+)$`)
  return block.filter((line) => re.test(line)).map((line) => line.match(re)[1])
}

const assertSecret = (block, key, secretName, job) => {
  const values = findEnvValues(block, key)
  if (values.length === 0) {
    fail(`"${key}" is not set in the "${job}" job`)
    return
  }
  const expected = `secrets.${secretName}`
  if (!values.some((value) => value.includes(expected))) {
    fail(
      `"${key}" in the "${job}" job must reference ${expected}; found: ${values.join(" | ")}`
    )
  }
}

console.log(`Verifying deploy workflow: ${workflowPath}`)
console.log("")

const production = requireJob("production")
const preview = requireJob("preview")

if (production) {
  console.log("Production job:")
  assertSecret(production, "NEXT_PUBLIC_SUPABASE_URL", "PRODUCTION_SUPABASE_URL", "production")
  assertSecret(production, "NEXT_PUBLIC_SUPABASE_ANON_KEY", "PRODUCTION_SUPABASE_ANON_KEY", "production")
  assertSecret(production, "SUPABASE_SERVICE_ROLE_KEY", "PRODUCTION_SUPABASE_SERVICE_KEY", "production")
  const stagingRefs = production.filter((line) => line.includes("STAGING_"))
  if (stagingRefs.length > 0) {
    fail(
      `Production job must not reference STAGING_* secrets (${stagingRefs.length} line(s)):\n${stagingRefs.map((line) => `      ${line.trim()}`).join("\n")}`
    )
  } else {
    ok("No STAGING_* references in the production job")
  }
  const hasGuard = production.some((line) => line.includes("Verify production Supabase secrets"))
  if (hasGuard) {
    ok("Fail-fast secret guard step present")
  } else {
    fail('Production job is missing the "Verify production Supabase secrets" guard step')
  }
}

if (preview) {
  console.log("Preview job:")
  assertSecret(preview, "NEXT_PUBLIC_SUPABASE_URL", "STAGING_SUPABASE_URL", "preview")
  assertSecret(preview, "NEXT_PUBLIC_SUPABASE_ANON_KEY", "STAGING_SUPABASE_ANON_KEY", "preview")
  assertSecret(preview, "SUPABASE_SERVICE_ROLE_KEY", "STAGING_SUPABASE_SERVICE_KEY", "preview")
}

console.log("")
if (failures.length > 0) {
  console.error(`❌ Deploy config verification FAILED (${failures.length} violation(s))`)
  process.exit(1)
}
console.log("✅ Deploy config verification passed — production uses its own Supabase project")
