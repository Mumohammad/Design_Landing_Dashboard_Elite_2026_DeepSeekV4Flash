"use client";

import { useEffect, useMemo, useState } from "react";

import { FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { emitDriverChanged } from "@/lib/drivers/driver-events";
import {
  DRIVER_DOCUMENT_TYPE_LABELS,
  driverRequirements,
  type DriverDocumentType,
} from "@/lib/drivers/compliance";
import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

type DocumentUploadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  driverType: string;
  /** When provided (from the card panel), the type is locked to the requirement being uploaded. */
  defaultDocType?: DriverDocumentType | null;
  onUploaded?: () => void;
};

export function DocumentUploadDialog({
  open,
  onOpenChange,
  driverId,
  driverType,
  defaultDocType = null,
  onUploaded,
}: DocumentUploadDialogProps) {
  const supabase = createClient();

  const requirements = useMemo(() => driverRequirements(driverType), [driverType]);
  const allowedTypes = useMemo<DriverDocumentType[]>(() => {
    if (defaultDocType) return [defaultDocType];
    return requirements.map((requirement) => requirement.docType);
  }, [defaultDocType, requirements]);

  const [docType, setDocType] = useState<DriverDocumentType>(
    defaultDocType ?? requirements[0]?.docType ?? "national_id",
  );
  const [docNumber, setDocNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [existingPath, setExistingPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextType = defaultDocType ?? requirements[0]?.docType ?? "national_id";
    setDocType(nextType);
    setDocNumber("");
    setExpiryDate("");
    setFile(null);

    let cancelled = false;
    const loadExisting = async () => {
      const { data } = await supabase
        .from("driver_documents")
        .select("id, file_path")
        .eq("driver_id", driverId)
        .eq("doc_type", nextType)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setExistingPath((data?.file_path as string | null) ?? null);
    };
    void loadExisting();
    return () => {
      cancelled = true;
    };
  }, [open, driverId, defaultDocType, requirements, supabase]);

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

      const { error: upsertError } = await supabase.from("driver_documents").upsert(
        {
          driver_id: driverId,
          doc_type: docType,
          doc_number: docNumber.trim() || null,
          file_path: path,
          expiry_date: expiryDate || null,
        },
        { onConflict: "driver_id,doc_type" },
      );
      if (upsertError) throw upsertError;

      toast.success(`${DRIVER_DOCUMENT_TYPE_LABELS[docType].en} uploaded`);
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
          <Alert>
            <AlertTitle>Existing file will be replaced</AlertTitle>
            <AlertDescription>
              A {DRIVER_DOCUMENT_TYPE_LABELS[docType].en} file is already on record for this driver.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="doc-type">Document type</Label>
            <Select
              value={docType}
              onValueChange={(value) => setDocType(value as DriverDocumentType)}
              disabled={allowedTypes.length <= 1}
            >
              <SelectTrigger id="doc-type">
                <SelectValue placeholder="Select document type" />
              </SelectTrigger>
              <SelectContent>
                {allowedTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {DRIVER_DOCUMENT_TYPE_LABELS[type].en} · {DRIVER_DOCUMENT_TYPE_LABELS[type].ar}
                  </SelectItem>
                ))}
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
