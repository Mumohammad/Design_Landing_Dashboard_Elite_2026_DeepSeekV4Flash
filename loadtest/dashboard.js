/**
 * k6 Load Test — Dashboard Queries
 *
 * Tests: GET /api/load-test?scenario=dashboard
 *
 * Stages:
 *   1. Warm-up:     10 VUs × 30s
 *   2. Ramp-up:     10→50 VUs × 60s
 *   3. Steady:      50 VUs × 120s
 *   4. Peak:        50→100 VUs × 60s
 *   5. Sustained:   100 VUs × 120s
 *   6. Cool-down:   100→0 VUs × 30s
 *
 * Success criteria:
 *   - p95 response time < 2000ms
 *   - p99 response time < 5000ms
 *   - Error rate < 1%
 *   - No query exceeds its latency budget
 *
 * Usage:
 *   k6 run loadtest/dashboard.js
 *   k6 run --env BASE_URL=https://your-staging.vercel.app loadtest/dashboard.js
 */

import http from "k6/http"
import { check, sleep } from "k6"
import { Rate, Trend, Counter } from "k6/metrics"

// ── Custom metrics ───────────────────────────────────────────────────────────
const errorRate = new Rate("errors")
const dashboardDuration = new Trend("dashboard_duration", true)
const queryBudgetExceeded = new Counter("query_budget_exceeded")

// ── Configuration ────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000"
const LOAD_TEST_SECRET = __ENV.LOAD_TEST_SECRET || ""

export const options = {
  stages: [
    { duration: "30s", target: 10 },   // warm-up
    { duration: "60s", target: 50 },   // ramp-up
    { duration: "120s", target: 50 },  // steady state
    { duration: "60s", target: 100 },  // peak
    { duration: "120s", target: 100 }, // sustained peak
    { duration: "30s", target: 0 },    // cool-down
  ],

  thresholds: {
    http_req_duration: [
      "p(95)<2000",  // 95% of requests under 2s
      "p(99)<5000",  // 99% of requests under 5s
    ],
    errors: ["rate<0.01"],          // error rate under 1%
    dashboard_duration: ["p(95)<2000"],
  },
}

// ── Request headers ──────────────────────────────────────────────────────────
function headers() {
  const h = {
    "Content-Type": "application/json",
  }
  if (LOAD_TEST_SECRET) {
    h["Authorization"] = `Bearer ${LOAD_TEST_SECRET}`
  }
  return h
}

// ── Main test function ───────────────────────────────────────────────────────
export default function () {
  const url = `${BASE_URL}/api/load-test?scenario=dashboard`
  const res = http.get(url, { headers: headers(), timeout: "30s" })

  dashboardDuration.add(res.timings.duration)

  // ── HTTP-level checks ────────────────────────────────────────────────────
  const httpOk = check(res, {
    "dashboard: status 200": (r) => r.status === 200,
    "dashboard: response time < 5s": (r) => r.timings.duration < 5000,
  })
  errorRate.add(!httpOk)

  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body)

      // ── Response structure checks ─────────────────────────────────────────
      check(body, {
        "dashboard: has scenarios array": (b) => Array.isArray(b.scenarios),
        "dashboard: has totalMs": (b) => typeof b.totalMs === "number",
      })

      // ── Query budget checks ───────────────────────────────────────────────
      if (body.scenarios?.length > 0) {
        const dashScenario = body.scenarios.find((s) => s.scenario === "dashboard")
        if (dashScenario?.queries) {
          for (const q of dashScenario.queries) {
            if (!q.withinBudget && q.error !== "table_missing") {
              queryBudgetExceeded.add(1)
              console.warn(`⚠️  ${q.name}: ${q.durationMs}ms (budget: ${q.budget}ms)`)
            }
          }

          check(dashScenario, {
            "dashboard: all queries within budget": (s) => s.summary.allWithinBudget,
            "dashboard: total time < 3s": (s) => s.summary.totalMs < 3000,
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
    [`loadtest/results/dashboard-${ts}.json`]: JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  }
}

function textSummary(data, opts) {
  const indent = opts?.indent || ""
  const lines = [
    `${indent}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `${indent}  EliteDev Dashboard Load Test Results`,
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
    `${indent}  Dashboard Query Budget:`,
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
