import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { History, Clock, Search } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface QuoteLog {
  id: string;
  created_at: string;
  client_inputs: any;
  ranking_output: any;
  products_considered: any;
  products_excluded: any;
}

export default function QuoteHistory() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<QuoteLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("qe_quote_logs")
        .select("*")
        .eq("agent_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      setLogs((data as any) ?? []);
      setLoading(false);
    })();
  }, [user]);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <History className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Saved Quotes</h1>
          <p className="text-xs text-muted-foreground">Your recent quoting history</p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Search className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No quotes yet. Run your first quote to see history here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const inputs = log.client_inputs as any;
            const topResults = (log.ranking_output as any[]) ?? [];
            return (
              <Card key={log.id} className="hover:border-primary/30 transition-colors">
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      {inputs?.state ?? "—"} • Age {inputs?.age ?? "?"} • ${inputs?.faceAmount?.toLocaleString() ?? "?"} Face
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(log.created_at), "MMM d, yyyy h:mm a")}
                    </p>
                  </div>
                  <div className="text-right">
                    {topResults[0] && (
                      <p className="text-xs font-medium text-primary">
                        Top: {topResults[0].carrier} — {topResults[0].product}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      {(log.products_considered as any[])?.length ?? 0} eligible • {(log.products_excluded as any[])?.length ?? 0} excluded
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
