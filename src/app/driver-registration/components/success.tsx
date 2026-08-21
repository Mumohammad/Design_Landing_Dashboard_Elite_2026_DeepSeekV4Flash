"use client"

import * as React from "react"
import Link from "next/link"
import QRCode from "qrcode"
import { Check, Copy, Download, Printer, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LogoMark } from "@/components/logo"
import { useDriverRegistration } from "@/contexts/driver-registration-context"

const PRINT_ONLY = "print-only"

export function SuccessScreen({
  applicationNumber,
  statusToken,
  applicantName,
}: {
  applicationNumber: string
  statusToken: string
  applicantName: string
}) {
  const { dict, locale } = useDriverRegistration()
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)

  const [origin, setOrigin] = React.useState("")
  React.useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const statusUrl = `${origin}/driver-application-status/${encodeURIComponent(statusToken)}`

  React.useEffect(() => {
    if (!origin) return
    let cancelled = false
    QRCode.toDataURL(statusUrl, {
      width: 240,
      margin: 1,
      color: { dark: "#071a33", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [statusUrl, origin])

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(applicationNumber)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  const handlePrint = () => {
    // Print-confirmation: the A4 confirmation card is rendered when printing.
    window.print()
  }

  const today = new Date().toLocaleDateString(locale === "ar" ? "ar-SA" : locale === "ur" ? "ur-PK" : locale === "bn" ? "bn-BD" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  return (
    <div className="min-h-screen bg-background">
      {/* Screen content */}
      <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center">
        {/* Animated checkmark */}
        <div className="relative">
          <div className="absolute inset-0 -m-4 rounded-full bg-emerald-500/20 blur-2xl" aria-hidden />
          <MotionCheck />
        </div>

        <h1 className="mt-8 text-3xl font-extrabold tracking-tight text-foreground">{dict.success.heading}</h1>
        <p className="mt-2 text-muted-foreground">{dict.success.message}</p>

        <div className="mt-8 w-full rounded-2xl border border-border bg-card/70 p-6 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {dict.success.applicationNumber}
          </p>
          <div className="mt-2 flex items-center justify-center gap-2">
            <p className="font-mono text-2xl font-extrabold tracking-wide text-foreground">{applicationNumber}</p>
            <button
              type="button"
              onClick={() => void copyNumber()}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={dict.success.copy}
            >
              {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{copied ? dict.success.copied : dict.success.note}</p>

          <div className="mt-4 flex items-center justify-center gap-2 border-t border-border/60 pt-4">
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
              {dict.success.status}: {dict.success.statusValue}
            </span>
          </div>

          {/* QR */}
          <div className="mt-5 flex flex-col items-center">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- QR data URL
              <img src={qrDataUrl} alt="Application status QR" className="h-28 w-28 rounded-xl border border-border bg-white" />
            ) : (
              <div className="h-28 w-28 animate-pulse rounded-xl border border-border bg-muted" />
            )}
            <p className="mt-2 max-w-60 text-[11px] leading-relaxed text-muted-foreground">
              {dict.print.status} · /driver-application-status/{encodeURIComponent(statusToken)}
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button
            onClick={() => void copyNumber()}
            variant="outline"
            className="h-11 rounded-xl px-6"
          >
            <Copy className="h-4 w-4" /> {copied ? dict.success.copied : dict.success.copy}
          </Button>
          <Button onClick={handlePrint} variant="outline" className="h-11 rounded-xl px-6">
            <Printer className="h-4 w-4" /> {dict.success.print}
          </Button>
          <Button onClick={handlePrint} variant="outline" className="h-11 rounded-xl px-6">
            <Download className="h-4 w-4" /> {dict.success.downloadPdf}
          </Button>
          <Button
            asChild
            className="h-11 rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 px-6 text-white shadow-lg shadow-elite-blue-500/25"
          >
            <Link href="/landing">
              <RotateCcw className="h-4 w-4 rtl:-scale-x-100" /> {dict.success.returnHome}
            </Link>
          </Button>
        </div>

        <p className="mt-8 max-w-md text-sm leading-relaxed text-muted-foreground">{dict.success.whatNext}</p>
      </div>

      {/* ═══ A4 print confirmation (hidden on screen, shown on print) ═══ */}
      <div className={`${PRINT_ONLY} a4-sheet`}>
        <div className="flex items-center justify-between border-b-2 border-elite-blue-500 pb-4">
          <div className="flex items-center gap-3">
            <LogoMark size={44} />
            <div>
              <p className="text-base font-extrabold text-foreground">{dict.header.brand}</p>
              <p className="text-xs text-muted-foreground">{dict.header.tagline}</p>
            </div>
          </div>
          <p className="text-xs font-semibold text-muted-foreground">{today}</p>
        </div>

        <h2 className="mt-6 text-center text-2xl font-extrabold text-foreground">{dict.print.title}</h2>
        <p className="mt-1 text-center text-sm text-muted-foreground">{dict.success.statusValue}</p>

        <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <dt className="text-xs font-semibold text-muted-foreground">{dict.print.applicant}</dt>
            <dd className="text-sm font-bold text-foreground">{applicantName}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted-foreground">{dict.success.applicationNumber}</dt>
            <dd className="font-mono text-sm font-bold text-foreground">{applicationNumber}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted-foreground">{dict.success.status}</dt>
            <dd className="text-sm font-bold text-foreground">{dict.success.statusValue}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted-foreground">{dict.success.submittedDate}</dt>
            <dd className="text-sm font-bold text-foreground">{today}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted-foreground">{dict.success.documentCompletion}</dt>
            <dd className="text-sm font-bold text-foreground">✓ ✓ ✓ ✓</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted-foreground">QR</dt>
            <dd>
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- QR data URL
                <img src={qrDataUrl} alt="QR" className="mt-1 h-24 w-24 rounded border border-border bg-white" />
              ) : null}
            </dd>
          </div>
        </dl>

        <p className="mt-10 border-t border-border pt-4 text-center text-[11px] text-muted-foreground">
          {dict.footer.rights.replace("{year}", String(new Date().getFullYear()))}
        </p>
      </div>
    </div>
  )
}

function MotionCheck() {
  const [show, setShow] = React.useState(false)
  React.useEffect(() => {
    const t = setTimeout(() => setShow(true), 80)
    return () => clearTimeout(t)
  }, [])
  return (
    <div
      className={`flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 shadow-xl shadow-emerald-500/30 transition-all duration-500 ${
        show ? "scale-100 opacity-100" : "scale-50 opacity-0"
      }`}
    >
      <Check className="h-10 w-10 text-white" strokeWidth={3} />
    </div>
  )
}
