import { collectRows } from "@/lib/reports/collect-rows"

type Query = ReturnType<Parameters<typeof collectRows>[0]>

/** Preserve query inference while treating a partial collection as unavailable. */
export async function readCompleteRows<Q extends Query>(build: () => Q): Promise<{
  data: Awaited<Q>["data"]
  error: { message: string } | null
}> {
  try {
    return { data: await collectRows(build) as Awaited<Q>["data"], error: null }
  } catch {
    return { data: null as Awaited<Q>["data"], error: { message: "Complete dashboard data is unavailable." } }
  }
}
