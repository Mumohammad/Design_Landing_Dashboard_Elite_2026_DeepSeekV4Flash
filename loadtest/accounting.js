/**
 * k6 Load Test — Accounting Queries
 *
 * Tests: GET /api/load-test?scenario=accounting
 *
 * Stages:
 *   1. Warm-up:     5 VUs × 20s
 *   2. Ramp-up:     5→25 VUs × 45s
 *   3. Steady:      25 VUs × 90s
 *   4. Peak:        25→50 VUs × 45s
 *   5. Sustained:   50 VUs × 90s
 *   6. Cool-down:   50→0 VUs × 20s
 *
 * Success criteria:
 *   - p95 response time < 3000ms
 *   - p99 response time < 6000ms
 *   - Error rate < 1%
 *
 * Usage:
 *   k6 run loadtest/accounting.js
 *   k6 run --env BASE_URL=https://your-staging.vercel.app loadtest/accounting.js
 */

import http from "k6/http"
import { check, sleep } from "k6"
import { Rate, Trend, Counter } from "k6/metrics"

const errorRate = new Rate("errors")
const accountingDuration = new Trend("accounting_duration", true)
const queryBudgetExceeded = new Counter("query_budget_exceeded")

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000"
const LOAD_TEST_SECRET = __ENV.LOAD_TEST_SECRET || ""

export const options = {
  stages: [
    { duration: "20s", target: 5 },
    { duration: "45s", target: 25 },
    { duration: "90s", target: 25 },
    { duration: "45s", target: 50 },
    { duration: "90s", target: 50 },
    { duration: "20s", target: 0 },
  ],

  thresholds: {
    http_req_duration: [
      "p(95)<3000",
      "p(99)<6000",
    ],
    errors: ["rate<0.01"],
    accounting_duration: ["p(95)<3000"],
  },
}

function headers() {
  const h = { "Content-Type": "application/json" }
  if (LOAD_TEST_SECRET) h["Authorization"] = `Bearer ${LOAD_TEST_SECRET}`
  return h
}

export default function () {
  const url = `${BASE_URL}/api/load-test?scenario=accounting`
  const res = http.get(url, { headers: headers(), timeout: "30s" })

  accountingDuration.add(res.timings.duration)

  const httpOk = check(res, {
    "accounting: status 200": (r) => r.status === 200,
    "accounting: response time < 8s": (r) => r.timings.duration < 8000,
  })
  errorRate.add(!httpOk)

  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body)

      if (body.scenarios?.length > 0) {
        const scenario = body.scenarios.find((s) => s.scenario === "accounting")
        if (scenario?.queries) {
          for (const q of scenario.queries) {
            if (!q.withinBudget && q.error !== "table_missing") {
              queryBudgetExceeded.add(1)
              console.warn(`⚠️  ${q.name}: ${q.durationMs}ms (budget: ${q.budget}ms)`)
            }
          }

          check(scenario, {
            "accounting: all queries within budget": (s) => s.summary.allWithinBudget,
            "accounting: total time < 5s": (s) => s.summary.totalMs < 5000,
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

export function handleSummary(data) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  return {
    [`loadtest/results/accounting-${ts}.json`]: JSON.stringify(data, null, 2),
    stdout: formatSummary(data),
  }
}

function formatSummary(data) {
  const indent = " "
  const lines = [
    `${indent}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `${indent}  EliteDev Accounting Load Test Results`,
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
    `${indent}  Accounting Query Budget:`,
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
