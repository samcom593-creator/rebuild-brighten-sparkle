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
              tone === "danger" &&
                "bg-rose-600 text-white hover:bg-rose-500 focus-visible:ring-rose-400",
            )}
          >
            {options.confirmText ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
