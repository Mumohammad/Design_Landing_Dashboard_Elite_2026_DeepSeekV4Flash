import { friendlyError } from "@/lib/errors/friendly"

/** Bilingual message for driver workflow errors (see lib/errors/friendly). */
export function driverErrorMessage(error: string | undefined | null, isAr: boolean, fallback?: string): string {
  return friendlyError(error ?? "", isAr, fallback)
}
