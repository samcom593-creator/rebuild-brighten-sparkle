import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ConfirmOptions } from "@/hooks/useConfirm";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  options: ConfirmOptions;
  onFinish: (confirmed: boolean) => void;
}

export function ConfirmDialog({ options, onFinish }: ConfirmDialogProps) {
  const tone = options.tone ?? "primary";

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onFinish(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options.title}</AlertDialogTitle>
          {options.description !== undefined && (
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground">{options.description}</div>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onFinish(false)}>
            {options.cancelText ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onFinish(true)}
            className={cn(
              // 2026-08-23: rose-600/rose-500 is legible in both themes, so
              // this was a brand mismatch rather than a contrast bug — the
              // destructive token is tuned per theme (`1 65% 54%` light /
              // `1 60% 52%` dark) and is what every other destructive control
              // in the app uses.
              tone === "danger" &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive",
            )}
          >
            {options.confirmText ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
