// Offline provenance check only. Never connects, migrates or repairs history.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const directory = new URL('../supabase/history/staging/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json',directory),'utf8'))
if (manifest.project_ref !== 'viowrovartosrkqukjxy' || manifest.active_migrations !== true ||
    manifest.migrations.length !== 8 || new Set(manifest.migrations.map(row => row.version)).size !== 8) {
  throw new Error('Unexpected historical migration manifest')
}
for (const row of manifest.migrations) {
  if (!/^\d{14}$/.test(row.version) || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error('Invalid history metadata')
  const sql = readFileSync(new URL(`../../migrations/${row.version}_${row.name}.sql`,directory),'utf8')
    .replace(/\r\n/g,'\n').replace(/[\r\n]+$/,'')
  if (createHash('sha256').update(sql,'utf8').digest('hex') !== row.sha256) {
    throw new Error(`Retained SQL differs from staging history: ${row.version}`)
  }
}
console.log('All 8 retained migration SQL hashes match the read-only staging snapshot; no history was changed')
