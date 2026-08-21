"use client"

import * as React from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, CheckCircle2, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDriverRegistration } from "@/contexts/driver-registration-context"
import {
  STEP_ORDER,
  type FullApplication,
  type StepKey,
} from "@/lib/driver-registration/schema"
import { submitDriverApplication } from "@/lib/driver-registration/actions"
import { RegistrationHeader } from "./fields"
import {
  ContactStep,
  DocumentsStep,
  IdentityStep,
  LicenseStep,
  PersonalStep,
  PlatformsStep,
  VehicleStep,
  WorkStep,
} from "./steps"
import { SuccessScreen } from "./success"

export interface PlatformOption {
  code: string
  label: string
  emoji?: string
}

// ── Progress journey rail ────────────────────────────────────────────────────
function ProgressRail({
  current,
  completed,
}: {
  current: StepKey
  completed: StepKey[]
}) {
  const { dict } = useDriverRegistration()
  const labels = STEP_ORDER.map((key) => ({
    key,
    label: dict.steps[key as keyof typeof dict.steps] as string,
  }))

  return (
    <ol className="space-y-1" aria-label={dict.progress.complete}>
      {labels.map((step, i) => {
        const isDone = completed.includes(step.key) || STEP_ORDER.indexOf(step.key) < STEP_ORDER.indexOf(current)
        const isCurrent = step.key === current
        return (
          <li key={step.key}>
            <div
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-200",
                isCurrent && "bg-elite-blue-500/10",
                isDone && !isCurrent && "opacity-80"
              )}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-300",
                  isDone && "border-emerald-500 bg-emerald-500 text-white",
                  isCurrent && "border-elite-blue-500 bg-elite-blue-500 text-white shadow-md shadow-elite-blue-500/30",
                  !isDone && !isCurrent && "border-muted-foreground/30 text-muted-foreground"
                )}
              >
                {isDone ? <Check className="h-3.5 w-3.5" /> : isCurrent ? <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-[13px] font-semibold transition-colors",
                  isCurrent ? "text-foreground" : isDone ? "text-muted-foreground" : "text-muted-foreground/60"
                )}
              >
                {step.label}
              </span>
              {isCurrent && <span className="ms-auto h-1.5 w-1.5 animate-pulse rounded-full bg-elite-blue-500" />}
            </div>
            {i < labels.length - 1 && (
              <div className="ms-6 h-4 w-px border-s border-dashed border-border/70" aria-hidden />
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ── Review panel ─────────────────────────────────────────────────────────────
function ReviewPanel({
  onEdit,
  consent,
  setConsent,
  onBack,
}: {
  onEdit: (key: StepKey) => void
  consent: { terms: boolean; privacy: boolean }
  setConsent: (c: { terms: boolean; privacy: boolean }) => void
  onBack: () => void
}) {
  const { dict, data, locale } = useDriverRegistration()
  const [phase, setPhase] = React.useState<"idle" | "validating" | "submitting" | "error">("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<{ applicationNumber: string; applicationId: string; statusToken: string } | null>(null)

  const fullName =
    data.personal
      ? `${data.personal.firstName} ${data.personal.middleName ?? ""} ${data.personal.lastName}`.replace(/\s+/g, " ")
      : "—"

  const sections: { key: StepKey; title: string; lines: [string, string][] }[] = []
  if (data.personal) {
    sections.push({
      key: "personal",
      title: dict.steps.personal,
      lines: [
        [dict.personal.fullName, fullName],
        [dict.personal.dateOfBirth, data.personal.dateOfBirth || "—"],
        [dict.personal.nationality, data.personal.nationality],
        [dict.personal.gender, data.personal.gender === "male" ? dict.personal.male : dict.personal.female],
      ],
    })
  }
  if (data.contact) {
    sections.push({
      key: "contact",
      title: dict.steps.contact,
      lines: [
        [dict.contact.mobile, data.contact.mobile],
        [dict.contact.email, data.contact.email || "—"],
        [dict.contact.city, data.contact.city],
        [dict.contact.district, `${data.contact.district} · ${data.contact.address}`],
      ],
    })
  }
  if (data.identity) {
    const typeLabel =
      data.identity.identityType === "iqama"
        ? dict.identity.iqama
        : data.identity.identityType === "national_id"
          ? dict.identity.nationalId
          : dict.identity.passport
    sections.push({
      key: "identity",
      title: dict.steps.identity,
      lines: [
        [dict.identity.type, typeLabel],
        [dict.identity.number, data.identity.identityNumber],
        ...(data.identity.identityExpiry ? [[dict.identity.expiry, data.identity.identityExpiry] as [string, string]] : []),
      ],
    })
  }
  if (data.license) {
    sections.push({
      key: "license",
      title: dict.steps.license,
      lines: [
        [dict.license.number, data.license.licenseNumber],
        [dict.license.type, data.license.licenseType],
        [dict.license.expiry, data.license.licenseExpiry],
      ],
    })
  }
  if (data.work) {
    const workLabel = data.work.workType === "full_time" ? dict.work.fullTime : dict.work.freelancer
    let categoryLabel = "—"
    if (data.work.driverCategory === "sponsored_type_1") categoryLabel = dict.work.sponsored1
    else if (data.work.driverCategory === "sponsored_type_2") categoryLabel = dict.work.sponsored2
    else categoryLabel = dict.work.freelancer
    sections.push({
      key: "work",
      title: dict.steps.work,
      lines: [
        [dict.work.heading, workLabel],
        [dict.work.categoryHeading, categoryLabel],
      ],
    })
  }
  if (data.platforms) {
    sections.push({
      key: "platforms",
      title: dict.steps.platforms,
      lines: [[dict.platforms.heading, data.platforms.platforms.length ? data.platforms.platforms.join(", ") : dict.platforms.none]],
    })
  }
  if (data.vehicle) {
    sections.push({
      key: "vehicle",
      title: dict.steps.vehicle,
      lines: [
        [dict.vehicle.haveVehicle, data.vehicle.hasVehicle ? dict.common.yes : dict.common.no],
        ...(data.vehicle.hasVehicle
          ? [
              [dict.vehicle.make, `${data.vehicle.make} ${data.vehicle.model}`] as [string, string],
              [dict.vehicle.plate, data.vehicle.plate ?? "—"] as [string, string],
            ]
          : []),
      ],
    })
  }

  const canSubmit = consent.terms && consent.privacy

  const onSubmit = async () => {
    if (!canSubmit) {
      setError(dict.review.consentRequired)
      return
    }
    if (!data.personal || !data.contact || !data.identity || !data.license || !data.work || !data.platforms || !data.vehicle || !data.documents) {
      setError(dict.common.errorGeneric)
      return
    }
    setPhase("validating")
    setError(null)
    await new Promise((r) => setTimeout(r, 700))
    setPhase("submitting")

    const payload: FullApplication = {
      locale,
      personal: data.personal,
      contact: data.contact,
      identity: data.identity,
      license: data.license,
      work: data.work,
      platforms: data.platforms,
      vehicle: data.vehicle,
      documents: data.documents,
      consent: { consentTerms: consent.terms, consentPrivacy: consent.privacy },
      profilePhotoPath: data.profilePhotoPath,
    }

    const res = await submitDriverApplication(payload)
    if (res.ok) {
      setResult({ applicationNumber: res.applicationNumber, applicationId: res.applicationId, statusToken: res.statusToken })
    } else {
      setPhase("error")
      setError(dict.common.errorGeneric)
    }
  }

  if (result) {
    return (
      <SuccessScreen
        applicationNumber={result.applicationNumber}
        statusToken={result.statusToken}
        applicantName={fullName}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-extrabold tracking-tight text-foreground">{dict.review.heading}</h2>
        <p className="text-sm text-muted-foreground">{dict.review.subheading}</p>
      </div>

      <div className="space-y-3">
        {sections.map((section) => (
          <div key={section.key} className="rounded-2xl border border-border bg-card/60 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-bold text-foreground">{section.title}</p>
              <button
                type="button"
                onClick={() => onEdit(section.key)}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-elite-blue-600 transition-colors hover:bg-elite-blue-500/10 dark:text-elite-blue-300"
              >
                {dict.review.edit}
              </button>
            </div>
            <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {section.lines.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 text-[13px]">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-end font-semibold text-foreground">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      <div className="space-y-3 rounded-2xl border border-elite-blue-500/20 bg-elite-blue-500/5 p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={consent.terms}
            onChange={(e) => setConsent({ ...consent, terms: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded accent-[#1E5A99]"
          />
          <span className="text-sm font-medium text-foreground">{dict.review.consentTerms}</span>
        </label>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={consent.privacy}
            onChange={(e) => setConsent({ ...consent, privacy: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded accent-[#1E5A99]"
          />
          <span className="text-sm font-medium text-foreground">{dict.review.consentPrivacy}</span>
        </label>
      </div>

      {error && <p className="text-sm font-medium text-destructive" role="alert">{error}</p>}

      <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-5">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {dict.common.back}
        </button>
        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={phase === "validating" || phase === "submitting"}
          className="flex h-12 items-center gap-2 rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 px-8 text-sm font-bold text-white shadow-lg shadow-elite-blue-500/25 transition-all hover:from-elite-blue-600 hover:to-elite-blue-700 hover:shadow-elite-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {phase === "validating" && (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> {dict.review.validating}
            </>
          )}
          {phase === "submitting" && (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> {dict.review.submitting}
            </>
          )}
          {phase !== "validating" && phase !== "submitting" && (
            <>
              <CheckCircle2 className="h-4 w-4" /> {dict.review.confirmSubmit}
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ═══ Wizard shell ════════════════════════════════════════════════════════════
export function Wizard({ platformOptions }: { platformOptions: PlatformOption[] }) {
  const { dict, data, patch } = useDriverRegistration()
  const [current, setCurrent] = React.useState<StepKey>("personal")
  const [consent, setConsent] = React.useState({ terms: false, privacy: false })

  const currentIndex = STEP_ORDER.indexOf(current)
  const completed: StepKey[] = STEP_ORDER.filter((k, i) => i < currentIndex)

  const goNext = () => {
    if (currentIndex < STEP_ORDER.length - 1) setCurrent(STEP_ORDER[currentIndex + 1])
  }
  const goBack = () => {
    if (currentIndex > 0) setCurrent(STEP_ORDER[currentIndex - 1])
  }

  const handleStepNext = (key: StepKey, values: unknown) => {
    patch({ [key]: values } as Partial<typeof data>)
    goNext()
  }

  const handleEdit = (key: StepKey) => {
    setCurrent(key)
  }

  return (
    <div className="min-h-screen bg-background">
      <RegistrationHeader />

      <div className="mx-auto max-w-5xl px-4 pb-20 pt-8 lg:px-8">
        {/* Progress header */}
        <div className="mb-6 flex items-center justify-between">
          <p className="text-sm font-semibold text-muted-foreground">
            {dict.progress.step} {currentIndex + 1} {dict.progress.of} {STEP_ORDER.length}
          </p>
          <div className="h-2 w-40 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-elite-blue-500 to-elite-orange-500 transition-all duration-500"
              style={{ width: `${((currentIndex + 1) / STEP_ORDER.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
          {/* Journey rail (right panel on desktop becomes compact bar on mobile) */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 rounded-2xl border border-border/60 bg-card/60 p-4">
              <p className="mb-3 px-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                {dict.steps.review === dict.steps.review ? dict.header.tagline : dict.header.tagline}
              </p>
              <ProgressRail current={current} completed={completed} />
            </div>
          </aside>

          {/* Form zone */}
          <div className="min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={current}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              >
                {current === "personal" && (
                  <PersonalStep
                    initial={data.personal}
                    photoPath={data.profilePhotoPath}
                    onBack={undefined}
                    onNext={(v) => {
                      patch({ personal: v, profilePhotoPath: v.profilePhotoPath })
                      goNext()
                    }}
                  />
                )}
                {current === "contact" && (
                  <ContactStep initial={data.contact} onBack={goBack} onNext={(v) => handleStepNext("contact", v)} />
                )}
                {current === "identity" && (
                  <IdentityStep initial={data.identity} onBack={goBack} onNext={(v) => handleStepNext("identity", v)} />
                )}
                {current === "license" && (
                  <LicenseStep initial={data.license} onBack={goBack} onNext={(v) => handleStepNext("license", v)} />
                )}
                {current === "work" && (
                  <WorkStep initial={data.work} onBack={goBack} onNext={(v) => handleStepNext("work", v)} />
                )}
                {current === "platforms" && (
                  <PlatformsStep
                    initial={data.platforms}
                    onBack={goBack}
                    onNext={(v) => handleStepNext("platforms", v)}
                    platformOptions={platformOptions}
                  />
                )}
                {current === "vehicle" && (
                  <VehicleStep initial={data.vehicle} onBack={goBack} onNext={(v) => handleStepNext("vehicle", v)} />
                )}
                {current === "documents" && (
                  <DocumentsStep
                    initial={data.documents}
                    hasVehicle={data.vehicle?.hasVehicle ?? false}
                    onBack={goBack}
                    onNext={(v) => handleStepNext("documents", v)}
                  />
                )}
                {current === "review" && (
                  <ReviewPanel
                    onEdit={handleEdit}
                    consent={consent}
                    setConsent={setConsent}
                    onBack={goBack}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Compact mobile progress */}
        <div className="mt-8 lg:hidden">
          <ProgressRail current={current} completed={completed} />
        </div>
      </div>
    </div>
  )
}
