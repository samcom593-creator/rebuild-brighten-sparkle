import { Fragment, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AccessDeniedPanel } from "@/components/AccessDeniedPanel";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useSamPrivateAccess } from "@/hooks/useSamPrivateAccess";

export function SamOnlyRoute({ children }: { children: ReactNode }) {
  const { allowed, isChecking, isError, userId } = useSamPrivateAccess();
  const location = useLocation();
  if (isChecking) return <PageSkeleton fullScreen />;
  if (isError) {
    return (
      <section role="alert" className="mx-auto max-w-xl space-y-2 px-4 py-10">
        <h1 className="text-xl font-bold">Owner access could not be checked</h1>
        <p className="text-sm text-muted-foreground">Reload to check your session again.</p>
      </section>
    );
  }
  if (!allowed) return <AccessDeniedPanel pathname={location.pathname} requirement="Sam’s signed-in owner account" homeHref="/dashboard" />;
  return <Fragment key={userId}>{children}</Fragment>;
}
