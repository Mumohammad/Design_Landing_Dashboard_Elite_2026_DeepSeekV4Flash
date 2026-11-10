import { redirect } from "next/navigation"
import { PasswordForm } from "@/components/auth/password-form"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUserForMfa } from "@/lib/auth/authorization"

export default async function ChangePasswordPage() {
  const identity = await getCurrentUserForMfa()
  if (!identity) redirect("/auth/sign-in")
  const client = await createClient()
  const { data, error } = await client.from("users").select("must_change_password")
    .eq("auth_user_id", identity.authUserId).is("deleted_at", null).single()
  if (error || !data) throw new Error("Password account unavailable")
  return <PasswordForm mode={data.must_change_password ? "required" : "account"} />
}
