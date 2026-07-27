import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

const ConfirmDialog = lazy(() =>
  import("@/components/ui/confirm-dialog").then((module) => ({
    default: module.ConfirmDialog,
  })),
);

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

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && (
        <Suspense fallback={null}>
          <ConfirmDialog options={pending} onFinish={finish} />
        </Suspense>
      )}
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
