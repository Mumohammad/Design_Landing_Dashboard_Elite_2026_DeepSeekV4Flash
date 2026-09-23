"use client";

import { useEffect, useMemo, useState } from "react";

import { FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { OVERRIDABLE_REQUIREMENTS } from "@/lib/drivers/compliance";
import { emitDriverChanged } from "@/lib/drivers/driver-events";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Bilingual labels for the compliance document keys. The keys come from the
// compliance engine (OVERRIDABLE_REQUIREMENTS); unknown keys fall back to a
// humanized version of the key itself.
const DOC_TYPE_LABELS: Record<string, { en: string; ar: string }> = {
  identity: { en: "Identity document", ar: "الهوية" },
  driving_license: { en: "Driving license", ar: "رخصة القيادة" },
  health_certificate: { en: "Health certificate", ar: "الشهادة الصحية" },
  home_delivery_permit: { en: "Home delivery permit", ar: "تصريح التوصيل المنزلي" },
  ajeer_permit: { en: "Ajeer permit", ar: "تصريح أجير" },
};

function docTypeLabel(docType: string): { en: string; ar: string } {
  const known = DOC_TYPE_LABELS[docType];
  if (known) return known;
  return { en: docType.replace(/_/g, " "), ar: "" };
}

/**
 * Map compliance requirement keys onto the live driver_document_type enum.
 * 'identity' covers national ID (Saudi) / iqama (expat) — stored as 'iqama'
 * which is the enum's identity-document value.
 */
function complianceKeyToDocType(key: string): string {
  switch (key) {
    case "identity":
      return "iqama";
    case "driving_license":
      return "driving_license";
    case "health_certificate":
      return "medical_certificate";
    case "home_delivery_permit":
      return "home_delivery_permit";
    case "ajeer_permit":
      return "ajeer_permit";
    default:
      return "other";
  }
}

type DocumentUploadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  /** Kept for caller compatibility; document types are requirement keys, not driver-type derived. */
  driverType?: string;
  /** RTL flag passed by some callers; labels are bilingual so no branching needed. */
  isAr?: boolean;
  /** When provided (from the card panel), the type is locked to the requirement being uploaded. */
  defaultDocType?: string | null;
  onUploaded?: () => void;
};

export function DocumentUploadDialog({
  open,
  onOpenChange,
  driverId,
  defaultDocType = null,
  onUploaded,
}: DocumentUploadDialogProps) {
  const supabase = createClient();

  const allowedTypes = useMemo<string[]>(() => {
    if (defaultDocType) return [defaultDocType];
    return [...OVERRIDABLE_REQUIREMENTS];
  }, [defaultDocType]);

  const [docType, setDocType] = useState<string>(defaultDocType ?? allowedTypes[0] ?? "identity");
  const [docNumber, setDocNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [existingPath, setExistingPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextType = defaultDocType ?? allowedTypes[0] ?? "identity";
    setDocType(nextType);
    setDocNumber("");
    setExpiryDate("");
    setFile(null);

    let cancelled = false;
    const loadExisting = async () => {
      const { data } = await supabase
        .from("driver_documents")
        .select("id, file_url")
        .eq("driver_id", driverId)
        .eq("doc_type", complianceKeyToDocType(nextType))
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setExistingPath((data?.file_url as string | null) ?? null);
    };
    void loadExisting();
    return () => {
      cancelled = true;
    };
  }, [open, driverId, defaultDocType, allowedTypes, supabase]);

  const upload = async () => {
    if (uploading) return;
    if (!file) {
      toast.error("Choose a file to upload");
      return;
    }

    setUploading(true);
    try {
      const { data: driverRow, error: driverError } = await supabase
        .from("drivers")
        .select("tenant_id")
        .eq("id", driverId)
        .single();
      if (driverError) throw driverError;

      const tenantId = driverRow?.tenant_id as string | undefined;
      if (!tenantId) throw new Error("Driver tenant not found");

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${tenantId}/${driverId}/${docType}/${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("driver-documents")
        .upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (uploadError) throw uploadError;

      // Live schema shape: file_url (NOT NULL) carries the storage path, and
      // doc_type is the driver_document_type enum (compliance requirement keys
      // map onto it via complianceKeyToDocType). The (driver_id, doc_type)
      // pair has a unique partial index (061) — replace-then-soft-delete keeps
      // exactly one active row per pair (partial indexes cannot back onConflict).
      const storagePath = path;
      const { data: existingRow } = await supabase
        .from("driver_documents")
        .select("id")
        .eq("driver_id", driverId)
        .eq("doc_type", complianceKeyToDocType(docType))
        .is("deleted_at", null)
        .maybeSingle();
      if (existingRow) {
        const { error: softDeleteError } = await supabase
          .from("driver_documents")
          .update({ deleted_at: new Date().toISOString(), is_active: false })
          .eq("id", existingRow.id);
        if (softDeleteError) throw softDeleteError;
      }
      const { error: insertError } = await supabase.from("driver_documents").insert({
        driver_id: driverId,
        tenant_id: tenantId,
        doc_type: complianceKeyToDocType(docType),
        doc_number: docNumber.trim() || null,
        file_url: storagePath,
        file_size_bytes: file.size,
        mime_type: file.type || null,
        expiry_date: expiryDate || null,
      });
      if (insertError) throw insertError;

      toast.success(`${docTypeLabel(docType).en} uploaded`);
      onOpenChange(false);
      onUploaded?.();
      emitDriverChanged({ driverId, action: "document" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="size-5 text-primary" />
            Upload Document
          </DialogTitle>
          <DialogDescription>
            Upload a compliance document for this driver. Uploading the same type again replaces the
            previous file.
          </DialogDescription>
        </DialogHeader>

        {existingPath ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              Existing file will be replaced
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-300/80">
              A {docTypeLabel(docType).en} file is already on record for this driver.
            </p>
          </div>
        ) : null}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="doc-type">Document type</Label>
            <Select
              value={docType}
              onValueChange={setDocType}
              disabled={allowedTypes.length <= 1}
            >
              <SelectTrigger id="doc-type">
                <SelectValue placeholder="Select document type" />
              </SelectTrigger>
              <SelectContent>
                {allowedTypes.map((type) => {
                  const label = docTypeLabel(type);
                  return (
                    <SelectItem key={type} value={type}>
                      {label.en}
                      {label.ar ? ` · ${label.ar}` : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="doc-number">Document number (optional)</Label>
              <Input
                id="doc-number"
                value={docNumber}
                onChange={(event) => setDocNumber(event.target.value)}
                placeholder="e.g. 2456…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doc-expiry">Expiry date (optional)</Label>
              <Input
                id="doc-expiry"
                type="date"
                value={expiryDate}
                onChange={(event) => setExpiryDate(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="doc-file">File</Label>
            <Input
              id="doc-file"
              type="file"
              accept="image/*,application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
            Cancel
          </Button>
          <Button onClick={() => void upload()} disabled={uploading || !file}>
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
