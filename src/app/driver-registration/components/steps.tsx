"use client"

import * as React from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useDriverRegistration } from "@/contexts/driver-registration-context"
import {
  contactSchema,
  identitySchema,
  licenseSchema,
  personalSchema,
  type ContactValues,
  type DocumentsValues,
  type IdentityValues,
  type LicenseValues,
  type PersonalValues,
  type PlatformsValues,
  type VehicleValues,
  type WorkValues,
} from "@/lib/driver-registration/schema"
import type { UploadedFile } from "@/lib/driver-registration/storage"
import { DateField, Field, ProfilePhotoAvatar, SelectionCard, UploadCard } from "./fields"

function translateError(dict: ReturnType<typeof useDriverRegistration>["dict"], message?: string): string | undefined {
  if (!message) return undefined
  switch (message) {
    case "errorRequired":
      return dict.common.errorRequired
    case "errorInvalidMobile":
      return dict.common.errorInvalidMobile
    case "errorInvalidEmail":
      return dict.common.errorInvalidEmail
    case "errorTooLong":
      return dict.common.errorTooLong
    case "errorNone":
      return dict.platforms.errorNone
    default:
      return dict.common.errorGeneric
  }
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-1.5">
      <h2 className="text-2xl font-extrabold tracking-tight text-foreground">{title}</h2>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  )
}

function Footer({ onBack }: { onBack?: () => void }) {
  const { dict } = useDriverRegistration()
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-5">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {dict.common.back}
        </button>
      ) : (
        <span />
      )}
      <button
        type="submit"
        className="h-11 rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 px-8 text-sm font-bold text-white shadow-lg shadow-elite-blue-500/25 transition-all hover:from-elite-blue-600 hover:to-elite-blue-700 hover:shadow-elite-blue-500/40"
      >
        {dict.common.next}
      </button>
    </div>
  )
}

// ═══ STEP 1 — PERSONAL ═══════════════════════════════════════════════════════
export function PersonalStep({
  initial,
  photoPath,
  onNext,
  onBack,
}: {
  initial?: PersonalValues | null
  photoPath?: string
  onNext: (values: PersonalValues & { profilePhotoPath: string }) => void
  onBack?: () => void
}) {
  const { dict, locale } = useDriverRegistration()
  const [photo, setPhoto] = React.useState<UploadedFile | null>(null)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)
  const draftKey = React.useId().replace(/:/g, "")

  const form = useForm<PersonalValues>({
    resolver: zodResolver(personalSchema),
    defaultValues: initial ?? {
      firstName: "",
      middleName: "",
      lastName: "",
      dateOfBirth: "",
      nationality: "",
      gender: "male",
    },
  })

  const genderOptions = [
    { value: "male", label: dict.personal.male },
    { value: "female", label: dict.personal.female },
  ]

  return (
    <Form {...form}>
      <form
        className="space-y-7"
        onSubmit={form.handleSubmit((values) => onNext({ ...values, profilePhotoPath: photo?.path ?? photoPath ?? "" }))}
        noValidate
      >
        <SectionHeading title={dict.personal.heading} subtitle={dict.personal.subheading} />

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{dict.personal.firstName}</FormLabel>
                <FormControl>
                  <Input className="h-11 rounded-xl" placeholder={dict.personal.firstNamePh} {...field} />
                </FormControl>
                <FormMessage>{translateError(dict, form.formState.errors.firstName?.message)}</FormMessage>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="middleName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {dict.personal.middleName}{" "}
                  <span className="text-xs font-normal text-muted-foreground">({dict.common.optional})</span>
                </FormLabel>
                <FormControl>
                  <Input className="h-11 rounded-xl" placeholder={dict.personal.middleNamePh} {...field} />
                </FormControl>
                <FormMessage>{translateError(dict, form.formState.errors.middleName?.message)}</FormMessage>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{dict.personal.lastName}</FormLabel>
                <FormControl>
                  <Input className="h-11 rounded-xl" placeholder={dict.personal.lastNamePh} {...field} />
                </FormControl>
                <FormMessage>{translateError(dict, form.formState.errors.lastName?.message)}</FormMessage>
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="dateOfBirth"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{dict.personal.dateOfBirth}</FormLabel>
                <FormControl>
                  <DateField
                    label=""
                    value={field.value}
                    onChange={field.onChange}
                    error={translateError(dict, form.formState.errors.dateOfBirth?.message)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="nationality"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{dict.personal.nationality}</FormLabel>
                <FormControl>
                  <Input className="h-11 rounded-xl" placeholder={dict.personal.nationalityPh} {...field} />
                </FormControl>
                <FormMessage>{translateError(dict, form.formState.errors.nationality?.message)}</FormMessage>
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="gender"
          render={({ field }) => (
            <FormItem className="space-y-2">
              <FormLabel>{dict.personal.gender}</FormLabel>
              <FormControl>
                <RadioGroup
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                  className="flex flex-wrap gap-3"
                  dir={locale === "ar" || locale === "ur" ? "rtl" : "ltr"}
                >
                  {genderOptions.map((g) => (
                    <div
                      key={g.value}
                      className="flex items-center gap-2 rounded-xl border border-border px-4 py-3 transition-colors has-data-[state=checked]:border-elite-blue-500 has-data-[state=checked]:bg-elite-blue-500/5"
                    >
                      <RadioGroupItem value={g.value} id={`gender-${g.value}`} />
                      <Label htmlFor={`gender-${g.value}`} className="font-medium">{g.label}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </FormControl>
              <FormMessage>{translateError(dict, form.formState.errors.gender?.message)}</FormMessage>
            </FormItem>
          )}
        />

        <div className="space-y-2">
          <Label className="text-sm font-semibold">
            {dict.personal.profilePhoto}{" "}
            <span className="font-normal text-muted-foreground">· {dict.personal.profilePhotoHint}</span>
          </Label>
          <div className="flex items-start gap-4">
            <ProfilePhotoAvatar previewUrl={previewUrl} />
            <div className="min-w-0 flex-1">
              <UploadCard
                label=""
                required
                file={photo}
                onFile={setPhoto}
                draftId={draftKey}
                documentType="profile_photo"
                onLocalPreview={setPreviewUrl}
              />
            </div>
          </div>
        </div>

        <Footer onBack={onBack} />
      </form>
    </Form>
  )
}

// ═══ STEP 2 — CONTACT ════════════════════════════════════════════════════════
export function ContactStep({
  initial,
  onNext,
  onBack,
}: {
  initial?: ContactValues | null
  onNext: (values: ContactValues) => void
  onBack?: () => void
}) {
  const { dict } = useDriverRegistration()
  const form = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: initial ?? { mobile: "", alternativeMobile: "", email: "", city: "", district: "", address: "" },
  })

  return (
    <Form {...form}>
      <form className="space-y-7" onSubmit={form.handleSubmit(onNext)} noValidate>
        <SectionHeading title={dict.contact.heading} subtitle={dict.contact.subheading} />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="mobile"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{dict.contact.mobile}</FormLabel>
                <FormControl>
                  <Input className="h-11 rounded-xl" inputMode="tel" placeholder={dict.contact.mobilePh} {...field} />
                </FormControl>
                <FormMessage>{translateError(dict, form.formState.errors.mobile?.message)}</FormMessage>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="alternativeMobile"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {dict.contact.altMobile}{" "}
                  <span className="text-xs font-normal text-muted-foreground">({dict.common.optional})</span>
                </FormLabel>
                <FormControl>
                  <Input className="h-11 rounded-xl" inputMode="tel" placeholder={dict.contact.altMobilePh} {...field} />
                </FormControl>
                <FormMessage>{translateError(dict, form.formState.errors.alternativeMobile?.message)}</FormMessage>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {dict.contact.email}{" "}
                  <span className="text-xs font-normal text-muted-foreground">({dict.common.optional})</span>
                </FormLabel>
                <FormControl>
                  <Input className="h-11 rounded-xl" inputMode="email" placeholder={dict.contact.emailPh} {...field} />
                </FormControl>
                <FormMessage>{translateError(dict, form.formState.errors.email?.message)}</FormMessage>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{dict.contact.city}</FormLabel>
                <FormControl>
                  <Input className="h-11 rounded-xl" placeholder={dict.contact.cityPh} {...field} />
                </FormControl>
                <FormMessage>{translateError(dict, form.formState.errors.city?.message)}</FormMessage>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="district"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{dict.contact.district}</FormLabel>
                <FormControl>
                  <Input className="h-11 rounded-xl" placeholder={dict.contact.districtPh} {...field} />
                </FormControl>
                <FormMessage>{translateError(dict, form.formState.errors.district?.message)}</FormMessage>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{dict.contact.address}</FormLabel>
                <FormControl>
                  <Input className="h-11 rounded-xl" placeholder={dict.contact.addressPh} {...field} />
                </FormControl>
                <FormMessage>{translateError(dict, form.formState.errors.address?.message)}</FormMessage>
              </FormItem>
            )}
          />
        </div>

        <Footer onBack={onBack} />
      </form>
    </Form>
  )
}

// ═══ STEP 3 — IDENTITY ═══════════════════════════════════════════════════════
export function IdentityStep({
  initial,
  onNext,
  onBack,
}: {
  initial?: IdentityValues | null
  onNext: (values: IdentityValues) => void
  onBack?: () => void
}) {
  const { dict, locale } = useDriverRegistration()
  const [attachment, setAttachment] = React.useState<UploadedFile | null>(null)
  const draftKey = React.useId().replace(/:/g, "")
  const identityType = initial?.identityType ?? "iqama"

  const form = useForm<IdentityValues>({
    resolver: zodResolver(identitySchema),
    defaultValues: initial ?? {
      identityType: "iqama",
      identityNumber: "",
      identityExpiry: "",
      identityAttachment: "",
    },
  })

  const watchType = useWatch({ control: form.control, name: "identityType" })
  const isPassport = watchType === "passport"

  const typeOptions = [
    { value: "iqama", label: dict.identity.iqama },
    { value: "national_id", label: dict.identity.nationalId },
    { value: "passport", label: dict.identity.passport },
  ]

  return (
    <Form {...form}>
      <form
        className="space-y-7"
        onSubmit={form.handleSubmit((values) =>
          onNext({ ...values, identityAttachment: attachment?.path ?? initial?.identityAttachment ?? "" })
        )}
        noValidate
      >
        <SectionHeading title={dict.identity.heading} subtitle={dict.identity.subheading} />

        <FormField
          control={form.control}
          name="identityType"
          render={({ field }) => (
            <FormItem className="space-y-2">
              <FormLabel>{dict.identity.type}</FormLabel>
              <FormControl>
                <RadioGroup
                  onValueChange={(v) => {
                    field.onChange(v)
                    if (v === "passport") form.setValue("identityExpiry", "")
                  }}
                  defaultValue={field.value}
                  className="grid gap-3 sm:grid-cols-3"
                  dir={locale === "ar" || locale === "ur" ? "rtl" : "ltr"}
                >
                  {typeOptions.map((t) => (
                    <div
                      key={t.value}
                      className={cn(
                        "flex items-center gap-2 rounded-xl border border-border px-4 py-3.5 transition-colors has-data-[state=checked]:border-elite-blue-500 has-data-[state=checked]:bg-elite-blue-500/5",
                        identityType === t.value && "border-elite-blue-500 bg-elite-blue-500/5"
                      )}
                    >
                      <RadioGroupItem value={t.value} id={`identity-${t.value}`} />
                      <Label htmlFor={`identity-${t.value}`} className="font-medium">{t.label}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="identityNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{dict.identity.number}</FormLabel>
                <FormControl>
                  <Input className="h-11 rounded-xl" placeholder={dict.identity.numberPh} {...field} />
                </FormControl>
                <FormMessage>{translateError(dict, form.formState.errors.identityNumber?.message)}</FormMessage>
              </FormItem>
            )}
          />
          {!isPassport && (
            <FormField
              control={form.control}
              name="identityExpiry"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{dict.identity.expiry}</FormLabel>
                  <FormControl>
                    <DateField
                      label=""
                      value={field.value}
                      onChange={field.onChange}
                      checkValidity
                      error={translateError(dict, form.formState.errors.identityExpiry?.message)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        <UploadCard
          label={dict.identity.attachment}
          hint={dict.identity.attachmentHint}
          required
          file={attachment}
          onFile={setAttachment}
          draftId={draftKey}
          documentType="identity"
        />

        <Footer onBack={onBack} />
      </form>
    </Form>
  )
}

// ═══ STEP 4 — DRIVING LICENSE ════════════════════════════════════════════════
export function LicenseStep({
  initial,
  onNext,
  onBack,
}: {
  initial?: LicenseValues | null
  onNext: (values: LicenseValues) => void
  onBack?: () => void
}) {
  const { dict } = useDriverRegistration()
  const [attachment, setAttachment] = React.useState<UploadedFile | null>(null)
  const draftKey = React.useId().replace(/:/g, "")

  const form = useForm<LicenseValues>({
    resolver: zodResolver(licenseSchema),
    defaultValues: initial ?? { licenseNumber: "", licenseType: "", licenseCountry: "", licenseExpiry: "", licenseAttachment: "" },
  })

  return (
    <Form {...form}>
      <form
        className="space-y-7"
        onSubmit={form.handleSubmit((values) =>
          onNext({ ...values, licenseAttachment: attachment?.path ?? initial?.licenseAttachment ?? "" })
        )}
        noValidate
      >
        <SectionHeading title={dict.license.heading} subtitle={dict.license.subheading} />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="licenseNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{dict.license.number}</FormLabel>
                <FormControl>
                  <Input className="h-11 rounded-xl" placeholder={dict.license.numberPh} {...field} />
                </FormControl>
                <FormMessage>{translateError(dict, form.formState.errors.licenseNumber?.message)}</FormMessage>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="licenseType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{dict.license.type}</FormLabel>
                <FormControl>
                  <Input className="h-11 rounded-xl" placeholder={dict.license.typePh} {...field} />
                </FormControl>
                <FormMessage>{translateError(dict, form.formState.errors.licenseType?.message)}</FormMessage>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="licenseCountry"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{dict.license.country}</FormLabel>
                <FormControl>
                  <Input className="h-11 rounded-xl" placeholder={dict.license.countryPh} {...field} />
                </FormControl>
                <FormMessage>{translateError(dict, form.formState.errors.licenseCountry?.message)}</FormMessage>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="licenseExpiry"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{dict.license.expiry}</FormLabel>
                <FormControl>
                  <DateField
                    label=""
                    value={field.value}
                    onChange={field.onChange}
                    checkValidity
                    error={translateError(dict, form.formState.errors.licenseExpiry?.message)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <UploadCard
          label={dict.license.attachment}
          hint={dict.license.attachmentHint}
          required
          file={attachment}
          onFile={setAttachment}
          draftId={draftKey}
          documentType="license"
        />

        <Footer onBack={onBack} />
      </form>
    </Form>
  )
}

// ═══ STEP 5 — WORK TYPE ══════════════════════════════════════════════════════
export function WorkStep({
  initial,
  onNext,
  onBack,
}: {
  initial?: WorkValues | null
  onNext: (values: WorkValues) => void
  onBack?: () => void
}) {
  const { dict, locale } = useDriverRegistration()
  const [workType, setWorkType] = React.useState<"full_time" | "freelancer">(initial?.workType ?? "full_time")
  const [category, setCategory] = React.useState<string | null>(initial?.driverCategory ?? null)

  const isFullTime = workType === "full_time"

  const submit = () => {
    if (!category) return
    onNext({ workType, driverCategory: category as WorkValues["driverCategory"] })
  }

  return (
    <div className="space-y-7">
      <SectionHeading title={dict.work.heading} subtitle={dict.work.subheading} />

      <div className="grid gap-4 sm:grid-cols-2" dir={locale === "ar" || locale === "ur" ? "rtl" : "ltr"}>
        <SelectionCard
          selected={workType === "full_time"}
          onSelect={() => {
            setWorkType("full_time")
            setCategory(initial?.driverCategory?.startsWith("sponsored") ? initial.driverCategory : null)
          }}
          title={dict.work.fullTime}
          desc={dict.work.fullTimeDesc}
          icon="🚗"
        />
        <SelectionCard
          selected={workType === "freelancer"}
          onSelect={() => {
            setWorkType("freelancer")
            setCategory("freelancer")
          }}
          title={dict.work.freelancer}
          desc={dict.work.freelancerDesc}
          icon="⚡"
        />
      </div>

      {isFullTime && (
        <div className="space-y-3">
          <p className="text-sm font-bold text-foreground">{dict.work.categoryHeading}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectionCard
              selected={category === "sponsored_type_1"}
              onSelect={() => setCategory("sponsored_type_1")}
              title={dict.work.sponsored1}
              desc={dict.work.sponsored1Desc}
              icon="🏠"
            />
            <SelectionCard
              selected={category === "sponsored_type_2"}
              onSelect={() => setCategory("sponsored_type_2")}
              title={dict.work.sponsored2}
              desc={dict.work.sponsored2Desc}
              icon="🏢"
            />
          </div>
        </div>
      )}

      {!isFullTime && (
        <p className="rounded-xl border border-elite-blue-500/20 bg-elite-blue-500/5 px-4 py-3 text-sm text-muted-foreground">
          {dict.work.freelancerNote}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-5">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {dict.common.back}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={submit}
          className="h-11 rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 px-8 text-sm font-bold text-white shadow-lg shadow-elite-blue-500/25 transition-all hover:from-elite-blue-600 hover:to-elite-blue-700 hover:shadow-elite-blue-500/40"
        >
          {dict.common.next}
        </button>
      </div>
    </div>
  )
}

// ═══ STEP 6 — PLATFORMS ══════════════════════════════════════════════════════
export function PlatformsStep({
  initial,
  onNext,
  onBack,
  platformOptions,
}: {
  initial?: PlatformsValues | null
  onNext: (values: PlatformsValues) => void
  onBack?: () => void
  platformOptions: { code: string; label: string; emoji?: string }[]
}) {
  const { dict, locale } = useDriverRegistration()
  const [selected, setSelected] = React.useState<string[]>(initial?.platforms ?? [])
  const [error, setError] = React.useState<string | null>(null)
  const noneSelected = selected.includes("none")

  const toggle = (code: string) => {
    setError(null)
    if (code === "none") {
      setSelected(["none"])
      return
    }
    setSelected((prev) => {
      const withoutNone = prev.filter((c) => c !== "none")
      return withoutNone.includes(code) ? withoutNone.filter((c) => c !== code) : [...withoutNone, code]
    })
  }

  const submit = () => {
    const active = selected.filter((c) => c !== "none")
    if (selected.length === 0 || (noneSelected && active.length === 0) || selected.length === 0) {
      setError(dict.platforms.errorNone)
      return
    }
    onNext({ platforms: noneSelected ? [] : active })
  }

  return (
    <div className="space-y-7">
      <SectionHeading title={dict.platforms.heading} subtitle={dict.platforms.subheading} />

      <div
        className="grid gap-3 sm:grid-cols-2"
        dir={locale === "ar" || locale === "ur" ? "rtl" : "ltr"}
      >
        {platformOptions.map((p) => (
          <button
            key={p.code}
            type="button"
            onClick={() => toggle(p.code)}
            aria-pressed={selected.includes(p.code)}
            className={cn(
              "flex items-center gap-3 rounded-2xl border p-4 text-start transition-all duration-200",
              selected.includes(p.code)
                ? "border-elite-blue-500 bg-elite-blue-500/5 shadow-md shadow-elite-blue-500/10"
                : "border-border bg-card hover:-translate-y-0.5 hover:border-elite-blue-500/40 hover:shadow-md"
            )}
          >
            <span className="text-xl" aria-hidden>{p.emoji ?? "📦"}</span>
            <span className="text-sm font-bold text-foreground">{p.label}</span>
            <span
              className={cn(
                "ms-auto flex h-5 w-5 items-center justify-center rounded-md border-2 transition-colors",
                selected.includes(p.code) ? "border-elite-blue-500 bg-elite-blue-500" : "border-muted-foreground/30"
              )}
            >
              {selected.includes(p.code) && <span className="text-[10px] font-black text-white">✓</span>}
            </span>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card/60 p-4">
        <button
          type="button"
          onClick={() => toggle("none")}
          aria-pressed={noneSelected}
          className={cn(
            "flex w-full items-center gap-3 rounded-xl p-2 text-start transition-colors",
            noneSelected && "text-elite-blue-600 dark:text-elite-blue-300"
          )}
        >
          <span
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-md border-2 transition-colors",
              noneSelected ? "border-elite-blue-500 bg-elite-blue-500" : "border-muted-foreground/30"
            )}
          >
            {noneSelected && <span className="text-[10px] font-black text-white">✓</span>}
          </span>
          <span className="text-sm font-bold">{dict.platforms.none}</span>
        </button>
        <p className="mt-1 ps-10 text-xs text-muted-foreground">{dict.platforms.noneDesc}</p>
      </div>

      {error && <p className="text-sm font-medium text-destructive" role="alert">{error}</p>}

      <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-5">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {dict.common.back}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={submit}
          className="h-11 rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 px-8 text-sm font-bold text-white shadow-lg shadow-elite-blue-500/25 transition-all hover:from-elite-blue-600 hover:to-elite-blue-700 hover:shadow-elite-blue-500/40"
        >
          {dict.common.next}
        </button>
      </div>
    </div>
  )
}

// ═══ STEP 7 — VEHICLE ════════════════════════════════════════════════════════
export function VehicleStep({
  initial,
  onNext,
  onBack,
}: {
  initial?: VehicleValues | null
  onNext: (values: VehicleValues) => void
  onBack?: () => void
}) {
  const { dict, locale } = useDriverRegistration()
  const [hasVehicle, setHasVehicle] = React.useState<boolean>(initial?.hasVehicle ?? false)
  const [error, setError] = React.useState<string | null>(null)
  const [values, setValues] = React.useState<Omit<VehicleValues, "hasVehicle">>({
    ownership: initial?.ownership ?? "",
    vehicleType: initial?.vehicleType ?? "",
    make: initial?.make ?? "",
    model: initial?.model ?? "",
    year: initial?.year ?? "",
    plate: initial?.plate ?? "",
    regExpiry: initial?.regExpiry ?? "",
    insuranceExpiry: initial?.insuranceExpiry ?? "",
    regAttachment: initial?.regAttachment ?? "",
    insuranceAttachment: initial?.insuranceAttachment ?? "",
  })
  const [regFile, setRegFile] = React.useState<UploadedFile | null>(null)
  const [insFile, setInsFile] = React.useState<UploadedFile | null>(null)
  const draftKey = React.useId().replace(/:/g, "")

  const set = <K extends keyof typeof values>(key: K, v: string) => {
    setError(null)
    setValues((prev) => ({ ...prev, [key]: v }))
  }

  const vehicleTypes = [
    { value: "car", label: dict.vehicle.car },
    { value: "motorbike", label: dict.vehicle.motorbike },
    { value: "van", label: dict.vehicle.van },
    { value: "truck", label: dict.vehicle.truck },
  ]

  const submit = () => {
    if (!hasVehicle) {
      onNext({ ...values, hasVehicle: false })
      return
    }
    const required: (keyof typeof values)[] = ["ownership", "vehicleType", "make", "model", "year", "plate", "regExpiry", "insuranceExpiry"]
    for (const key of required) {
      if (!values[key]) {
        setError(dict.common.errorRequired)
        return
      }
    }
    if (!regFile?.path && !values.regAttachment) {
      setError(dict.common.errorRequired)
      return
    }
    onNext({
      ...values,
      hasVehicle: true,
      regAttachment: regFile?.path ?? values.regAttachment,
      insuranceAttachment: insFile?.path ?? values.insuranceAttachment,
    })
  }

  return (
    <div className="space-y-7">
      <SectionHeading title={dict.vehicle.heading} subtitle={dict.vehicle.subheading} />

      <div className="space-y-2">
        <Label className="text-sm font-semibold">{dict.vehicle.haveVehicle}</Label>
        <div className="flex gap-3" dir={locale === "ar" || locale === "ur" ? "rtl" : "ltr"}>
          <button
            type="button"
            onClick={() => setHasVehicle(true)}
            aria-pressed={hasVehicle}
            className={cn(
              "flex-1 rounded-2xl border p-4 text-center text-sm font-bold transition-all",
              hasVehicle
                ? "border-elite-blue-500 bg-elite-blue-500/5 text-elite-blue-600 dark:text-elite-blue-300"
                : "border-border bg-card text-muted-foreground hover:border-elite-blue-500/40"
            )}
          >
            {dict.common.yes}
          </button>
          <button
            type="button"
            onClick={() => setHasVehicle(false)}
            aria-pressed={!hasVehicle}
            className={cn(
              "flex-1 rounded-2xl border p-4 text-center text-sm font-bold transition-all",
              !hasVehicle
                ? "border-elite-blue-500 bg-elite-blue-500/5 text-elite-blue-600 dark:text-elite-blue-300"
                : "border-border bg-card text-muted-foreground hover:border-elite-blue-500/40"
            )}
          >
            {dict.common.no}
          </button>
        </div>
      </div>

      {hasVehicle && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={dict.vehicle.ownership} value={values.ownership} onChange={(e) => set("ownership", e.target.value)} placeholder={dict.vehicle.ownershipPh} />
            <div className="space-y-1.5">
              <Label>{dict.vehicle.type}</Label>
              <Select value={values.vehicleType || undefined} onValueChange={(v) => set("vehicleType", v)}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue placeholder={dict.vehicle.typePh} />
                </SelectTrigger>
                <SelectContent>
                  {vehicleTypes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Field label={dict.vehicle.make} value={values.make} onChange={(e) => set("make", e.target.value)} placeholder={dict.vehicle.makePh} />
            <Field label={dict.vehicle.model} value={values.model} onChange={(e) => set("model", e.target.value)} placeholder={dict.vehicle.modelPh} />
            <Field label={dict.vehicle.year} value={values.year} onChange={(e) => set("year", e.target.value)} placeholder={dict.vehicle.yearPh} inputMode="numeric" />
            <Field label={dict.vehicle.plate} value={values.plate} onChange={(e) => set("plate", e.target.value)} placeholder={dict.vehicle.platePh} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <DateField label={dict.vehicle.regExpiry} value={values.regExpiry} onChange={(v) => set("regExpiry", v)} checkValidity />
            <DateField label={dict.vehicle.insuranceExpiry} value={values.insuranceExpiry} onChange={(v) => set("insuranceExpiry", v)} checkValidity />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <UploadCard
              label={dict.vehicle.regAttachment}
              required
              file={regFile}
              onFile={setRegFile}
              draftId={draftKey}
              documentType="vehicle_reg"
            />
            <UploadCard
              label={dict.vehicle.insuranceAttachment}
              required
              file={insFile}
              onFile={setInsFile}
              draftId={draftKey}
              documentType="vehicle_insurance"
            />
          </div>
        </div>
      )}

      {error && <p className="text-sm font-medium text-destructive" role="alert">{error}</p>}

      <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-5">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {dict.common.back}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={submit}
          className="h-11 rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 px-8 text-sm font-bold text-white shadow-lg shadow-elite-blue-500/25 transition-all hover:from-elite-blue-600 hover:to-elite-blue-700 hover:shadow-elite-blue-500/40"
        >
          {dict.common.next}
        </button>
      </div>
    </div>
  )
}

// ═══ STEP 8 — DOCUMENTS ══════════════════════════════════════════════════════
export function DocumentsStep({
  initial,
  hasVehicle,
  onNext,
  onBack,
}: {
  initial?: DocumentsValues | null
  hasVehicle: boolean
  onNext: (values: DocumentsValues) => void
  onBack?: () => void
}) {
  const { dict } = useDriverRegistration()
  const [identity, setIdentity] = React.useState<UploadedFile | null>(null)
  const [license, setLicense] = React.useState<UploadedFile | null>(null)
  const [reg, setReg] = React.useState<UploadedFile | null>(null)
  const [insurance, setInsurance] = React.useState<UploadedFile | null>(null)
  const draftKey = React.useId().replace(/:/g, "")

  const submit = () => {
    onNext({
      identityAttachment: identity?.path ?? initial?.identityAttachment ?? "",
      licenseAttachment: license?.path ?? initial?.licenseAttachment ?? "",
      regAttachment: reg?.path ?? initial?.regAttachment ?? "",
      insuranceAttachment: insurance?.path ?? initial?.insuranceAttachment ?? "",
    })
  }

  return (
    <div className="space-y-7">
      <SectionHeading title={dict.documents.heading} subtitle={dict.documents.subheading} />

      <div className="grid gap-4 sm:grid-cols-2">
        <UploadCard label={dict.documents.identityDoc} required file={identity} onFile={setIdentity} draftId={draftKey} documentType="identity" />
        <UploadCard label={dict.documents.licenseDoc} required file={license} onFile={setLicense} draftId={draftKey} documentType="license" />
        {hasVehicle && (
          <>
            <UploadCard label={dict.documents.vehicleRegDoc} required file={reg} onFile={setReg} draftId={draftKey} documentType="vehicle_reg" />
            <UploadCard label={dict.documents.vehicleInsuranceDoc} required file={insurance} onFile={setInsurance} draftId={draftKey} documentType="vehicle_insurance" />
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-5">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {dict.common.back}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={submit}
          className="h-11 rounded-xl bg-gradient-to-r from-elite-blue-500 to-elite-blue-600 px-8 text-sm font-bold text-white shadow-lg shadow-elite-blue-500/25 transition-all hover:from-elite-blue-600 hover:to-elite-blue-700 hover:shadow-elite-blue-500/40"
        >
          {dict.common.next}
        </button>
      </div>
    </div>
  )
}
