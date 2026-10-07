"use client"

// HR hub dialogs (Prompt O Part 4): training record create, performance
// review upsert and public-holiday upsert. Every component is session-keyed —
// the parent mounts it with a fresh `key` per open — so initial state derives
// straight from props with no reset effect (the setState-in-effect rule).

import { useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { createTrainingRecord, upsertHoliday, upsertPerformanceReview } from "@/lib/hr-module/actions"

interface DriverOption {
  id: string
  full_name_ar: string | null
  driver_code: string | null
}

interface HolidayRow {
  id: string
  name_ar: string
  name_en: string | null
  holiday_date: string | null
  duration_days: number | null
  calendar_type: string
  is_recurring: boolean
}

interface ReviewRow {
  id: string
  driver_id: string
  review_period: string
  review_date: string
  overall_score: number | null
  status: string
}

const CALENDAR_TYPES = ["gregorian", "hijri", "fixed"] as const

const numOrNull = (v: string): number | null => {
  if (v.trim() === "") return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null
}

// ── Add training record ─────────────────────────────────────────────────────

// Small trigger-button that opens the training dialog (the dialog itself is
// mounted by the page when the open state flips).
export function AddTrainingButton({
  open,
  drivers,
  onOpenChange,
}: {
  open: boolean
  drivers: DriverOption[]
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={open || drivers.length === 0}
      onClick={() => onOpenChange(true)}
    >
      {t.hrModule.addTraining}
    </Button>
  )
}

// The actual dialog body for the training record (mounted by the page).
export function AddTrainingDialog({
  open,
  drivers,
  onClose,
  onDone,
}: {
  open: boolean
  drivers: DriverOption[]
  onClose: () => void
  onDone: (err: string | null) => void
}) {
  const { t } = useTranslation()
  const hm = t.hrModule
  const [driverId, setDriverId] = useState(drivers[0]?.id ?? "")
  const [course, setCourse] = useState("")
  const [trainingDate, setTrainingDate] = useState(new Date().toISOString().slice(0, 10))
  const [expiryDate, setExpiryDate] = useState("")
  const [provider, setProvider] = useState("")
  const [score, setScore] = useState("")
  const [passed, setPassed] = useState(true)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!driverId) return onDone(hm.errDriverRequired)
    const courseVal = course.trim()
    if (courseVal.length < 2) return onDone(hm.errCourseRequired)
    const scoreVal = numOrNull(score)
    if (score !== "" && scoreVal === null) return onDone(t.common.invalidInput)
    setBusy(true)
    const res = await createTrainingRecord({
      driver_id: driverId,
      course_name: courseVal,
      training_date: trainingDate,
      expiry_date: expiryDate || null,
      provider: provider || null,
      score: scoreVal,
      is_passed: passed,
    })
    setBusy(false)
    onDone(res.success ? null : res.error ?? "Error")
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{hm.addTraining}</DialogTitle>
          <DialogDescription>{hm.addTrainingDesc}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>{t.nav.drivers} *</Label>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t.nav.drivers} /></SelectTrigger>
              <SelectContent>
                {drivers.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.full_name_ar ?? "—"}{d.driver_code ? ` (${d.driver_code})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>{hm.fieldCourse} *</Label>
            <Input value={course} onChange={(e) => setCourse(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{hm.fieldTrainingDate} *</Label>
              <Input dir="ltr" type="date" value={trainingDate} onChange={(e) => setTrainingDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{hm.fieldExpiry}</Label>
              <Input dir="ltr" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{hm.fieldProvider}</Label>
              <Input value={provider} onChange={(e) => setProvider(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{hm.fieldScore}</Label>
              <Input dir="ltr" type="number" min="0" max="100" value={score} onChange={(e) => setScore(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={passed} onCheckedChange={(v) => setPassed(v === true)} />
            {hm.fieldPassed}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t.common.cancel}</Button>
          <Button onClick={submit} disabled={busy || !driverId}>
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Performance review upsert ────────────────────────────────────────────────

export function PerformanceReviewDialog({
  open,
  drivers,
  review,
  onClose,
  onDone,
}: {
  open: boolean
  drivers: DriverOption[]
  review: ReviewRow | null
  onClose: () => void
  onDone: (err: string | null) => void
}) {
  const { t } = useTranslation()
  const hm = t.hrModule
  const editing = review != null
  const [driverId, setDriverId] = useState(review?.driver_id ?? drivers[0]?.id ?? "")
  const [reviewPeriod, setReviewPeriod] = useState(review?.review_period ?? `${new Date().getFullYear()}-H1`)
  const [reviewDate, setReviewDate] = useState(review?.review_date ?? new Date().toISOString().slice(0, 10))
  const [attendanceScore, setAttendanceScore] = useState("")
  const [violationsScore, setViolationsScore] = useState("")
  const [platformKpiScore, setPlatformKpiScore] = useState("")
  const [overallScore, setOverallScore] = useState(
    review?.overall_score != null ? String(review.overall_score) : ""
  )
  const [strengths, setStrengths] = useState("")
  const [improvements, setImprovements] = useState("")
  const [goals, setGoals] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    const period = reviewPeriod.trim()
    if (!driverId) return onDone(hm.errDriverRequired)
    const att = numOrNull(attendanceScore)
    const vio = numOrNull(violationsScore)
    const kpi = numOrNull(platformKpiScore)
    const overall = numOrNull(overallScore)
    if (
      (attendanceScore.trim() !== "" && att === null) ||
      (violationsScore.trim() !== "" && vio === null) ||
      (platformKpiScore.trim() !== "" && kpi === null) ||
      (overallScore.trim() !== "" && overall === null)
    ) {
      return onDone(t.common.invalidInput)
    }
    setBusy(true)
    const res = await upsertPerformanceReview({
      ...(editing ? { id: review.id } : {}),
      driver_id: driverId,
      review_period: period,
      review_date: reviewDate,
      attendance_score: att,
      violations_score: vio,
      platform_kpi_score: kpi,
      overall_score: overall,
      strengths: strengths || null,
      improvements: improvements || null,
      goals: goals || null,
    })
    setBusy(false)
    onDone(res.success ? null : res.error ?? "Error")
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? hm.editReview : hm.addReview}</DialogTitle>
          <DialogDescription>{hm.addReviewDesc}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t.nav.drivers} *</Label>
              <Select value={driverId} onValueChange={setDriverId} disabled={editing}>
                <SelectTrigger className="w-full"><SelectValue placeholder={t.nav.drivers} /></SelectTrigger>
                <SelectContent>
                  {drivers.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.full_name_ar ?? "—"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{hm.fieldReviewPeriod} *</Label>
              <Input dir="ltr" value={reviewPeriod} onChange={(e) => setReviewPeriod(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{hm.fieldReviewDate} *</Label>
              <Input dir="ltr" type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{hm.fieldOverallScore}</Label>
              <Input dir="ltr" type="number" min="0" max="100" step="0.1" value={overallScore} onChange={(e) => setOverallScore(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>{hm.fieldAttendanceScore}</Label>
              <Input dir="ltr" type="number" min="0" max="100" value={attendanceScore} onChange={(e) => setAttendanceScore(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{hm.fieldViolationsScore}</Label>
              <Input dir="ltr" type="number" min="0" max="100" value={violationsScore} onChange={(e) => setViolationsScore(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{hm.fieldPlatformKpiScore}</Label>
              <Input dir="ltr" type="number" min="0" max="100" value={platformKpiScore} onChange={(e) => setPlatformKpiScore(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{hm.fieldStrengths}</Label>
            <Textarea value={strengths} onChange={(e) => setStrengths(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>{hm.fieldImprovements}</Label>
            <Textarea value={improvements} onChange={(e) => setImprovements(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>{hm.fieldGoals}</Label>
            <Textarea value={goals} onChange={(e) => setGoals(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t.common.cancel}</Button>
          <Button onClick={submit} disabled={busy || !driverId}>{t.common.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Public holiday upsert ────────────────────────────────────────────────────

export function HolidayDialog({
  open,
  holiday,
  onClose,
  onDone,
}: {
  open: boolean
  holiday: HolidayRow | null
  onClose: () => void
  onDone: (err: string | null) => void
}) {
  const { t } = useTranslation()
  const hm = t.hrModule
  const editing = holiday != null
  const [nameAr, setNameAr] = useState(holiday?.name_ar ?? "")
  const [nameEn, setNameEn] = useState(holiday?.name_en ?? "")
  const [holidayDate, setHolidayDate] = useState(holiday?.holiday_date ?? new Date().toISOString().slice(0, 10))
  const [duration, setDuration] = useState(holiday?.duration_days != null ? String(holiday.duration_days) : "1")
  const [calendarType, setCalendarType] = useState<(typeof CALENDAR_TYPES)[number]>(
    (holiday?.calendar_type as (typeof CALENDAR_TYPES)[number]) ?? "gregorian"
  )
  const [recurring, setRecurring] = useState(holiday?.is_recurring ?? false)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const name = nameAr.trim()
    if (name.length < 2) return onDone(hm.errNameRequired)
    const dur = Number(duration)
    if (!Number.isInteger(dur) || dur < 1 || dur > 30) return onDone(t.common.invalidInput)
    setBusy(true)
    const res = await upsertHoliday({
      ...(editing ? { id: holiday.id } : {}),
      name_ar: name,
      name_en: nameEn || null,
      holiday_date: holidayDate,
      duration_days: dur,
      calendar_type: calendarType,
      is_recurring: recurring,
    })
    setBusy(false)
    onDone(res.success ? null : res.error ?? "Error")
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? hm.editHoliday : hm.addHoliday}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>{hm.fieldNameAr} *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>{hm.fieldNameEn}</Label>
            <Input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{hm.fieldHolidayDate} *</Label>
              <Input dir="ltr" type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{hm.fieldDuration}</Label>
              <Input dir="ltr" type="number" min="1" max="30" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 items-center">
            <div className="grid gap-1.5">
              <Label>{hm.fieldCalendarType}</Label>
              <Select value={calendarType} onValueChange={(v) => setCalendarType(v as (typeof CALENDAR_TYPES)[number])}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CALENDAR_TYPES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={recurring} onCheckedChange={(v) => setRecurring(v === true)} />
              {hm.fieldRecurring}
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t.common.cancel}</Button>
          <Button onClick={submit} disabled={busy}>{t.common.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
