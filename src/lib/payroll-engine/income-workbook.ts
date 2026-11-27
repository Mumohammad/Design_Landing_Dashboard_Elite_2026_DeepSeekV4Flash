import * as XLSX from "xlsx"

export interface IncomeSheet { name: string; headers: string[]; rows: Record<string, unknown>[] }

export function readIncomeWorkbook(bytes: ArrayBuffer | Uint8Array, fileName: string): IncomeSheet[] {
  // Preserve text-file cells until the user maps columns to IDs and amounts.
  const csv = /\.csv$/i.test(fileName)
  const workbook = XLSX.read(bytes, { type: "array", raw: true, ...(csv ? { codepage: 65001 } : {}) })
  return workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name]
    // Excel can store rider ID 00012 as the number 12 with a zero-padding mask.
    // Only use display text if its digits represent exactly the stored value.
    if (!csv) {
      for (const cell of Object.values(sheet)) {
        if (cell?.t === "n" && /^0\d+$/.test(cell.w ?? "") && Number(cell.w) === cell.v) {
          cell.t = "s"
          cell.v = cell.w
        }
      }
    }
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, blankrows: false })
    const headers = [...new Set(rows.flatMap(r => Object.keys(r)))]
    return { name, headers, rows }
  }).filter(sheet => sheet.rows.length > 0)
}
