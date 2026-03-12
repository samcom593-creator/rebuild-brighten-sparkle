import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { QuoteEngineSidebar } from "./QuoteEngineSidebar";
import { Skeleton } from "@/components/ui/skeleton";

function Loader() {
  return (
    <div className="flex items-center justify-center p-8 w-full min-h-[50vh]">
      <div className="w-full max-w-md space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

export function QuoteEngineShell() {
  return (
    <ProtectedRoute>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <QuoteEngineSidebar />
        <main className="flex-1 overflow-y-auto">
          <Suspense fallback={<Loader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </ProtectedRoute>
  );
}
