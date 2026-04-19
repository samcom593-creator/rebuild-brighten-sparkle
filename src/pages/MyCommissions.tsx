import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { FinancesGrid } from "@/components/finances/FinancesGrid";
import { Wallet } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function MyCommissions() {
  const { user } = useAuth();
  const [agentId, setAgentId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id) {
        if (!cancelled) setAgentId(null);
        return;
      }
      const { data } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setAgentId(data?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return (
    <div className="space-y-6 page-enter">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-primary/10">
          <Wallet className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">My Commissions</h1>
          <p className="text-muted-foreground text-sm">
            Live earnings, payouts, carriers, and downline pulled from InsuraCloud.
          </p>
        </div>
      </div>

      {agentId === undefined ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : (
        <FinancesGrid agentId={agentId} />
      )}
    </div>
  );
}
