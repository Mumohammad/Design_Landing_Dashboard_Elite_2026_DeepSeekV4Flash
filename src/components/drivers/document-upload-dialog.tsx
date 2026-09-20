"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { emitDriverChanged } from "@/lib/driver-events"
import { toast } from "sonner"
import { Loader2, Upload } from "lucide-react"

type DocumentUploadDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  driverId: string
  isAr: boolean
  onUploaded: () => void
}

const DOC_BUCKET = "driver-documents"
const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
])

const DOC_TYPES: { value: string; ar: string; en: string }[] = [
  { value: "iqama", ar: "إقامة", en: "Iqama" },
  { value: "passport", ar: "جواز سفر", en: "Passport" },
  { value: "driving_license", ar: "رخصة قيادة", en: "Driving License" },
  { value: "vehicle_license", ar: "رخصة مركبة", en: "Vehicle License" },
  { value: "medical_certificate", ar: "شهادة طبية", en: "Medical Certificate" },
  { value: "police_clearance", ar: "صحيفة جنائية", en: "Police Clearance" },
  { value: "employment_contract", ar: "عقد عمل", en: "Employment Contract" },
  { value: "bank_letter", ar: "خطاب بنكي", en: "Bank Letter" },
  { value: "photo", ar: "صورة", en: "Photo" },
  { value: "other", ar: "أخرى", en: "Other" },
]

const INITIAL_FORM = {
  docType: "",
  docNumber: "",
  issueDate: "",
  expiryDate: "",
  authority: "",
  notes: "",
}

export function DocumentUploadDialog({
  open,
  onOpenChange,
  driverId,
  isAr,
  onUploaded,
}: DocumentUploadDialogProps) {
  const [form, setForm] = useState(INITIAL_FORM)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  // Reset in the event handler (not an effect) so the next open starts fresh.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setForm(INITIAL_FORM)
      setFile(null)
    }
    onOpenChange(next)
  }

  const set = (key: keyof typeof INITIAL_FORM) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const submit = async () => {
    if (!form.docType) {
      toast.error(isAr ? "اختر نوع المستند" : "Select a document type")
      return
    }
    if (!file) {
      toast.error(isAr ? "اختر ملفًا للرفع" : "Choose a file to upload")
      return
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      toast.error(
        isAr ? "نوع الملف غير مدعوم (PDF أو صورة)" : "Unsupported file type (PDF or image only)",
      )
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error(isAr ? "الملف كبير جدًا (الحد الأقصى 10MB)" : "File is too large (max 10MB)")
      return
    }

    setUploading(true)
    try {
      const supabase = createClient()

      const { data: driverRow } = await supabase
        .from("drivers")
        .select("tenant_id")
        .eq("id", driverId)
        .maybeSingle()
      let tenantId = (driverRow?.tenant_id as string | undefined) ?? ""
      if (!tenantId) {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        tenantId = (session?.user?.user_metadata?.tenant_id as string | undefined) ?? ""
      }
      if (!tenantId) {
        toast.error(isAr ? "تعذر تحديد المستأجر" : "Could not resolve tenant")
        return
      }

      const safeName = file.name.replace(/[^\w.\-]+/g, "-").toLowerCase()
      const path = `${tenantId}/${driverId}/${form.docType}-${Date.now()}-${safeName}`
      const { error: uploadError } = await supabase.storage
        .from(DOC_BUCKET)
        .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type })
      if (uploadError) {
        toast.error(uploadError.message)
        return
      }

      const { error: insertError } = await supabase.from("driver_documents").insert({
        tenant_id: tenantId,
        driver_id: driverId,
        doc_type: form.docType,
        doc_number: form.docNumber.trim() || null,
        issue_date: form.issueDate || null,
        expiry_date: form.expiryDate || null,
        issuing_authority: form.authority.trim() || null,
        notes: form.notes.trim() || null,
        file_url: path,
        is_verified: false,
      })
      if (insertError) {
        console.error("Failed to register document:", insertError)
        toast.error(isAr ? "تم رفع الملف لكن فشل تسجيل المستند" : "File uploaded but registering the document failed")
        return
      }

      toast.success(isAr ? "تم رفع المستند" : "Document uploaded")
      emitDriverChanged(driverId)
      onUploaded()
      handleOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isAr ? "فشل الرفع" : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isAr ? "رفع مستند" : "Upload document"}</DialogTitle>
          <DialogDescription>
            {isAr
              ? "ارفع ملفًا وسجّل بياناته في ملف السائق"
              : "Upload a file and register its details on the driver's record"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{isAr ? "نوع المستند" : "Document type"} *</Label>
            <Select value={form.docType} onValueChange={(v) => set("docType")(v)}>
              <SelectTrigger>
                <SelectValue placeholder={isAr ? "اختر النوع…" : "Select type…"} />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {isAr ? t.ar : t.en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-number">{isAr ? "رقم المستند" : "Document number"}</Label>
            <Input
              id="doc-number"
              dir="ltr"
              value={form.docNumber}
              onChange={(e) => set("docNumber")(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-issue">{isAr ? "تاريخ الإصدار" : "Issue date"}</Label>
            <Input
              id="doc-issue"
              type="date"
              dir="ltr"
              value={form.issueDate}
              onChange={(e) => set("issueDate")(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-expiry">{isAr ? "تاريخ الانتهاء" : "Expiry date"}</Label>
            <Input
              id="doc-expiry"
              type="date"
              dir="ltr"
              value={form.expiryDate}
              onChange={(e) => set("expiryDate")(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="doc-authority">{isAr ? "جهة الإصدار" : "Issuing authority"}</Label>
            <Input
              id="doc-authority"
              value={form.authority}
              onChange={(e) => set("authority")(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="doc-file">{isAr ? "الملف" : "File"} *</Label>
            <Input
              id="doc-file"
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="truncate text-xs text-muted-foreground" dir="ltr">
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="doc-notes">{isAr ? "ملاحظات" : "Notes"}</Label>
            <Textarea
              id="doc-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes")(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={uploading}>
            {isAr ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={() => void submit()} disabled={uploading} className="gap-1.5">
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {isAr ? "رفع" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
