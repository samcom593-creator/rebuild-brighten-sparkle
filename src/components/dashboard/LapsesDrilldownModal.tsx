import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format, formatDistanceToNowStrict } from "date-fns";

type LapseRow = {
  deal_id: string;
  policy_number: string | null;
  client_first_name: string | null;
  client_last_name: string | null;
  client_phone: string | null;
  face_amount: number | null;
  monthly_premium: number | null;
  annual_premium: number | null;
  effective_date: string | null;
  status: string | null;
  policy_status_standard: string | null;
  lapsed_at: string | null;
  agent_id: string | null;
  agent_name: string | null;
  carrier_name: string | null;
};

const fmtMoney = (n: number | null) =>
  n === null || n === undefined ? "—" : `$${Number(n).toLocaleString()}`;

interface LapsesDrilldownModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * PL-025: drilldown for the "Lapses · 30d" KPI on AgentCommandDashboard.
 * Reads v_lapses_30d_detail (live join of deals + agents + carriers) so
 * the modal renders policy, agent, carrier, face, premium, and lapsed_at
 * without a fan-out RPC.
 */
export function LapsesDrilldownModal({ open, onOpenChange }: LapsesDrilldownModalProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["v_lapses_30d_detail"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_lapses_30d_detail" as any)
        .select("*")
        .gte("lapsed_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
        .order("lapsed_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data as unknown as LapseRow[]) ?? [];
    },
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Lapses · last 30 days
            {data && (
              <Badge variant="outline" className="ml-2">{data.length} policies</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              // stable-key-allow:skeleton — fixed-length loader, no reorder
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No lapses in the last 30 days. Source: v_lapses_30d_detail.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {data.map((r) => (
              <div key={r.deal_id} className="py-3 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-start">
                <div className="min-w-0">
                  <p className="font-medium text-sm">
                    {r.client_first_name} {r.client_last_name}
                    {r.policy_number && (
                      <span className="ml-2 text-xs text-muted-foreground">#{r.policy_number}</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {r.carrier_name ?? "—"} · agent {r.agent_name ?? "unknown"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-mono">{fmtMoney(r.face_amount)} face</p>
                  <p className="text-[10px] text-muted-foreground">
                    {fmtMoney(r.annual_premium)}/yr · ${Number(r.monthly_premium ?? 0).toFixed(2)}/mo
                  </p>
                </div>
                <div className="text-right">
                  <Badge variant="outline" className="text-[10px]">
                    {r.policy_status_standard ?? r.status ?? "lapsed"}
                  </Badge>
                  {r.lapsed_at && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatDistanceToNowStrict(new Date(r.lapsed_at), { addSuffix: true })}
                    </p>
                  )}
                  {r.effective_date && (
                    <p className="text-[10px] text-muted-foreground">
                      effective {format(new Date(r.effective_date), "MMM d, yyyy")}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
