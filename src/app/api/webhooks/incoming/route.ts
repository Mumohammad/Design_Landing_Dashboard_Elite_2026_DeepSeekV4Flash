import { NextResponse } from "next/server"
import { INTEGRATION_UNAVAILABLE } from "@/lib/release/integrations"

// No provider has a validated durable processor. Never acknowledge a payload
// as processed or accept its side effects until that implementation is released.
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: INTEGRATION_UNAVAILABLE }, { status: 503 })
}
