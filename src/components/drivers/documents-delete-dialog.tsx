"use client";

import { useState } from "react";

import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

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

type DocumentsDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  /** Row to delete: label is shown for confirmation. */
  document: { id: string; docType: string; label: string } | null;
  onDeleted?: () => void;
};

export function DocumentsDeleteDialog({
  open,
  onOpenChange,
  driverId,
  document,
  onDeleted,
}: DocumentsDeleteDialogProps) {
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!document || deleting) return;
    setDeleting(true);
    try {
      const supabase = createClient();
      // Soft delete (deleted_at filter) — no ad-hoc schema changes.
      const { error } = await supabase
        .from("driver_documents")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", document.id);
      if (error) throw error;

      toast.success(`“${document.label}” deleted`);
      onOpenChange(false);
      onDeleted?.();
      emitDriverChanged({ driverId, action: "document" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete document";
      toast.error(message);
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
          <DialogTitle>Delete document</DialogTitle>
          <DialogDescription>
            This removes <span className="font-medium text-foreground">{document?.label}</span> from
            the driver&apos;s profile. The record is kept in the archive (soft delete).
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirmDelete()}
            disabled={deleting || !document}
          >
            {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DocumentsDeleteDialog;
