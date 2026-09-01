import { redirect } from "next/navigation"

// Template demo route retired — redirect to the real dashboard.
export default function Page() {
  redirect("/dashboard")
}
