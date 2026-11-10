/** Quote a literal substring for PostgREST's OR grammar and PostgreSQL LIKE.
 * Column names must be constants owned by the caller, never user input.
 */
export function substringFilter(columns: readonly string[], search: string): string {
  const literal = search.trim().slice(0, 200)
    .replace(/[\\%_]/g, "\\$&")
    .replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  return columns.map((column) => `${column}.ilike."%${literal}%"`).join(",")
}
