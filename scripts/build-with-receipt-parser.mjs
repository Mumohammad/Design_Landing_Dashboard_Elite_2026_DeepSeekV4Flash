// Use the same Node executable without depending on the operator's script shell
// (Windows PowerShell 5 does not support &&). Never trace a failed build.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
for (const args of [
  [require.resolve('next/dist/bin/next'), 'build'],
  ['scripts/trace-receipt-parser.mjs'],
  ['scripts/verify-receipt-parser-bundle.mjs'],
]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true })
  if (result.error || result.signal || result.status !== 0) process.exit(result.status || 1)
}
