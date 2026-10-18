type ReportRow = Record<string, unknown>
type ReadResult = {
  data: unknown[] | null
  error: { message: string } | null
  count: number | null
}
type ReportQuery = PromiseLike<ReadResult> & {
  range: (from: number, to: number) => PromiseLike<ReadResult>
}

const BATCH_SIZE = 500
const MAX_ROWS = 100_000

/** Read a deterministic, uniquely ordered query with an exact count.
 * Never turn a failed or truncated database response into a completed export.
 * A fresh builder is required: PostgREST builders mutate their URL in place.
 */
export async function collectRows(buildQuery: () => ReportQuery): Promise<ReportRow[]> {
  const rows: ReportRow[] = []
  const ids = new Set<unknown>()
  let expectedCount: number | undefined
  do {
    const { data, error, count } = await buildQuery().range(rows.length, rows.length + BATCH_SIZE - 1)
    if (error || !data || count === null) {
      throw new Error("Could not read report data. Retry the report; no partial file was generated.")
    }
    if (count > MAX_ROWS) {
      throw new Error("This report exceeds 100,000 rows. Choose a smaller reporting period.")
    }
    if (expectedCount !== undefined && count !== expectedCount) {
      throw new Error("Report data changed during generation. Retry to export a consistent result.")
    }
    expectedCount = count
    if ((data.length === 0 && rows.length < count) || rows.length + data.length > count) {
      throw new Error("The database returned an incomplete report. Retry; no partial file was generated.")
    }
    for (const value of data) {
      const row = value as ReportRow | null
      if (!row || typeof row !== "object" || typeof row.id !== "string" || ids.has(row.id)) {
        throw new Error("Report data changed during generation. Retry to export a consistent result.")
      }
      ids.add(row.id)
      rows.push(row)
    }
  } while (rows.length < expectedCount)
  return rows
}
