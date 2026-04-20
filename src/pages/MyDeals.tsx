import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DealEntryForm } from "@/components/deals/DealEntryForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, Plus } from "lucide-react";
import { format } from "date-fns";

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

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter max-w-5xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/20 to-primary/10 border border-emerald-500/30">
            <DollarSign className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">My Deals</h1>
            <p className="text-sm text-muted-foreground">Log policies you've sold — they roll into your daily production automatically</p>
          </div>
        </div>
        <Button onClick={() => setShowForm(s => !s)} variant={showForm ? "outline" : "default"}>
          <Plus className="h-4 w-4 mr-2" /> {showForm ? "Hide form" : "New deal"}
        </Button>
      </div>

      {showForm && <DealEntryForm onSaved={() => { setShowForm(false); refetch(); }} />}

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
                  <Badge variant="outline" className={statusColor(d.status)}>{d.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
