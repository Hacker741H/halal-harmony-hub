import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  onConfirm: () => Promise<void> | void;
}

/**
 * Single convention for "are you sure" prompts, replacing window.confirm().
 * Radix's AlertDialogAction closes the dialog as soon as it's clicked, which
 * doesn't leave room for a mutation to run first -- confirm() stays open and
 * shows the confirm button as loading until onConfirm settles, then closes
 * on success or leaves the dialog open with the trigger re-enabled on
 * failure (the caller's own error toast/state covers what went wrong).
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [pending, setPending] = useState(false);

  const confirm = useCallback((next: ConfirmOptions) => setOptions(next), []);

  const handleConfirm = async () => {
    if (!options) return;
    setPending(true);
    try {
      await options.onConfirm();
      setOptions(null);
    } finally {
      setPending(false);
    }
  };

  const dialog = (
    <AlertDialog
      open={options !== null}
      onOpenChange={(open) => {
        if (!open && !pending) setOptions(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options?.title}</AlertDialogTitle>
          <AlertDialogDescription>{options?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{options?.cancelLabel ?? "Annuler"}</AlertDialogCancel>
          <Button
            type="button"
            variant={options?.variant === "destructive" ? "destructive" : "default"}
            loading={pending}
            onClick={handleConfirm}
          >
            {options?.confirmLabel ?? "Confirmer"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, dialog };
}
