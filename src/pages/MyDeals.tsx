import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DealEntryForm } from "@/components/deals/DealEntryForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, Plus, CheckCircle2, AlertTriangle, Clock, ExternalLink, Zap } from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { AGENTLINK_LINKS, AGENTLINK_TAGLINE } from "@/lib/agentlink";

function SyncStatus({ deal }: { deal: any }) {
  if (deal.synced_to_insuracloud_at) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500" title={`Synced ${deal.synced_to_insuracloud_at}`}>
        <CheckCircle2 className="h-3 w-3" /> Synced
      </span>
    );
  }
  if (deal.insuracloud_sync_error) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-destructive" title={deal.insuracloud_sync_error}>
        <AlertTriangle className="h-3 w-3" /> Sync failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" title="Queued for AgentLink sync">
      <Clock className="h-3 w-3" /> Pending sync
    </span>
  );
}

const statusColor = (s: string) => {
  switch (s) {
    case "active": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "submitted": return "bg-primary/20 text-primary border-primary/30";
    case "draft": return "bg-muted text-muted-foreground";
    case "lapsed": case "cancelled": return "bg-destructive/20 text-destructive border-destructive/30";
    case "charged_back": return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    default: return "bg-muted";
  }
};

export default function MyDeals() {
  const { user } = useAuth();
  const [showForm, setShowForm] = useState(false);

  const { data: agentId } = useQuery({
    queryKey: ["my-agent-id", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase.from("agents").select("id").eq("user_id", user.id).maybeSingle();
      return data?.id ?? null;
    },
    enabled: !!user?.id,
  });

  const { data: deals = [], refetch } = useQuery({
    queryKey: ["deals", agentId],
    queryFn: async () => {
      if (!agentId) return [];
      const { data } = await supabase.from("deals" as any)
        .select("*, carrier:carriers(name)")
        .eq("agent_id", agentId)
        .order("effective_date", { ascending: false })
        .limit(100);
      return (data as any) || [];
    },
    enabled: !!agentId,
  });

  // Find the most recently-synced deal so we can show a "data freshness" line.
  const latestSync = (deals as any[]).reduce<string | null>((acc, d) => {
    const t = d.synced_to_insuracloud_at || d.created_at;
    if (!t) return acc;
    return !acc || t > acc ? t : acc;
  }, null);

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter max-w-5xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/20 to-primary/10 border border-emerald-500/30">
            <DollarSign className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">My Deals</h1>
            <p className="text-sm text-muted-foreground">
              Source: <span className="font-medium text-foreground">AgentLink</span> · syncs in under a minute
              {latestSync && <> · last sync {formatDistanceToNowStrict(new Date(latestSync), { addSuffix: true })}</>}
            </p>
          </div>
        </div>
        <Button asChild>
          <a href={AGENTLINK_LINKS.newDeal} target="_blank" rel="noopener noreferrer">
            <Zap className="h-4 w-4 mr-2" /> Submit in AgentLink <ExternalLink className="h-3 w-3 ml-1.5 opacity-70" />
          </a>
        </Button>
      </div>

      {/* Canonical-source banner — explains where deals actually live and
          why ApexLink is a viewer/operating-system over AgentLink. */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="text-sm font-semibold">AgentLink is the source of truth for deals.</p>
              <p className="text-xs text-muted-foreground mt-0.5">{AGENTLINK_TAGLINE}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="default">
              <a href={AGENTLINK_LINKS.newDeal} target="_blank" rel="noopener noreferrer">
                Submit a deal <ExternalLink className="h-3 w-3 ml-1.5" />
              </a>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm((s) => !s)}>
              {showForm ? "Hide backup form" : "Backup form"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {showForm && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Use the form below only if AgentLink is down. Anything entered here syncs forward; AgentLink is still
            the canonical book.
          </p>
          <DealEntryForm onSaved={() => { setShowForm(false); refetch(); }} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent deals ({deals.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {deals.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No deals logged yet. Click "New deal" to get started.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {deals.map((d: any) => (
                <div key={d.id} className="p-3 hover:bg-muted/20 grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-3 items-center">
                  <div>
                    <p className="font-medium text-sm">{d.client_first_name} {d.client_last_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.carrier?.name || "—"} · {d.product_sold} · #{d.policy_number}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(d.effective_date), "MMM d, yyyy")}
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm">${Number(d.annual_premium).toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">${Number(d.monthly_premium).toFixed(2)}/mo</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="outline" className={statusColor(d.status)}>{d.status}</Badge>
                    <SyncStatus deal={d} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
