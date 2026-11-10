// Cursor-based pagination utilities for Supabase queries.
//
// Replaces OFFSET-based pagination which degrades at scale (OFFSET 100000
// forces Postgres to scan and discard 100k rows). Cursor pagination uses
// `id > last_seen_id` which leverages the primary key index — constant-time
// regardless of page depth.
//
// Usage:
//   const result = await paginatedQuery(supabase, "drivers", {
//     tenantId: currentUser.tenantId,
//     pageSize: 25,
//     cursor: "abc-123",       // null for first page
//     orderColumn: "created_at",
//     select: "id,full_name_ar,status",
//     filters: { status: "active" },
//   })
//   // result: { data, nextCursor, totalEstimate, hasMore }

import type { SupabaseClient } from "@supabase/supabase-js"

// ── Types ────────────────────────────────────────────────────────────────────

export type CursorDirection = "forward" | "backward"

export interface PaginationParams {
  /** Page size (default 25, max 100). */
  pageSize?: number
  /** Cursor from previous page (null for first page). */
  cursor?: string | null
  /** Direction — default "forward". */
  direction?: CursorDirection
  /** Column to order by (default "created_at"). Must be indexed. */
  orderColumn?: string
  /** ASC or DESC (default DESC — newest first). */
  ascending?: boolean
}

export interface PaginatedResult<T> {
  /** Rows for this page. */
  data: T[]
  /** Cursor to pass as `cursor` for the next page. null if no more data. */
  nextCursor: string | null
  /** Cursor to pass as `cursor` for the previous page. null if at start. */
  prevCursor: string | null
  /** Whether there are more pages after this one. */
  hasMore: boolean
  /** Estimated total count (via count query). -1 if not requested. */
  totalEstimate: number
  /** Current page number (1-indexed). */
  page: number
  /** Page size used. */
  pageSize: number
}

export interface PaginatedQueryOptions extends PaginationParams {
  /** Tenant ID to filter by (mandatory for multi-tenant safety). */
  tenantId: string
  /** Columns to select. */
  select?: string
  /** Additional eq filters. */
  filters?: Record<string, string | number | boolean>
  /** Soft-delete column to exclude (default "deleted_at"). */
  softDeleteColumn?: string
  /** Whether to include total count (adds one extra query). Default true. */
  includeCount?: boolean
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 25

// ── Core pagination function ─────────────────────────────────────────────────

/**
 * Execute a cursor-based paginated query against a Supabase table.
 *
 * Uses `id > cursor` (or `id < cursor` for backward) with `ORDER BY id`
 * to leverage the primary key index. This gives O(log n) performance
 * regardless of page depth, unlike OFFSET which is O(n).
 *
 * @param supabase  Supabase client (admin or user-scoped)
 * @param table     Table name
 * @param options   Query options including tenantId, cursor, pageSize
 */
export async function paginatedQuery<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  table: string,
  options: PaginatedQueryOptions
): Promise<PaginatedResult<T>> {
  const {
    tenantId,
    pageSize: rawPageSize = DEFAULT_PAGE_SIZE,
    cursor = null,
    direction = "forward",
    orderColumn = "created_at",
    ascending = false,
    select = "*",
    filters = {},
    softDeleteColumn = "deleted_at",
    includeCount = true,
  } = options

  const pageSize = Math.min(Math.max(1, rawPageSize), MAX_PAGE_SIZE)
  const isForward = direction === "forward"

  // ── Build query ──────────────────────────────────────────────────────────

  let query = supabase
    .from(table)
    .select(select, { count: includeCount ? "exact" : undefined })

  // Tenant filter (mandatory)
  query = query.eq("tenant_id", tenantId)

  // Soft-delete filter
  if (softDeleteColumn) {
    query = query.is(softDeleteColumn, null)
  }

  // Additional filters
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value)
  }

  // Cursor filter: `id > cursor` (forward) or `id < cursor` (backward)
  if (cursor) {
    if (isForward) {
      query = query.gt("id", cursor)
    } else {
      query = query.lt("id", cursor)
    }
  }

  // Order: primary sort by `orderColumn`, secondary by `id` for stability
  query = query.order(orderColumn, { ascending })
  if (orderColumn !== "id") {
    query = query.order("id", { ascending })
  }

  // Fetch one extra row to determine `hasMore`
  query = query.limit(pageSize + 1)

  const { data, error, count } = await query

  if (error) {
    throw new Error(`Pagination query failed on ${table}: ${error.message}`)
  }

  const rows = (data ?? []) as unknown as T[]
  const hasMore = rows.length > pageSize
  const resultRows = hasMore ? rows.slice(0, pageSize) : rows

  // Extract cursors from the result
  const firstId = resultRows.length > 0 ? String((resultRows[0] as Record<string, unknown>).id) : null
  const lastId = resultRows.length > 0 ? String((resultRows[resultRows.length - 1] as Record<string, unknown>).id) : null

  // For cursor-based pagination, nextCursor is the last row's id (forward)
  // or the first row's id (backward). prevCursor is the opposite.
  let nextCursor: string | null = null
  let prevCursor: string | null = null

  if (isForward) {
    nextCursor = hasMore ? lastId : null
    prevCursor = cursor ?? null // Previous page exists if we had a cursor
  } else {
    // Backward: reverse the logic
    nextCursor = cursor ?? null
    prevCursor = hasMore ? firstId : null
  }

  // Page number estimation (approximate for cursor-based)
  const page = cursor ? -1 : 1 // Cannot reliably compute page number with cursors

  return {
    data: resultRows,
    nextCursor,
    prevCursor,
    hasMore,
    totalEstimate: count ?? -1,
    page,
    pageSize,
  }
}

// ── Offset-based pagination (fallback for legacy code) ───────────────────────

export interface OffsetPaginationParams {
  /** Page number (1-indexed). */
  page?: number
  /** Page size (default 25, max 100). */
  pageSize?: number
  /** Column to order by. */
  orderColumn?: string
  /** ASC or DESC. */
  ascending?: boolean
}

export interface OffsetPaginatedResult<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

/**
 * Offset-based pagination — use only when you need page numbers (e.g. "Page 3
 * of 12"). For large datasets prefer `paginatedQuery` which uses cursors.
 *
 * Adds `range((page-1)*pageSize, page*pageSize-1)` to the query.
 */
export async function offsetPaginatedQuery<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  table: string,
  options: PaginatedQueryOptions & OffsetPaginationParams
): Promise<OffsetPaginatedResult<T>> {
  const {
    tenantId,
    page: rawPage = 1,
    pageSize: rawPageSize = DEFAULT_PAGE_SIZE,
    orderColumn = "created_at",
    ascending = false,
    select = "*",
    filters = {},
    softDeleteColumn = "deleted_at",
  } = options

  const pageSize = Math.min(Math.max(1, rawPageSize), MAX_PAGE_SIZE)
  const page = Math.max(1, rawPage)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  // Count query
  let countQuery = supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)

  if (softDeleteColumn) countQuery = countQuery.is(softDeleteColumn, null)
  for (const [key, value] of Object.entries(filters)) {
    countQuery = countQuery.eq(key, value)
  }

  const { count } = await countQuery
  const total = count ?? 0
  const totalPages = Math.ceil(total / pageSize)

  // Data query
  let query = supabase
    .from(table)
    .select(select)
    .eq("tenant_id", tenantId)

  if (softDeleteColumn) query = query.is(softDeleteColumn, null)
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value)
  }

  query = query
    .order(orderColumn, { ascending })
    .range(from, to)

  const { data, error } = await query
  if (error) throw new Error(`Offset query failed on ${table}: ${error.message}`)

  return {
    data: (data ?? []) as unknown as T[],
    total,
    page,
    pageSize,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  }
}

// ── Infinite scroll helper ───────────────────────────────────────────────────

/**
 * Build a cursor-based pagination state for infinite scroll UIs.
 * Returns the current page data and a `loadMore` function.
 *
 * Usage in a React component:
 *   const { data, loadMore, hasMore, isLoading } = useInfiniteCursor(supabase, "drivers", { ... })
 */
export interface InfiniteCursorState<T> {
  /** All rows loaded so far (accumulated across pages). */
  rows: T[]
  /** Whether more data is available. */
  hasMore: boolean
  /** Current cursor for the next page. */
  cursor: string | null
  /** Whether a page is currently loading. */
  isLoading: boolean
  /** Total count estimate. */
  total: number
}

// ── Utility: count rows efficiently ──────────────────────────────────────────

/**
 * Efficient count query — uses head:true to avoid fetching data.
 * Returns just the count.
 */
export async function countRows(
  supabase: SupabaseClient,
  table: string,
  tenantId: string,
  filters?: Record<string, string | number | boolean>,
  softDeleteColumn = "deleted_at"
): Promise<number> {
  let query = supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)

  if (softDeleteColumn) query = query.is(softDeleteColumn, null)
  for (const [key, value] of Object.entries(filters ?? {})) {
    query = query.eq(key, value)
  }

  const { count } = await query
  return count ?? 0
}
