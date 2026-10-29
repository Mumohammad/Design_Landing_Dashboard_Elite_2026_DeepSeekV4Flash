"use client";

import { LocalizedText } from "@/components/localized-text"
import { useState } from "react";

import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { emitDriverChanged } from "@/lib/drivers/driver-events";
import { removeDriverDocument } from "@/app/actions/drivers/documents";
import { useTranslation } from "@/hooks/use-translation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DocumentsDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  /** Row to delete: label is shown for confirmation. */
  document: { id: string; docType: string; label: string; workflowVersion:number; profileVersion:number } | null;
  onDeleted?: () => void;
};

export function DocumentsDeleteDialog({
  open,
  onOpenChange,
  driverId,
  document,
  onDeleted,
}: DocumentsDeleteDialogProps) {
  const {locale}=useTranslation();
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!document || deleting) return;
    setDeleting(true);
    try {
      const result=await removeDriverDocument({driverId,documentId:document.id,expectedDriverVersion:document.profileVersion,expectedVersion:document.workflowVersion});
      if(!result.ok){toast.error(locale==="ar"?result.errorAr:result.error);return}

      toast.success(locale==="ar"?"تمت أرشفة المستند مع الاحتفاظ بالملف.":"Document retired; the file is retained.");
      onOpenChange(false);
      onDeleted?.();
      emitDriverChanged({ driverId, action: "document" });
    } catch {
      toast.error(locale==="ar"?"تعذر تأكيد إزالة المستند. أعد تحميل الملف قبل المحاولة مجدداً.":"Document removal could not be confirmed. Reload the profile before retrying.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!deleting) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle><LocalizedText text="Delete document" /></DialogTitle>
          <DialogDescription><LocalizedText text="This removes" /><span className="font-medium text-foreground">{document?.label}</span><LocalizedText text="from the driver's profile. The record is kept in the archive (soft delete)." /></DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}><LocalizedText text="Cancel" /></Button>
          <Button
            variant="destructive"
            onClick={() => void confirmDelete()}
            disabled={deleting || !document}
          >
            {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}<LocalizedText text="Delete" /></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DocumentsDeleteDialog;
