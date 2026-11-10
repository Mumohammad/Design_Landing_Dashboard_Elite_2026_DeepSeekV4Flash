#!/usr/bin/env node

/**
 * EliteDev Load Test Runner (Node.js)
 *
 * A lightweight alternative to k6 for quick performance profiling.
 * No external dependencies — uses only Node.js built-ins.
 *
 * Tests: GET /api/load-test?scenario=<scenario>
 *
 * Usage:
 *   node loadtest/run.js [scenario] [--vus N] [--duration S]
 *
 * Examples:
 *   node loadtest/run.js                          # all scenarios, 10 VUs, 30s
 *   node loadtest/run.js dashboard --vus 20 --duration 60
 *   node loadtest/run.js payroll --vus 10 --duration 45
 *   node loadtest/run.js accounting --vus 5 --duration 30
 *   BASE_URL=https://staging.example.com node loadtest/run.js all --vus 50
 *
 * Environment:
 *   BASE_URL          Target URL (default: http://localhost:3000)
 *   LOAD_TEST_SECRET  Bearer token (production only)
 */

const https = require("https")
const http = require("http")
const { URL } = require("url")

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const scenario = args.find((a) => !a.startsWith("--")) || "all"
const vuFlag = args.indexOf("--vus")
const durFlag = args.indexOf("--duration")
const VUS = vuFlag >= 0 ? parseInt(args[vuFlag + 1], 10) || 10 : 10
const DURATION_SEC = durFlag >= 0 ? parseInt(args[durFlag + 1], 10) || 30 : 30

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const LOAD_TEST_SECRET = process.env.LOAD_TEST_SECRET || ""

// ── Colors ───────────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
}

// ── HTTP request helper ──────────────────────────────────────────────────────
function fetch(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr)
    const mod = url.protocol === "https:" ? https : http
    const headers = { "Content-Type": "application/json" }
    if (LOAD_TEST_SECRET) headers["Authorization"] = `Bearer ${LOAD_TEST_SECRET}`

    const start = performance.now()
    const req = mod.get(url, { headers, timeout: 30000 }, (res) => {
      const chunks = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => {
        const duration = performance.now() - start
        const body = Buffer.concat(chunks).toString()
        resolve({ status: res.statusCode, duration, body })
      })
    })
    req.on("error", (e) => {
      resolve({ status: 0, duration: performance.now() - start, body: "", error: e.message })
    })
    req.on("timeout", () => {
      req.destroy()
      resolve({ status: 0, duration: performance.now() - start, body: "", error: "timeout" })
    })
  })
}

// ── Percentile calculator ────────────────────────────────────────────────────
function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)] ?? 0
}

// ── Worker ───────────────────────────────────────────────────────────────────
async function worker(id, url, endTime, results) {
  while (Date.now() < endTime) {
    const res = await fetch(url)
    results.push(res)

    if (res.status !== 200) {
      console.log(`${C.red}  ✗ VU-${id}: ${res.status} (${Math.round(res.duration)}ms)${C.reset}`)
    }

    // Think time: 0.5–2s random
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 1500))
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const url = `${BASE_URL}/api/load-test?scenario=${scenario}`
  const endTime = Date.now() + DURATION_SEC * 1000
  const results = []

  console.log()
  console.log(`${C.bold}${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`)
  console.log(`${C.bold}${C.cyan}  EliteDev Load Test${C.reset}`)
  console.log(`${C.bold}${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`)
  console.log(`${C.dim}  Scenario:  ${C.reset}${scenario}`)
  console.log(`${C.dim}  Target:    ${C.reset}${url}`)
  console.log(`${C.dim}  VUs:       ${C.reset}${VUS}`)
  console.log(`${C.dim}  Duration:  ${C.reset}${DURATION_SEC}s`)
  console.log()

  // Pre-flight check
  console.log(`${C.dim}  Pre-flight check...${C.reset}`)
  const preflight = await fetch(url)
  if (preflight.status !== 200) {
    console.log(`${C.red}  ✗ Pre-flight failed: ${preflight.status}${C.reset}`)
    if (preflight.body) {
      try {
        const errBody = JSON.parse(preflight.body)
        console.log(`${C.red}    ${errBody.error || preflight.body.slice(0, 200)}${C.reset}`)
      } catch {
        console.log(`${C.red}    ${preflight.body.slice(0, 200)}${C.reset}`)
      }
    }
    console.log()
    console.log(`${C.yellow}  Make sure the dev server is running:${C.reset}`)
    console.log(`${C.dim}  pnpm dev${C.reset}`)
    process.exit(1)
  }
  console.log(`${C.green}  ✓ Pre-flight OK${C.reset}`)
  console.log()

  // Run load test
  console.log(`${C.bold}  Running ${VUS} VUs for ${DURATION_SEC}s...${C.reset}`)
  const startTime = Date.now()
  const workers = Array.from({ length: VUS }, (_, i) => worker(i + 1, url, endTime, results))

  // Progress indicator
  const progressInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000)
    const pct = Math.min(100, Math.round((elapsed / DURATION_SEC) * 100))
    process.stdout.write(`\r${C.dim}  [${"█".repeat(pct / 5)}${"░".repeat(20 - pct / 5)}] ${pct}% (${results.length} requests)${C.reset}`)
  }, 1000)

  await Promise.all(workers)
  clearInterval(progressInterval)
  process.stdout.write("\r" + " ".repeat(80) + "\r")

  const totalMs = Date.now() - startTime

  // ── Calculate stats ────────────────────────────────────────────────────────
  const durations = results.map((r) => r.duration).sort((a, b) => a - b)
  const successes = results.filter((r) => r.status === 200)
  const failures = results.filter((r) => r.status !== 200)
  const rps = results.length / (totalMs / 1000)

  const p50 = percentile(durations, 50)
  const p75 = percentile(durations, 75)
  const p90 = percentile(durations, 90)
  const p95 = percentile(durations, 95)
  const p99 = percentile(durations, 99)
  const avg = durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0
  const max = durations[durations.length - 1] || 0

  // ── Parse scenario results ─────────────────────────────────────────────────
  const scenarioStats = {}
  for (const r of successes) {
    try {
      const body = JSON.parse(r.body)
      if (body.scenarios) {
        for (const s of body.scenarios) {
          if (!scenarioStats[s.scenario]) {
            scenarioStats[s.scenario] = { queries: [], totalMs: s.summary.totalMs }
          }
          scenarioStats[s.scenario].queries.push(...s.queries)
        }
      }
    } catch { /* ignore parse errors */ }
  }

  // ── Print results ──────────────────────────────────────────────────────────
  console.log()
  console.log(`${C.bold}${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`)
  console.log(`${C.bold}${C.cyan}  Results${C.reset}`)
  console.log(`${C.bold}${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`)
  console.log()
  console.log(`${C.dim}  Total Requests:    ${C.reset}${results.length}`)
  console.log(`${C.dim}  Successful:        ${C.reset}${C.green}${successes.length}${C.reset}`)
  console.log(`${C.dim}  Failed:            ${C.reset}${failures.length > 0 ? C.red + failures.length : C.green + "0"}${C.reset}`)
  console.log(`${C.dim}  Requests/sec:      ${C.reset}${rps.toFixed(1)}`)
  console.log(`${C.dim}  Total Duration:    ${C.reset}${(totalMs / 1000).toFixed(1)}s`)
  console.log()
  console.log(`${C.bold}  Response Times:${C.reset}`)
  console.log(`${C.dim}    Avg:             ${C.reset}${avg.toFixed(0)}ms`)
  console.log(`${C.dim}    p50:             ${C.reset}${p50.toFixed(0)}ms`)
  console.log(`${C.dim}    p75:             ${C.reset}${p75.toFixed(0)}ms`)
  console.log(`${C.dim}    p90:             ${C.reset}${p90.toFixed(0)}ms`)
  console.log(`${C.dim}    p95:             ${C.reset}${p95.toFixed(0)}ms`)
  console.log(`${C.dim}    p99:             ${C.reset}${p99.toFixed(0)}ms`)
  console.log(`${C.dim}    max:             ${C.reset}${max.toFixed(0)}ms`)
  console.log()

  // ── Per-scenario query budget ──────────────────────────────────────────────
  const BUDGETS = {
    dashboard_drivers: 200, dashboard_vehicles: 150, dashboard_orders: 300,
    dashboard_payroll: 250, dashboard_violations: 150, dashboard_maintenance: 150,
    dashboard_applications: 100, dashboard_platforms: 100,
    payroll_drivers: 150, payroll_periods: 200, payroll_wps: 300,
    accounting_coa: 200, accounting_journal: 250, accounting_invoices: 250,
    accounting_parties: 200, accounting_vat: 200,
  }

  for (const [scName, scData] of Object.entries(scenarioStats)) {
    console.log(`${C.bold}  ${scName.toUpperCase()} Queries:${C.reset}`)
    for (const q of scData.queries) {
      const budget = BUDGETS[q.name] || 500
      const status = q.error === "table_missing"
        ? `${C.yellow}TABLE MISSING${C.reset}`
        : q.withinBudget
          ? `${C.green}OK${C.reset}`
          : `${C.red}OVER BUDGET${C.reset}`
      const ms = q.durationMs
      console.log(`${C.dim}    ${q.name.padEnd(30)}${C.reset} ${String(ms).padStart(5)}ms  ${C.dim}(budget: ${budget}ms)${C.reset}  ${status}`)
    }
    console.log()
  }

  // ── Thresholds ─────────────────────────────────────────────────────────────
  console.log(`${C.bold}  Thresholds:${C.reset}`)
  const checks = [
    ["p95 < 3000ms", p95 < 3000],
    ["p99 < 6000ms", p99 < 6000],
    ["Error rate < 1%", failures.length / results.length < 0.01],
    ["RPS > 1", rps > 1],
  ]
  for (const [name, ok] of checks) {
    console.log(`    ${ok ? C.green + "✓" : C.red + "✗"}${C.reset} ${name}`)
  }
  console.log()
  console.log(`${C.bold}${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`)

  // Exit code
  const allPassed = p95 < 3000 && p99 < 6000 && failures.length / results.length < 0.01
  process.exit(allPassed ? 0 : 1)
}

main().catch((e) => {
  console.error(`${C.red}Fatal error: ${e.message}${C.reset}`)
  process.exit(1)
})
