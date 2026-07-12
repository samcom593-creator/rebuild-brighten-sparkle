import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
import { cn } from "@/lib/utils";

export type ConfirmTone = "danger" | "primary";

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
};

type PendingState = ConfirmOptions & {
  resolve: (ok: boolean) => void;
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);
  // Guard against double-resolve if the user closes the dialog via Escape
  // then the AlertDialogAction click races.
  const resolvedRef = useRef(false);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      resolvedRef.current = false;
      setPending({ ...opts, resolve });
    });
  }, []);

  const finish = useCallback(
    (ok: boolean) => {
      if (!pending) return;
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      pending.resolve(ok);
      setPending(null);
    },
    [pending],
  );

  const value = useMemo(() => confirm, [confirm]);

  const tone = pending?.tone ?? "primary";
  const confirmLabel = pending?.confirmText ?? "Confirm";
  const cancelLabel = pending?.cancelText ?? "Cancel";

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) finish(false);
        }}
      >
        {pending && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{pending.title}</AlertDialogTitle>
              {pending.description !== undefined && (
                <AlertDialogDescription asChild>
                  <div className="text-sm text-muted-foreground">{pending.description}</div>
                </AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => finish(false)}>{cancelLabel}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => finish(true)}
                className={cn(
                  tone === "danger" &&
                    "bg-rose-600 text-white hover:bg-rose-500 focus-visible:ring-rose-400",
                )}
              >
                {confirmLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used inside <ConfirmProvider>");
  }
  return ctx;
}
