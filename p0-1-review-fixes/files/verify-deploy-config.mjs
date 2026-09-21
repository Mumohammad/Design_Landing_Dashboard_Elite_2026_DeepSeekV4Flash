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
  // REV-2: the only STAGING_* reference allowed in production is the URL,
  // used to compare against PRODUCTION_SUPABASE_URL. Credentials must
  // never appear in the production job.
  const forbiddenStaging = production.filter(
    (line) =>
      line.includes("STAGING_SUPABASE_ANON_KEY") ||
      line.includes("STAGING_SUPABASE_SERVICE_KEY")
  )
  if (forbiddenStaging.length > 0) {
    fail(
      `Production job must not reference STAGING_* credentials (${forbiddenStaging.length} line(s)):\n${forbiddenStaging.map((line) => `      ${line.trim()}`).join("\n")}`
    )
  } else {
    ok("No STAGING_* credential references in the production job (URL comparison only)")
  }

  // Extract the lines belonging to a named step (from its "- name:" line to
  // the next "- name:" line at the same indentation).
  const stepRegion = (block, stepName) => {
    const start = block.findIndex((line) => line.includes(`- name: ${stepName}`))
    if (start === -1) return null
    const region = []
    for (let i = start; i < block.length; i++) {
      if (i > start && /^\s+- name:/.test(block[i])) break
      region.push(block[i])
    }
    return region
  }

  // REV-1: the guard step must pass secrets via env: and must not
  // interpolate them into the run: block (shell injection).
  const guard = stepRegion(production, "Verify production Supabase secrets")
  if (!guard) {
    fail('Production job is missing the "Verify production Supabase secrets" guard step')
  } else {
    ok("Fail-fast secret guard step present")
    const requiredEnv = [
      "PRODUCTION_SUPABASE_URL:",
      "PRODUCTION_SUPABASE_ANON_KEY:",
      "PRODUCTION_SUPABASE_SERVICE_KEY:",
      "STAGING_SUPABASE_URL:",
    ]
    for (const envKey of requiredEnv) {
      if (!guard.some((line) => line.includes(envKey))) {
        fail(`Guard step env: is missing "${envKey.slice(0, -1)}"`)
      }
    }
    const runIdx = guard.findIndex((line) => /^\s+run:\s*\|/.test(line))
    if (runIdx === -1) {
      fail("Guard step is missing its run: block")
    } else {
      const body = guard.slice(runIdx + 1)
      const interpolated = body.filter((line) => line.includes("${{ secrets."))
      if (interpolated.length > 0) {
        fail(
          `Guard step interpolates secrets into the run: block (shell-injectable):\n${interpolated.map((line) => `      ${line.trim()}`).join("\n")}`
        )
      } else {
        ok("Guard step reads secrets via env: variables (no interpolation)")
      }
    }
  }

  // REV-6: the production bundle must be checked for staging references
  // before deploy.
  const bundleCheck = stepRegion(
    production,
    "Verify production bundle has no staging references"
  )
  if (bundleCheck) {
    ok("Bundle verification step present")
  } else {
    fail('Production job is missing the "Verify production bundle has no staging references" step')
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
