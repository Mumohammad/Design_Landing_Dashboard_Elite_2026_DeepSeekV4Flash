import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Only emit known diagnostic categories/identifiers; never raw SQL or log text.
 * Startup output can contain local credentials or fixture values. */
export function classifySupabaseStartup(log) {
  const migrations = [...log.matchAll(/Applying migration (\d{3,14}_[a-z0-9_]+\.sql)/g)]
  const sqlStates = [...new Set([...log.matchAll(/\bSQLSTATE[:\s]+([A-Z0-9]{5})\b/g)].map(match => match[1]))].slice(0, 10)
  const indicators = [
    ['network-timeout', /TLS handshake timeout|i\/o timeout|context deadline exceeded|ETIMEDOUT/i],
    ['image-pull', /failed to pull|pull access denied|manifest unknown|toomanyrequests/i],
    ['disk-full', /no space left on device/i],
    ['docker-unavailable', /Cannot connect to the Docker daemon|docker daemon is not running/i],
    ['health-check', /unhealthy|health check failed|failed to become healthy/i],
    ['connection-refused', /connection refused|ECONNREFUSED/i],
    ['sql-error', /SQLSTATE|ERROR:/],
  ].filter(([, pattern]) => pattern.test(log)).map(([category]) => category)
  return { check: 'supabase-start-failure', lastMigration: migrations.at(-1)?.[1] ?? null, sqlStates, indicators }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.error(JSON.stringify(classifySupabaseStartup(readFileSync(process.argv[2], 'utf8')))) }
  catch { console.error(JSON.stringify({ check: 'supabase-start-failure', diagnostic: 'unavailable' })) }
}
