"use server"

// In-app notification center feed. Read through the caller's RLS client, so a
// user only ever sees alerts for rows their role can already read; a module the
// role cannot read (or a missing table) simply contributes no items.

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser } from "@/lib/auth/authorization"
import { businessDateKey } from "@/lib/formatting/business-date"
import { CACHE_TTL, cacheGet, cacheKey } from "@/lib/cache"
import { buildNotificationFeed, type NotificationFeed } from "./feed-utils"
import { loadTenantFeed } from "./feed-loader"
import { settingsFromRow } from "./digest-schema"

export async function getNotificationFeed(): Promise<NotificationFeed> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const currentUser = user ? await getCurrentUser() : null
  const todayIso = businessDateKey(new Date())
  if (!user || !currentUser) return buildNotificationFeed({ todayIso })
  const key = cacheKey("notifications", currentUser.tenantId, user.id, { todayIso })
  return cacheGet(key, async () => {
    // The tenant's alert horizon also drives the bell (categories stay all:
    // the bell is personal, the digest selection is for email only).
    const { data } = await createAdminClient()
      .from("notification_settings")
      .select("horizon_days")
      .eq("tenant_id", currentUser.tenantId)
      .maybeSingle()
      .then((r) => r, () => ({ data: null }))
    const horizonDays = settingsFromRow(data ? { ...settingsFromRow(null), ...data } : null).horizon_days
    return loadTenantFeed(supabase, currentUser.tenantId, todayIso, { mode: "user", horizonDays })
  }, CACHE_TTL.dashboard)
}
