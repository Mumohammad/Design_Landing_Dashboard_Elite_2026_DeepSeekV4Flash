export function minorUnits(value) {
  const text = String(value)
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw Error('Exact two-decimal money required')
  const negative = text.startsWith('-'), [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.')
  const units = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return negative ? -units : units
}
export function balancedLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) throw Error('Complete journal lines required')
  const totals = new Map(); let debit = 0n, credit = 0n
  for (const line of lines) {
    if (!line.account_id) throw Error('Journal account required')
    const d = minorUnits(line.debit_amount), c = minorUnits(line.credit_amount)
    if (d < 0n || c < 0n || (d > 0n && c > 0n) || (d === 0n && c === 0n)) throw Error('Invalid journal line amounts')
    const current = totals.get(line.account_id) ?? [0n, 0n]
    totals.set(line.account_id, [current[0] + d, current[1] + c]); debit += d; credit += c
  }
  if (debit <= 0n || debit !== credit) throw Error('Journal must balance exactly')
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([id, amounts]) => [id, ...amounts.map(String)])
}
export function assertCounterEntry(original, reversal) {
  const expected = balancedLines(original).map(([id, debit, credit]) => [id, credit, debit])
  if (JSON.stringify(balancedLines(reversal)) !== JSON.stringify(expected)) throw Error('Reversal differs from exact original counter-entry')
}
export function parseVatCsv(text) {
  // All fields in these two fixed VAT contracts are numeric or allowlisted
  // period/status/nature strings. Quoted or multiline fields are unexpected.
  const lines = text.replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/)
  if (lines.length < 2 || lines.some(line => line.includes('"'))) throw Error('Complete unquoted VAT contract required')
  const headers = lines.shift().split(',')
  if (new Set(headers).size !== headers.length) throw Error('Duplicate VAT columns')
  return lines.map(line => {
    const cells = line.split(',')
    if (cells.length !== headers.length) throw Error('Incomplete VAT CSV row')
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]]))
  })
}
