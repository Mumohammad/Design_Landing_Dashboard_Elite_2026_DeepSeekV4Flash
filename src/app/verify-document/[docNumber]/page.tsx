import { createAdminClient } from "@/lib/supabase/admin"
import { createHash } from "crypto"
import { LogoMark } from "@/components/logo"
import {
  BadgeCheck,
  FileQuestion,
  ShieldCheck,
  Timer,
} from "lucide-react"

// Public QR-verification page for generated documents.
//
// SECURITY (re-audit PUB-001 fix):
//   Uses the narrow public_verify_document() RPC instead of a full
//   service-role join. Returns only authenticity confirmation + minimal
//   non-PII metadata. No customer names, invoice totals, driver PII,
//   or vehicle details are exposed to public scanners.
//
//   The RPC is SECURITY DEFINER with fixed search_path, callable by anon.
//   Rate limiting should be added at the edge/CDN layer.

export const metadata = {
  title: "Document Verification | نخبة التطوير",
  robots: { index: false, follow: false },
}

type VerifyResult = {
  found: boolean
  doc_number?: string
  status?: string
  generated_at?: string
  template_name?: string
  verified?: boolean
  message?: string
}

async function verifyDocument(verifyToken: string): Promise<VerifyResult> {
  // Validate token format — reject non-hex early
  if (!/^[a-f0-9]{64}$/i.test(verifyToken)) {
    return { found: false, message: "Invalid verification token format." }
  }

  const tokenHash = createHash('sha256').update(verifyToken).digest('hex')

  // Use the narrow public RPC — no PII, no financial data, no join expansion.
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('public_verify_document', {
    p_token_hash: tokenHash,
  })

  if (error || !data) {
    return { found: false, message: "Verification service unavailable." }
  }

  return data as VerifyResult
}

function ResultCard({ result }: { result: VerifyResult }) {
  const valid = result.found && result.verified

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 px-4 py-10 dark:from-slate-950 dark:to-slate-900">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <LogoMark />
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xl shadow-slate-900/5 dark:shadow-black/30">
          {/* Status banner */}
          <div
            className={
              valid
                ? "bg-emerald-600 px-6 py-5 text-center"
                : "bg-red-600 px-6 py-5 text-center"
            }
          >
            {valid ? (
              <BadgeCheck className="mx-auto h-10 w-10 text-white" />
            ) : (
              <FileQuestion className="mx-auto h-10 w-10 text-white" />
            )}
            <h1 className="mt-2 text-lg font-extrabold text-white">
              {valid ? "Document Verified" : "Document Not Found"}
            </h1>
            <p className="mt-0.5 text-xs text-white/85">
              {valid
                ? "This document is genuine and was issued by the company"
                : result.message ?? "No matching document record exists — treat this copy with caution"}
            </p>
          </div>

          <div className="space-y-4 px-6 py-6">
            {/* Document number */}
            <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Document number
              </p>
              <p className="mt-0.5 font-mono text-base font-bold text-foreground" dir="ltr">
                {valid ? result.doc_number : "—"}
              </p>
            </div>

            {valid && (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <FileQuestion className="h-3 w-3" />
                    Type
                  </p>
                  <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
                    {result.template_name ?? "—"}
                  </p>
                </div>
                <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Timer className="h-3 w-3" />
                    Issued
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">
                    {result.generated_at ? new Date(result.generated_at).toLocaleDateString("en-GB") : "—"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer strip */}
        <div className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>
            Verified against the official document registry — نخبة التطوير
          </span>
        </div>
      </div>
    </div>
  )
}

export default async function VerifyDocumentPage({
  params,
}: {
  params: Promise<{ docNumber: string }>
}) {
  const { docNumber } = await params
  let decoded = docNumber
  try {
    decoded = decodeURIComponent(docNumber)
  } catch {
    decoded = docNumber
  }

  if (!/^[0-9a-f]{64}$/i.test(decoded)) {
    return <ResultCard result={{ found: false, message: "Invalid verification token format." }} />
  }

  const result = await verifyDocument(decoded)
  return <ResultCard result={result} />
}
