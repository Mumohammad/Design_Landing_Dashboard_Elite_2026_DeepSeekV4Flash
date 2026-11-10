import { redirect } from "next/navigation";

// Single entry point: the product flow starts at the bilingual landing page
// (/landing → registration → email confirmation → sign-in → /dashboard).
export default function HomePage() {
  redirect("/landing");
}
