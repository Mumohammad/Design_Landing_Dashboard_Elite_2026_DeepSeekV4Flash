import { spawnSync } from "node:child_process"

// Only the disposable local CLI stack supplies these credentials. Never load
// a hosted project's environment or print the status response into CI logs.
const status = spawnSync("supabase", ["status", "--output", "json"], { encoding: "utf8" })
if (status.status !== 0) throw new Error("Local Supabase stack is unavailable")
const config = JSON.parse(status.stdout)
if (!config.API_URL || !config.ANON_KEY || !config.SERVICE_ROLE_KEY) throw new Error("Local integration configuration is incomplete")
const url = new URL(config.API_URL)
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "58321") {
  throw new Error("Integration tests require the isolated release database")
}
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.storage-integration.config.mts", "--configLoader", "native"], {
  stdio: "inherit",
  env: {
    ...process.env,
    SUPABASE_INTEGRATION_URL: config.API_URL,
    SUPABASE_INTEGRATION_ANON_KEY: config.ANON_KEY,
    SUPABASE_INTEGRATION_SERVICE_ROLE_KEY: config.SERVICE_ROLE_KEY,
  },
})
process.exit(result.status ?? 1)
