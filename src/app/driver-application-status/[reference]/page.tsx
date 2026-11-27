import type { Metadata } from "next"
import Link from "next/link"
import { CheckCircle2, Clock, XCircle } from "lucide-react"
import { LogoMark } from "@/components/logo"
import { getApplicationStatus } from "@/lib/driver-registration/actions"

export const metadata: Metadata = {
  title: "Application Status | Elite Development",
  description: "Check the status of your Elite Development driver application.",
  robots: { index: false, follow: false },
}

const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  under_review: "Under Review",
  approved: "Approved",
  rejected: "Rejected",
}

export default async function ApplicationStatusPage({
  params,
}: {
  params: Promise<{ reference: string }>
}) {
  const { reference } = await params
  const decoded = decodeURIComponent(reference)
  const result = await getApplicationStatus(decoded)

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <LogoMark size={38} />
          <div className="leading-tight">
            <p className="text-sm font-bold text-foreground">Elite Development</p>
            <p className="text-xs text-muted-foreground">Application Status</p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center px-4 py-14 text-center">
        {result.found ? (
          <div className="w-full rounded-lg border border-border bg-card p-6 sm:p-8">
            <div
              className={
                "mx-auto flex h-12 w-12 items-center justify-center " +
                (result.status === "approved"
                  ? "text-emerald-700 dark:text-emerald-300"
                  : result.status === "rejected"
                    ? "text-destructive"
                    : "text-muted-foreground")
              }
            >
              {result.status === "approved" ? (
                <CheckCircle2 className="h-8 w-8" />
              ) : result.status === "rejected" ? (
                <XCircle className="h-8 w-8" />
              ) : (
                <Clock className="h-8 w-8" />
              )}
            </div>

            <h1 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">
              {result.fullName}
            </h1>
            <p className="mt-1 font-mono text-sm font-semibold text-muted-foreground">
              {result.applicationNumber}
            </p>

            <span className={"mt-5 inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium " + (result.status === "approved" ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : result.status === "rejected" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {STATUS_LABELS[result.status ?? "submitted"] ?? "Submitted"}
            </span>

            {result.submittedAt && (
              <p className="mt-5 text-xs text-muted-foreground">
                Submitted · {new Date(result.submittedAt).toLocaleDateString()}
              </p>
            )}
          </div>
        ) : (
          <div className="w-full rounded-lg border border-border bg-card p-6 sm:p-8">
            <div className="mx-auto flex h-12 w-12 items-center justify-center text-destructive">
              <XCircle className="h-8 w-8" />
            </div>
            <h1 className="mt-5 text-xl font-semibold text-foreground">Application Not Found</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              No application matches the reference you provided. Check the number on your confirmation.
            </p>
          </div>
        )}

        <Link
          href="/driver-registration"
          className="mt-8 rounded-md border border-border px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
        >
          Apply as a Driver
        </Link>
      </main>
    </div>
  )
}
