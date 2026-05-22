import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Clipboard, RefreshCw, Search, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

type AgentRecovery = {
  agent_display: string;
  agent_id: string | null;
  total_to_recover: number | string;
  emailed: number | string;
  responded: number | string;
  not_yet_emailed: number | string;
};

type PolicyRecovery = {
  policy_id: string;
  agent_id: string | null;
  client_name: string | null;
  carrier_name: string | null;
  policy_number: string | null;
  effective_date: string | null;
  recovery_email_sent_at: string | null;
  recovery_email_count: number | null;
  recovery_response_received_at: string | null;
  recovery_status: string | null;
  face_amount: number | null;
  annual_premium: number | null;
  agent_raw: string | null;
  recovery_state: string;
};

function asNum(v: number | string | null | undefined) {
  return Number(v ?? 0);
}

function recoveryText(policy: PolicyRecovery) {
  return [
    `Need policy data for ${policy.client_name ?? "client"} (${policy.carrier_name ?? "carrier unknown"}).`,
    `Policy number: ${policy.policy_number ?? "missing"}.`,
    `Effective date: ${policy.effective_date ? format(new Date(policy.effective_date), "MMM d, yyyy") : "missing"}.`,
    "Reply with the policy number, annual premium, and face amount. If this is not your policy, reply NOT MINE.",
    "If premium/face stay missing, this commission stays out of counted AP.",
  ].join("\n");
}

async function copy(text: string) {
  await navigator.clipboard.writeText(text);
  toast.success("Recovery text copied");
}

export default function CommissionRecovery() {
  const { data: agents, isLoading: loadingAgents, refetch: refetchAgents, isRefetching: refetchingAgents } = useQuery({
    queryKey: ["commission_recovery_by_agent"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_commission_recovery_by_agent")
        .select("*")
        .order("total_to_recover", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AgentRecovery[];
    },
  });

  const { data: policies, isLoading: loadingPolicies, refetch: refetchPolicies } = useQuery({
    queryKey: ["commission_recovery_status"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_commission_recovery_status")
        .select("*")
        .order("effective_date", { ascending: false, nullsFirst: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as PolicyRecovery[];
    },
  });

  const totals = useMemo(() => {
    const rows = agents ?? [];
    return {
      total: rows.reduce((sum, row) => sum + asNum(row.total_to_recover), 0),
      emailed: rows.reduce((sum, row) => sum + asNum(row.emailed), 0),
      responded: rows.reduce((sum, row) => sum + asNum(row.responded), 0),
      notYet: rows.reduce((sum, row) => sum + asNum(row.not_yet_emailed), 0),
    };
  }, [agents]);

  const refetchAll = () => {
    refetchAgents();
    refetchPolicies();
  };

  return (
    <div className="min-h-screen p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <PageHeader
        accent="emerald"
        eyebrow="Admin · CFO"
        eyebrowIcon={<Wallet className="h-3 w-3" />}
        title="Commission Recovery"
        subtitle="Missing premium, face amount, or policy number. Ghost AP stays out of real AP until recovered."
        actions={
          <Button variant="outline" size="sm" onClick={refetchAll} disabled={refetchingAgents}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refetchingAgents ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Policies to recover" value={totals.total} tone="text-rose-300" />
        <Metric label="Not yet emailed" value={totals.notYet} tone="text-amber-300" />
        <Metric label="Emailed" value={totals.emailed} tone="text-cyan-300" />
        <Metric label="Responded" value={totals.responded} tone="text-emerald-300" />
      </div>

      <Card className="border-amber-500/25 bg-amber-500/[0.03]">
        <CardContent className="p-4 text-sm text-slate-300">
          This page is deliberately honest: it does not count missing premium/face as real AP, and it does not auto-email agents without Sam choosing to send. The recovery text buttons copy the exact request for manual send or for the next email-loop edge function.
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4" /> Per-agent queue
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loadingAgents ? <Skeleton className="h-64 w-full" /> : (agents ?? []).length === 0 ? (
              <div className="text-sm text-slate-500">No recovery rows loaded. Source checked: v_commission_recovery_by_agent.</div>
            ) : (agents ?? []).map((row) => (
              <div key={`${row.agent_display}-${row.agent_id ?? "null"}`} className="rounded-md border border-white/10 bg-white/[0.025] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium truncate">{row.agent_display}</div>
                  <Badge variant="outline">{asNum(row.total_to_recover)} policies</Badge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-400">
                  <span>{asNum(row.not_yet_emailed)} not emailed</span>
                  <span>{asNum(row.emailed)} emailed</span>
                  <span>{asNum(row.responded)} replied</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clipboard className="h-4 w-4" /> Missing-policy rows
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingPolicies ? <div className="p-4"><Skeleton className="h-80 w-full" /></div> : (policies ?? []).length === 0 ? (
              <div className="p-4 text-sm text-slate-500">No missing policy rows loaded. Source checked: v_commission_recovery_status.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white/[0.03] text-xs text-slate-400">
                    <tr>
                      <th className="text-left p-3">Client</th>
                      <th className="text-left p-3">Carrier</th>
                      <th className="text-left p-3">Policy</th>
                      <th className="text-left p-3">Agent raw</th>
                      <th className="text-left p-3">State</th>
                      <th className="text-left p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(policies ?? []).map((policy) => (
                      <tr key={policy.policy_id} className="border-t border-white/5">
                        <td className="p-3">{policy.client_name ?? "—"}</td>
                        <td className="p-3">{policy.carrier_name ?? "—"}</td>
                        <td className="p-3">
                          <div>{policy.policy_number ?? <span className="text-rose-300">missing</span>}</div>
                          <div className="text-xs text-slate-500">
                            {policy.effective_date ? format(new Date(policy.effective_date), "MMM d") : "no effective date"}
                          </div>
                        </td>
                        <td className="p-3 text-xs text-slate-500">{policy.agent_raw ?? "—"}</td>
                        <td className="p-3"><Badge variant="outline">{policy.recovery_state}</Badge></td>
                        <td className="p-3">
                          <Button size="sm" variant="outline" onClick={() => copy(recoveryText(policy))}>
                            Copy request
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className={`text-3xl font-bold tabular-nums ${tone}`}>{value}</div>
        <div className="text-xs text-slate-400 mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}
