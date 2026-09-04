import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertOctagon, ArrowRight, Clock, Crown, UserCheck, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useConfirm } from "@/hooks/useConfirm";

const SAM_DEFAULT_AGENT_ID = "7c3c5581-3544-437f-bfe2-91391afb217d";

type AppRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  created_at: string;
  contacted_at: string | null;
  last_contacted_at: string | null;
  status: string;
  assigned_agent_id: string | null;
  referral_source: string | null;
  notes: string | null;
};

type AgentLite = {
  id: string;
  display_name: string | null;
  status: string | null;
  is_inactive: boolean | null;
  is_deactivated: boolean | null;
};

export default function UnclaimedLeads() {
  const qc = useQueryClient();
  const askConfirm = useConfirm();
  const [filter, setFilter] = useState<"all" | "inactive_assignee" | "no_contact" | "unassigned">("all");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(100);

  const { data: apps, isLoading } = useQuery({
    queryKey: ["admin_unclaimed_apps"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id, first_name, last_name, email, phone, state, created_at, contacted_at, last_contacted_at, status, assigned_agent_id, referral_source, notes")
        .eq("status", "new")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as AppRow[];
    },
    refetchInterval: 300_000,
  });

  const { data: agents } = useQuery({
    queryKey: ["agents_lite"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select("id, display_name, status, is_inactive, is_deactivated")
        .order("display_name");
      if (error) throw error;
      return data as AgentLite[];
    },
    staleTime: 5 * 60_000,
  });

  const agentMap = useMemo(() => new Map((agents ?? []).map(a => [a.id, a.display_name])), [agents]);
  const inactiveAgentIds = useMemo(
    () => new Set(
      (agents ?? [])
        .filter(a =>
          a.is_inactive === true ||
          a.is_deactivated === true ||
          ["inactive", "terminated"].includes((a.status ?? "").toLowerCase())
        )
        .map(a => a.id)
    ),
    [agents]
  );

  const filtered = useMemo(() => {
    const rows = apps ?? [];
    let f = rows;
    if (filter === "inactive_assignee") f = f.filter(r => !!r.assigned_agent_id && inactiveAgentIds.has(r.assigned_agent_id));
    else if (filter === "no_contact") f = f.filter(r => !r.last_contacted_at); // real signal, not fake contacted_at
    else if (filter === "unassigned") f = f.filter(r => !r.assigned_agent_id);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      f = f.filter(r =>
        (r.first_name ?? "").toLowerCase().includes(q) ||
        (r.last_name ?? "").toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q) ||
        (r.state ?? "").toLowerCase().includes(q)
      );
    }
    return f;
  }, [apps, filter, inactiveAgentIds, search]);

  const reassign = useMutation({
    mutationFn: async ({ appId, toAgentId }: { appId: string; toAgentId: string }) => {
      const { error } = await (supabase as any).rpc("admin_reassign_application_owner", {
        p_application_id: appId,
        p_new_agent_id: toAgentId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Reassigned");
      qc.invalidateQueries({ queryKey: ["admin_unclaimed_apps"] });
    },
    onError: (e) => toast.error(`Reassign failed: ${String(e)}`),
  });

  const ageDays = (createdAt: string) => Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));

  const stats = useMemo(() => {
    const rows = apps ?? [];
    return {
      total: rows.length,
      inactive_assignee: rows.filter(r => !!r.assigned_agent_id && inactiveAgentIds.has(r.assigned_agent_id)).length,
      no_contact: rows.filter(r => !r.last_contacted_at).length,
      over_72h: rows.filter(r => ageDays(r.created_at) >= 3).length,
    };
  }, [apps, inactiveAgentIds]);

  return (
    <div className="min-h-screen p-4 lg:p-6 max-w-7xl mx-auto space-y-4 ops-surface ops-fade-in">
      <PageHeader
        accent="rose"
        eyebrow="Admin · Unclaimed"
        eyebrowIcon={<AlertOctagon className="h-3 w-3" />}
        title="Unclaimed Leads"
        subtitle="Every applicant currently in stage=new. The longer they sit cold, the deader the lead. Reassign in one click."
      />

      {/* Stat strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Total stage=new" value={stats.total} color="text-rose-300" />
        <StatTile label="Departed/inactive owner" value={stats.inactive_assignee} color="text-amber-300" />
        <StatTile label="No contact yet" value={stats.no_contact} color="text-rose-300" />
        <StatTile label="≥ 72h cold" value={stats.over_72h} color="text-rose-400" />
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row gap-3">
          <Input
            placeholder="Search name / email / state…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="md:max-w-sm"
          />
          <Select value={filter} onValueChange={v => setFilter(v as any)}>
            <SelectTrigger className="md:max-w-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stage=new</SelectItem>
              <SelectItem value="inactive_assignee">Departed/inactive assignee</SelectItem>
              <SelectItem value="no_contact">No contact yet</SelectItem>
              <SelectItem value="unassigned">No assignee at all</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["admin_unclaimed_apps"] })}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
        </CardContent>
      </Card>

      {/* Bulk action: reassign all visible to Sam */}
      {filtered.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <div className="text-sm">
              <strong>{filtered.length}</strong> visible.
              <span className="text-muted-foreground ml-2">
                Click "Reassign all → Sam" to take ownership of every visible row.
                Use with care: this rips them from their current assignee.
              </span>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                const ok = await askConfirm({
                  title: `Reassign ${filtered.length} app${filtered.length === 1 ? "" : "s"} to Samuel James?`,
                  description: "This rips the current assignee off every filtered application and stamps them to Sam.",
                  confirmText: `Reassign ${filtered.length}`,
                  tone: "danger",
                });
                if (!ok) return;
                for (const a of filtered) {
                  await reassign.mutateAsync({ appId: a.id, toAgentId: SAM_DEFAULT_AGENT_ID });
                }
                toast.success(`Reassigned ${filtered.length} apps to Sam`);
              }}
            ><Crown className="w-3.5 h-3.5 mr-1.5" /> Reassign all → Sam</Button>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="w-4 h-4" /> Oldest first
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6"><Skeleton className="h-40 w-full" /></div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No matches.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.03] text-muted-foreground text-xs">
                  <tr>
                    <th className="text-left p-3">Applicant</th>
                    <th className="text-left p-3">State</th>
                    <th className="text-left p-3">Source</th>
                    <th className="text-left p-3">Days</th>
                    <th className="text-left p-3">Routed to</th>
                    <th className="text-left p-3">Last contact</th>
                    <th className="text-left p-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, visibleCount).map(row => {
                    const days = ageDays(row.created_at);
                    const isKJ = row.assigned_agent_id === kjId;
                    const assigned = row.assigned_agent_id ? (agentMap.get(row.assigned_agent_id) ?? "—") : "(none)";
                    return (
                      <tr key={row.id} className="border-t border-border hover:bg-white/[0.02]">
                        <td className="p-3">
                          <div className="font-medium">{[row.first_name, row.last_name].filter(Boolean).join(" ") || "—"}</div>
                          <div className="text-xs text-slate-600 dark:text-slate-300">{row.email ?? "—"} · {row.phone ?? "—"}</div>
                        </td>
                        <td className="p-3">{row.state ?? "—"}</td>
                        <td className="p-3 text-xs text-muted-foreground">{row.referral_source ?? "—"}</td>
                        <td className="p-3 tabular-nums">
                          <Badge variant={days >= 7 ? "destructive" : days >= 3 ? "secondary" : "outline"}>{days}d</Badge>
                        </td>
                        <td className="p-3">
                          <span className={cn(isKJ && "text-amber-400 font-medium")}>{assigned}</span>
                        </td>
                        <td className="p-3 text-xs text-slate-600 dark:text-slate-300">
                          {row.last_contacted_at ? formatDistanceToNow(new Date(row.last_contacted_at), { addSuffix: true }) : <span className="text-rose-400">never</span>}
                        </td>
                        <td className="p-3">
                          {row.assigned_agent_id !== SAM_DEFAULT_AGENT_ID && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => reassign.mutate({ appId: row.id, toAgentId: SAM_DEFAULT_AGENT_ID })}
                              disabled={reassign.isPending}
                            ><Crown className="w-3 h-3 mr-1" /> → Sam</Button>
                          )}
                          {row.assigned_agent_id === SAM_DEFAULT_AGENT_ID && (
                            <Badge variant="secondary" className="text-emerald-300"><UserCheck className="w-3 h-3 mr-1" /> Sam</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length > visibleCount && (
                <div className="flex flex-wrap items-center justify-center gap-3 py-4 text-sm">
                  <span className="text-muted-foreground">Showing {visibleCount.toLocaleString()} of {filtered.length.toLocaleString()}</span>
                  <button type="button" onClick={() => setVisibleCount((n) => n + 200)} className="rounded-md border border-border bg-muted/40 px-4 py-1.5 font-medium text-foreground transition hover:bg-muted">Show more ({(filtered.length - visibleCount).toLocaleString()} hidden)</button>
                  <button type="button" onClick={() => setVisibleCount(filtered.length)} className="rounded-md px-3 py-1.5 font-medium text-primary transition hover:underline">Show all</button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-center text-xs text-muted-foreground pt-4 pb-8 italic">
        Hold the Standard. Average is the disease.
      </div>
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className={cn("text-3xl font-bold tabular-nums", color)}>{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}
