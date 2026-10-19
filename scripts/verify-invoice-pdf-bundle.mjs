import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'

const traceFile = resolve('.next/server/app/api/invoices/[id]/pdf/route.js.nft.json')
const trace = JSON.parse(readFileSync(traceFile, 'utf8'))
const files = new Set(trace.files.map(file => resolve(dirname(traceFile), file)))
const physicalFiles = new Set([...files].map(file => realpathSync(file)))
const required = [resolve('public/logo.png'), resolve('src/assets/fonts/cairo.woff2')]
for (const name of readdirSync('node_modules/@sparticuz/chromium/bin').filter(name => name.endsWith('.br'))) {
  required.push(resolve('node_modules/@sparticuz/chromium/bin', name))
}
for (const file of required) {
  if (!physicalFiles.has(realpathSync(file))) throw Error(`Required invoice PDF runtime asset missing: ${basename(file)}`)
}
if ([...files].some(file => dirname(file) === process.cwd() && basename(file).startsWith('.env'))) {
  throw Error('Unexpected environment file in invoice PDF trace')
}
const manifest = JSON.parse(readFileSync('src/assets/fonts/manifest.json', 'utf8'))
const font = manifest.fonts.find(font => font.directory === 'cairo')
if (createHash('sha256').update(readFileSync('src/assets/fonts/cairo.woff2')).digest('hex') !== font.output.sha256) throw Error('Invoice font integrity mismatch')
// Conservative sum also counts duplicate symlink entries that a deployer may
// deduplicate; keep below the standard bundle ceiling without beta overrides.
const bytes = [...files].reduce((sum, file) => sum + statSync(file).size, 0)
if (bytes > 250 * 1024 * 1024) throw Error('Invoice PDF runtime exceeds the standard function bundle budget')
console.log(`PASS: invoice PDF trace includes packaged Chromium, logo and verified Arabic font; no root environment files; conservative size ${Math.ceil(bytes / 1024 / 1024)} MiB`)
