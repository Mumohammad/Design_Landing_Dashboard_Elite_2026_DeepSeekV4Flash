/**
 * k6 Load Test — All Scenarios Combined
 *
 * Tests: GET /api/load-test?scenario=all
 *
 * This simulates real production traffic: dashboard, payroll, and accounting
 * queries running simultaneously from different user sessions.
 *
 * Stages:
 *   1. Warm-up:     10 VUs × 30s
 *   2. Ramp-up:     10→50 VUs × 60s
 *   3. Steady:      50 VUs × 120s
 *   4. Peak:        50→100 VUs × 60s
 *   5. Sustained:   100 VUs × 120s
 *   6. Stress:      100→150 VUs × 60s
 *   7. Cool-down:   150→0 VUs × 30s
 *
 * Usage:
 *   k6 run loadtest/all.js
 *   k6 run --env BASE_URL=https://your-staging.vercel.app loadtest/all.js
 */

import http from "k6/http"
import { check, sleep } from "k6"
import { Rate, Trend, Counter } from "k6/metrics"

const errorRate = new Rate("errors")
const totalDuration = new Trend("total_duration", true)
const budgetExceeded = new Counter("budget_exceeded")
const dashboardDuration = new Trend("scenario_dashboard", true)
const payrollDuration = new Trend("scenario_payroll", true)
const accountingDuration = new Trend("scenario_accounting", true)

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000"
const LOAD_TEST_SECRET = __ENV.LOAD_TEST_SECRET || ""

export const options = {
  stages: [
    { duration: "30s", target: 10 },   // warm-up
    { duration: "60s", target: 50 },   // ramp-up
    { duration: "120s", target: 50 },  // steady state
    { duration: "60s", target: 100 },  // peak
    { duration: "120s", target: 100 }, // sustained peak
    { duration: "60s", target: 150 },  // stress
    { duration: "30s", target: 0 },    // cool-down
  ],

  thresholds: {
    http_req_duration: [
      "p(95)<3000",
      "p(99)<6000",
    ],
    errors: ["rate<0.01"],
    scenario_dashboard: ["p(95)<2000"],
    scenario_payroll: ["p(95)<3000"],
    scenario_accounting: ["p(95)<3000"],
  },
}

function headers() {
  const h = { "Content-Type": "application/json" }
  if (LOAD_TEST_SECRET) h["Authorization"] = `Bearer ${LOAD_TEST_SECRET}`
  return h
}

const SCENARIOS = ["dashboard", "payroll", "accounting"]

export default function () {
  // Each VU randomly picks a scenario (simulating real user distribution)
  const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)]
  const url = `${BASE_URL}/api/load-test?scenario=${scenario}`

  const res = http.get(url, { headers: headers(), timeout: "30s" })

  totalDuration.add(res.timings.duration)

  // Track per-scenario duration
  const trendMap = { dashboard: dashboardDuration, payroll: payrollDuration, accounting: accountingDuration }
  trendMap[scenario]?.add(res.timings.duration)

  const httpOk = check(res, {
    "status 200": (r) => r.status === 200,
    "response time < 10s": (r) => r.timings.duration < 10000,
  })
  errorRate.add(!httpOk)

  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body)
      if (body.scenarios?.length > 0) {
        const s = body.scenarios.find((sc) => sc.scenario === scenario)
        if (s?.queries) {
          for (const q of s.queries) {
            if (!q.withinBudget && q.error !== "table_missing") {
              budgetExceeded.add(1)
            }
          }
          check(s, {
            [`${scenario}: within budget`]: (x) => x.summary.allWithinBudget,
          })
        }
      }
    } catch {
      errorRate.add(1)
    }
  }

  sleep(Math.random() * 2 + 0.5) // 0.5–2.5s think time
}

export function handleSummary(data) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  return {
    [`loadtest/results/all-${ts}.json`]: JSON.stringify(data, null, 2),
    stdout: formatSummary(data),
  }
}

function formatSummary(data) {
  const indent = " "
  const lines = [
    `${indent}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `${indent}  EliteDev Combined Load Test Results`,
    `${indent}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `${indent}`,
    `${indent}  Total Requests:    ${data.metrics.http_reqs?.values?.count ?? 0}`,
    `${indent}  Failed Requests:   ${data.metrics.http_req_failed?.values?.count ?? 0}`,
    `${indent}  Error Rate:        ${((data.metrics.errors?.values?.rate ?? 0) * 100).toFixed(2)}%`,
    `${indent}`,
    `${indent}  Response Times (all):`,
    `${indent}    Avg:             ${data.metrics.http_req_duration?.values?.avg?.toFixed(0) ?? 0}ms`,
    `${indent}    p50:             ${data.metrics.http_req_duration?.values?.["p(50)"]?.toFixed(0) ?? 0}ms`,
    `${indent}    p95:             ${data.metrics.http_req_duration?.values?.["p(95)"]?.toFixed(0) ?? 0}ms`,
    `${indent}    p99:             ${data.metrics.http_req_duration?.values?.["p(99)"]?.toFixed(0) ?? 0}ms`,
    `${indent}    max:             ${data.metrics.http_req_duration?.values?.max?.toFixed(0) ?? 0}ms`,
    `${indent}`,
    `${indent}  Per-Scenario p95:`,
    `${indent}    Dashboard:       ${data.metrics.scenario_dashboard?.values?.["p(95)"]?.toFixed(0) ?? "N/A"}ms`,
    `${indent}    Payroll:         ${data.metrics.scenario_payroll?.values?.["p(95)"]?.toFixed(0) ?? "N/A"}ms`,
    `${indent}    Accounting:      ${data.metrics.scenario_accounting?.values?.["p(95)"]?.toFixed(0) ?? "N/A"}ms`,
    `${indent}`,
    `${indent}  Budget Exceeded:   ${data.metrics.budget_exceeded?.values?.count ?? 0}`,
    `${indent}`,
    `${indent}  Thresholds:`,
  ]

  for (const [name, threshold] of Object.entries(data.thresholds || {})) {
    const passed = threshold.ok ? "✅" : "❌"
    lines.push(`${indent}    ${passed} ${name}`)
  }

  lines.push(`${indent}`)
  lines.push(`${indent}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  return lines.join("\n")
}
