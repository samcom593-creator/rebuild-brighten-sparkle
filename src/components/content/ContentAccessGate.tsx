import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * ContentAccessGate — invite-only door for /dashboard/content (MP-CONTENT-2).
 *
 * Admins pass. Anyone else passes only while their login email is listed and
 * un-revoked in public.content_access, which Sam manages from the page itself.
 * The same predicate (content_can_access) backs the RLS on content_queue and
 * the private clip bucket, so this gate is a courtesy screen, not the lock:
 * a revoked person who keeps the URL gets an empty page and no signed URLs.
 */
export function ContentAccessGate({ children }: { children: ReactNode }) {
  const { isAdmin, user } = useAuth();
  const access = useQuery({
    queryKey: ["content_can_access", user?.id ?? "anon"],
    enabled: !isAdmin && Boolean(user),
    staleTime: 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("content_can_access");
      if (error) throw error;
      return Boolean(data);
    },
  });

  if (isAdmin || access.data === true) return <>{children}</>;
  if (access.isLoading) return <div className="mx-auto max-w-2xl space-y-3 p-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-24 w-full" /></div>;

  return (
    <div className="mx-auto max-w-md p-6">
      <Card>
        <CardContent className="space-y-2 p-6 text-center">
          <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="font-semibold">Content is invite-only</p>
          <p className="text-sm text-muted-foreground">
            {access.isError
              ? "Access could not be checked. Reload, and if it repeats tell Sam."
              : `Ask Sam to add ${user?.email ?? "your email"} on the Content page. Access can be granted and removed in one tap.`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
