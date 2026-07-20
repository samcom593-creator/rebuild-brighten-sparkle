// TransferRequests · mirrors AgentLink's "Transfer Requests"
//
// Agents can request to move from one upline (manager) to another.
// Admins see all pending requests with approve/deny actions.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft, Send, Check, X, RefreshCw, Plus, Clock, CheckCircle2, XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface TransferRow {
  id: string;
  agent_id: string;
  agent_name: string | null;
  from_manager_name: string | null;
  to_manager_name: string | null;
  reason: string | null;
  status: string;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
}

interface ManagerOpt {
  id: string;
  display_name: string | null;
}

function relativeTime(iso: string): string {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

export default function TransferRequests() {
  usePageTitle("Transfer Requests · APEX");
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = (user as any)?.role === "admin" || (user as any)?.app_metadata?.role === "admin";

  const [showForm, setShowForm] = useState(false);
  const [toManagerId, setToManagerId] = useState("");
  const [reason, setReason] = useState("");

  const myAgent = useQuery({
    queryKey: ["my-agent-for-transfer", (user as any)?.id],
    enabled: !!(user as any)?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("agents" as any)
        .select("id, display_name, manager_id")
        .eq("user_id", (user as any).id)
        .maybeSingle();
      return data as any;
    },
  });

  const managers = useQuery({
    queryKey: ["transfer-managers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("agents" as any)
        .select("id, display_name")
        .order("display_name");
      return (data ?? []) as unknown as ManagerOpt[];
    },
  });

  const requests = useQuery({
    queryKey: ["transfer-requests"],
    queryFn: async () => {
      const { data } = await supabase
        .from("v_transfer_requests" as any)
        .select("*")
        .limit(100);
      return (data ?? []) as unknown as TransferRow[];
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!myAgent.data?.id) throw new Error("No agent profile linked to your account");
      if (!toManagerId) throw new Error("Choose a destination manager");
      const { error } = await supabase.from("transfer_requests" as any).insert({
        agent_id: myAgent.data.id,
        from_manager_id: myAgent.data.manager_id ?? null,
        to_manager_id: toManagerId,
        reason: reason.trim() || null,
        status: "pending",
        submitted_by: (user as any).id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transfer request submitted");
      setShowForm(false);
      setToManagerId(""); setReason("");
      qc.invalidateQueries({ queryKey: ["transfer-requests"] });
    },
    onError: (e: any) => toast.error(e?.message || "Submit failed"),
  });

  const decide = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "denied" }) => {
      const { error } = await supabase
        .from("transfer_requests" as any)
        .update({
          status: decision,
          decided_by: (user as any).id,
          decided_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Decision recorded");
      qc.invalidateQueries({ queryKey: ["transfer-requests"] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed"),
  });

  const pending = (requests.data ?? []).filter((r) => r.status === "pending");
  const decided = (requests.data ?? []).filter((r) => r.status !== "pending");

  // Hero metrics (Phoenix tz month window)
  const phoenixNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Phoenix" }));
  const monthStart = new Date(phoenixNow.getFullYear(), phoenixNow.getMonth(), 1).getTime();
  const all = requests.data ?? [];
  const approvedThisMonth = all.filter(
    (r) => r.status === "approved" && r.decided_at && new Date(r.decided_at).getTime() >= monthStart,
  ).length;
  const deniedThisMonth = all.filter(
    (r) => r.status === "denied" && r.decided_at && new Date(r.decided_at).getTime() >= monthStart,
  ).length;
  const decidedWithTime = all.filter((r) => r.decided_at && r.created_at && r.status !== "pending");
  const avgDecisionDays =
    decidedWithTime.length === 0
      ? null
      : decidedWithTime.reduce(
          (acc, r) =>
            acc + (new Date(r.decided_at as string).getTime() - new Date(r.created_at).getTime()) / 86_400_000,
          0,
        ) / decidedWithTime.length;

  const statusBadge = (s: string) => {
    if (s === "approved") return <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"><CheckCircle2 className="h-3 w-3 mr-1" />Approved</Badge>;
    if (s === "denied")   return <Badge className="bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30"><XCircle className="h-3 w-3 mr-1" />Denied</Badge>;
    if (s === "withdrawn")return <Badge variant="outline" className="text-slate-600">Withdrawn</Badge>;
    return <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
  };

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Contracting"
        eyebrowIcon={<ArrowRightLeft className="h-3 w-3" />}
        title="Transfer Requests"
        subtitle="Request to move under a new upline. Admins approve or deny."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-11">{pending.length} pending</Badge>
            <Button variant="outline" size="sm" onClick={() => requests.refetch()}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${requests.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Request Transfer
            </Button>
          </div>
        }
      />

      {/* PREMIUM HERO · v6 §31 */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="relative p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
              <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">CONTRACTING · LIVE</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">PENDING</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">
                {requests.isLoading ? "—" : pending.length}
              </p>
              <p className="text-[10px] text-white/40 tabular-nums">awaiting decision</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">APPROVED · MTD</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">
                {requests.isLoading ? "—" : approvedThisMonth}
              </p>
              <p className="text-[10px] text-white/40 tabular-nums">this month</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">DENIED · MTD</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">
                {requests.isLoading ? "—" : deniedThisMonth}
              </p>
              <p className="text-[10px] text-white/40 tabular-nums">this month</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">AVG DECISION</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">
                {avgDecisionDays === null ? "—" : avgDecisionDays.toFixed(1)}
              </p>
              <p className="text-[10px] text-white/40 tabular-nums">days to decide</p>
            </div>
          </div>
        </div>
      </div>

      {/* SUBMIT FORM */}
      {showForm && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-amber-500" />
              <p className="text-13 font-bold">New Transfer Request</p>
            </div>
            <div>
              <label className="text-11 text-muted-foreground mb-1 block">Move me to (manager)</label>
              <select
                className="w-full border border-border bg-background rounded-md px-3 py-2 text-13"
                value={toManagerId}
                onChange={(e) => setToManagerId(e.target.value)}
              >
                <option value="">— Choose —</option>
                {(managers.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.display_name ?? "Unnamed"}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-11 text-muted-foreground mb-1 block">Reason (optional)</label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why do you want this transfer?"
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" disabled={submit.isPending || !toManagerId} onClick={() => submit.mutate()}>
                <Send className="h-3.5 w-3.5 mr-1.5" />
                {submit.isPending ? "Submitting…" : "Submit Request"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* PENDING */}
      <section className="space-y-2">
        <h2 className="text-13 font-bold flex items-center gap-2"><Clock className="h-3.5 w-3.5 text-amber-500" /> Pending ({pending.length})</h2>
        {requests.isLoading ? (
          Array.from({ length: 2 }).map((_, i) => /* stable-key-allow:skeleton */ <Skeleton key={i} className="h-20" />)
        ) : pending.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-13 text-muted-foreground">Inbox is clear. Every upline is locked in.</CardContent></Card>
        ) : (
          pending.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-13 font-bold">
                    <span className="text-foreground/85">{r.agent_name ?? "Agent"}</span>
                    <span className="text-foreground/60 font-normal mx-2">·</span>
                    <span className="text-foreground/70 font-normal">{r.from_manager_name ?? "—"}</span>
                    <ArrowRightLeft className="inline h-3 w-3 mx-1.5 text-amber-500" />
                    <span className="text-emerald-700 dark:text-emerald-300">{r.to_manager_name ?? "—"}</span>
                  </p>
                  {r.reason && <p className="text-12 text-muted-foreground line-clamp-2 mt-0.5">{r.reason}</p>}
                  <p className="text-11 text-muted-foreground mt-0.5">{relativeTime(r.created_at)}</p>
                </div>
                {isAdmin && (
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-500/40"
                      onClick={() => decide.mutate({ id: r.id, decision: "approved" })}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" className="text-rose-700 border-rose-500/40"
                      onClick={() => decide.mutate({ id: r.id, decision: "denied" })}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </section>

      {/* DECIDED HISTORY */}
      <section className="space-y-2">
        <h2 className="text-13 font-bold flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> History ({decided.length})</h2>
        {decided.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-13 text-muted-foreground">No decisions yet. History will fill as approvals come in.</CardContent></Card>
        ) : (
          decided.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-13">
                    <span className="font-bold">{r.agent_name ?? "Agent"}</span>
                    <span className="text-foreground/60 mx-2">·</span>
                    <span className="text-foreground/70">{r.from_manager_name ?? "—"}</span>
                    <ArrowRightLeft className="inline h-3 w-3 mx-1.5 text-muted-foreground" />
                    <span className="text-foreground/85">{r.to_manager_name ?? "—"}</span>
                  </p>
                  <p className="text-11 text-muted-foreground mt-0.5">{relativeTime(r.created_at)}</p>
                </div>
                {statusBadge(r.status)}
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
