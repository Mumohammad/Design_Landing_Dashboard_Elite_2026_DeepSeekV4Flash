/**
 * k6 Load Test — Payroll Queries
 *
 * Tests: GET /api/load-test?scenario=payroll
 *
 * Stages:
 *   1. Warm-up:     5 VUs × 20s
 *   2. Ramp-up:     5→30 VUs × 45s
 *   3. Steady:      30 VUs × 90s
 *   4. Peak:        30→60 VUs × 45s
 *   5. Sustained:   60 VUs × 90s
 *   6. Cool-down:   60→0 VUs × 20s
 *
 * Payroll queries involve more complex aggregations and joins, so VU counts
 * are lower than the dashboard test. The payroll calculate action (POST) is
 * also profiled via a separate scenario.
 *
 * Success criteria:
 *   - p95 response time < 3000ms
 *   - p99 response time < 6000ms
 *   - Error rate < 1%
 *
 * Usage:
 *   k6 run loadtest/payroll.js
 *   k6 run --env BASE_URL=https://your-staging.vercel.app loadtest/payroll.js
 */

import http from "k6/http"
import { check, sleep } from "k6"
import { Rate, Trend, Counter } from "k6/metrics"

// ── Custom metrics ───────────────────────────────────────────────────────────
const errorRate = new Rate("errors")
const payrollDuration = new Trend("payroll_duration", true)
const queryBudgetExceeded = new Counter("query_budget_exceeded")

// ── Configuration ────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000"
const LOAD_TEST_SECRET = __ENV.LOAD_TEST_SECRET || ""

export const options = {
  stages: [
    { duration: "20s", target: 5 },    // warm-up
    { duration: "45s", target: 30 },   // ramp-up
    { duration: "90s", target: 30 },   // steady state
    { duration: "45s", target: 60 },   // peak
    { duration: "90s", target: 60 },   // sustained peak
    { duration: "20s", target: 0 },    // cool-down
  ],

  thresholds: {
    http_req_duration: [
      "p(95)<3000",  // 95% of requests under 3s
      "p(99)<6000",  // 99% of requests under 6s
    ],
    errors: ["rate<0.01"],
    payroll_duration: ["p(95)<3000"],
  },
}

// ── Request headers ──────────────────────────────────────────────────────────
function headers() {
  const h = { "Content-Type": "application/json" }
  if (LOAD_TEST_SECRET) {
    h["Authorization"] = `Bearer ${LOAD_TEST_SECRET}`
  }
  return h
}

// ── Main test function ───────────────────────────────────────────────────────
export default function () {
  const url = `${BASE_URL}/api/load-test?scenario=payroll`
  const res = http.get(url, { headers: headers(), timeout: "30s" })

  payrollDuration.add(res.timings.duration)

  const httpOk = check(res, {
    "payroll: status 200": (r) => r.status === 200,
    "payroll: response time < 8s": (r) => r.timings.duration < 8000,
  })
  errorRate.add(!httpOk)

  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body)

      check(body, {
        "payroll: has scenarios array": (b) => Array.isArray(b.scenarios),
      })

      if (body.scenarios?.length > 0) {
        const payrollScenario = body.scenarios.find((s) => s.scenario === "payroll")
        if (payrollScenario?.queries) {
          for (const q of payrollScenario.queries) {
            if (!q.withinBudget && q.error !== "table_missing") {
              queryBudgetExceeded.add(1)
              console.warn(`⚠️  ${q.name}: ${q.durationMs}ms (budget: ${q.budget}ms)`)
            }
          }

          check(payrollScenario, {
            "payroll: all queries within budget": (s) => s.summary.allWithinBudget,
            "payroll: total time < 5s": (s) => s.summary.totalMs < 5000,
          })
        }
      }
    } catch (e) {
      console.error(`JSON parse error: ${e}`)
      errorRate.add(1)
    }
  }

  sleep(1)
}

// ── Summary handler ──────────────────────────────────────────────────────────
export function handleSummary(data) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  return {
    [`loadtest/results/payroll-${ts}.json`]: JSON.stringify(data, null, 2),
    stdout: formatSummary(data),
  }
}

function formatSummary(data) {
  const indent = " "
  const lines = [
    `${indent}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `${indent}  EliteDev Payroll Load Test Results`,
    `${indent}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `${indent}`,
    `${indent}  Total Requests:    ${data.metrics.http_reqs?.values?.count ?? 0}`,
    `${indent}  Failed Requests:   ${data.metrics.http_req_failed?.values?.count ?? 0}`,
    `${indent}  Error Rate:        ${((data.metrics.errors?.values?.rate ?? 0) * 100).toFixed(2)}%`,
    `${indent}`,
    `${indent}  Response Times:`,
    `${indent}    Avg:             ${data.metrics.http_req_duration?.values?.avg?.toFixed(0) ?? 0}ms`,
    `${indent}    p50:             ${data.metrics.http_req_duration?.values?.["p(50)"]?.toFixed(0) ?? 0}ms`,
    `${indent}    p95:             ${data.metrics.http_req_duration?.values?.["p(95)"]?.toFixed(0) ?? 0}ms`,
    `${indent}    p99:             ${data.metrics.http_req_duration?.values?.["p(99)"]?.toFixed(0) ?? 0}ms`,
    `${indent}    max:             ${data.metrics.http_req_duration?.values?.max?.toFixed(0) ?? 0}ms`,
    `${indent}`,
    `${indent}  Payroll Query Budget:`,
    `${indent}    Budget exceeded: ${data.metrics.query_budget_exceeded?.values?.count ?? 0}`,
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
