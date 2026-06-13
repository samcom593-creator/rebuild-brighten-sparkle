import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  Phone,
  Inbox,
  Users,
  Search,
  ArrowRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

/**
 * Recruiting inbox — uncontacted-first queue across owners.
 *
 * PL-SAM-2026-06-03-001. v_recruiting_inbox already sorts the underlying rows
 * with the canonical urgency ladder (CRITICAL_48H_PLUS → overdue_24h → cooling
 * → fresh → contacted). RLS on the view is SECURITY INVOKER so each owner
 * (agent / manager / admin) sees only what they're authorized to act on.
 *
 * Live-polls every 60s. Mark Contacted updates applications.contacted_at —
 * the row's urgency flips to "contacted" on the next poll, dropping it off
 * the critical queue.
 */

type Urgency =
  | "CRITICAL_48H_PLUS"
  | "overdue_24h"
  | "cooling"
  | "fresh"
  | "contacted";

type InboxRow = {
  application_id: string;
  owner_agent_id: string | null;
  owner_name: string | null;
  applicant_name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  license_status: string | null;
  applied_at: string;
  hours_since_applied: number;
  contacted_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  urgency: Urgency;
  referral_source: string | null;
};

const URGENCY_ORDER: Record<Urgency, number> = {
  CRITICAL_48H_PLUS: 0,
  overdue_24h: 1,
  cooling: 2,
  fresh: 3,
  contacted: 4,
};

const URGENCY_LABEL: Record<Urgency, string> = {
  CRITICAL_48H_PLUS: "48h+ no contact",
  overdue_24h: "24h+ overdue",
  cooling: "cooling",
  fresh: "fresh",
  contacted: "contacted",
};

const URGENCY_BADGE: Record<Urgency, string> = {
  CRITICAL_48H_PLUS: "border-rose-600/50 text-rose-200 bg-rose-600/15",
  overdue_24h: "border-amber-500/50 text-amber-200 bg-amber-500/15",
  cooling: "border-slate-500/50 text-slate-200 bg-slate-500/15",
  fresh: "border-emerald-500/50 text-emerald-200 bg-emerald-500/15",
  contacted: "border-slate-600/40 text-slate-400 bg-slate-700/20",
};

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60));
}

export default function RecruitingInbox() {
  usePageTitle("Recruiting Inbox · APEX Financial");
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showContacted, setShowContacted] = useState(false);
  const [showAllOwners, setShowAllOwners] = useState(isAdmin);

  const { data: myAgent } = useQuery({
    queryKey: ["myAgentId", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("agents")
        .select("id, display_name")
        .eq("user_id", user.id)
        .maybeSingle();
      return data;
    },
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["recruitingInbox"],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_recruiting_inbox")
        .select("*");
      if (error) throw error;
      return (data ?? []) as InboxRow[];
    },
  });

  const markContacted = useMutation({
    mutationFn: async (applicationId: string) => {
      const { error } = await supabase
        .from("applications")
        .update({ contacted_at: new Date().toISOString() })
        .eq("id", applicationId);
      if (error) throw error;
    },
    onMutate: async (applicationId: string) => {
      await qc.cancelQueries({ queryKey: ["recruitingInbox"] });
      const prev = qc.getQueryData<InboxRow[]>(["recruitingInbox"]);
      qc.setQueryData<InboxRow[]>(["recruitingInbox"], (old) =>
        (old ?? []).map((r) =>
          r.application_id === applicationId
            ? { ...r, contacted_at: new Date().toISOString(), urgency: "contacted" as Urgency }
            : r,
        ),
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["recruitingInbox"], ctx.prev);
      toast.error("Couldn't mark contacted. Try again.");
    },
    onSuccess: () => {
      toast.success("Marked contacted");
    },
  });

  const filtered = useMemo<InboxRow[]>(() => {
    const list = rows ?? [];
    let f = list;
    if (!isAdmin || !showAllOwners) {
      f = myAgent?.id ? f.filter((r) => r.owner_agent_id === myAgent.id) : [];
    }
    if (!showContacted) f = f.filter((r) => r.urgency !== "contacted");
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      f = f.filter((r) =>
        `${r.applicant_name} ${r.phone ?? ""} ${r.email ?? ""} ${r.owner_name ?? ""} ${r.state ?? ""}`
          .toLowerCase()
          .includes(q),
      );
    }
    return [...f].sort((a, b) => {
      const u = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
      if (u !== 0) return u;
      return a.hours_since_applied < b.hours_since_applied ? 1 : -1;
    });
  }, [rows, isAdmin, showAllOwners, showContacted, search, myAgent?.id]);

  const counts = useMemo(() => {
    const list = filtered;
    return {
      total: list.length,
      critical: list.filter((r) => r.urgency === "CRITICAL_48H_PLUS").length,
      overdue: list.filter((r) => r.urgency === "overdue_24h").length,
      fresh: list.filter((r) => r.urgency === "fresh" || r.urgency === "cooling").length,
    };
  }, [filtered]);

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-6xl p-6 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Inbox className="h-6 w-6 text-primary" /> Recruiting Inbox
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Uncontacted first. Tap the row to call. Mark Contacted when you've reached them.
          </p>
        </div>
        <Link to="/admin/my-applicants">
          <Button variant="outline" size="sm">
            <Users className="h-4 w-4 mr-2" /> My Pipeline
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Total in queue" value={counts.total} />
        <StatTile label="48h+ critical" value={counts.critical} variant={counts.critical > 0 ? "danger" : "default"} />
        <StatTile label="24h+ overdue" value={counts.overdue} variant={counts.overdue > 0 ? "warning" : "default"} />
        <StatTile label="Fresh & cooling" value={counts.fresh} variant="success" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by name, phone, email, owner..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10"
          />
        </div>
        <Button
          variant={showContacted ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowContacted((v) => !v)}
        >
          {showContacted ? "Hide contacted" : "Show contacted"}
        </Button>
        {isAdmin ? (
          <Button
            variant={showAllOwners ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowAllOwners((v) => !v)}
          >
            {showAllOwners ? "All owners" : "My queue"}
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Queue ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[680px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background z-10 border-b">
                <tr className="text-xs uppercase text-muted-foreground">
                  <th className="text-left p-3">Applicant</th>
                  <th className="text-left p-3 hidden md:table-cell">Owner</th>
                  <th className="text-left p-3">Urgency</th>
                  <th className="text-right p-3">Applied</th>
                  <th className="text-right p-3 w-[160px]">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const contactedHrs = hoursSince(r.contacted_at);
                  return (
                    <tr key={r.application_id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-3">
                        <div className="font-medium">{r.applicant_name || "(no name)"}</div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-1">
                          {r.phone ? (
                            <a href={`tel:${r.phone}`} className="flex items-center gap-1 hover:text-primary">
                              <Phone className="h-3 w-3" /> {r.phone}
                            </a>
                          ) : null}
                          {r.email ? (
                            <a href={`mailto:${r.email}`} className="flex items-center gap-1 hover:text-primary truncate max-w-[220px]">
                              <Mail className="h-3 w-3" /> <span className="truncate">{r.email}</span>
                            </a>
                          ) : null}
                          {r.state ? <span>{r.state}</span> : null}
                          {r.license_status ? (
                            <span className="uppercase text-[10px] tracking-wider">{r.license_status}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="p-3 hidden md:table-cell text-xs text-muted-foreground">
                        {r.owner_name ?? "Unassigned"}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className={URGENCY_BADGE[r.urgency]}>
                          {r.urgency === "CRITICAL_48H_PLUS" ? (
                            <AlertTriangle className="h-3 w-3 mr-1" />
                          ) : r.urgency === "contacted" ? (
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                          ) : (
                            <Clock className="h-3 w-3 mr-1" />
                          )}
                          {URGENCY_LABEL[r.urgency]}
                        </Badge>
                      </td>
                      <td className="p-3 text-right tabular-nums text-xs text-muted-foreground">
                        {Math.round(r.hours_since_applied)}h ago
                      </td>
                      <td className="p-3 text-right">
                        {r.contacted_at ? (
                          <span className="text-xs text-emerald-300 inline-flex items-center">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            {contactedHrs}h ago
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="default"
                            disabled={markContacted.isPending && markContacted.variables === r.application_id}
                            onClick={() => markContacted.mutate(r.application_id)}
                          >
                            {markContacted.isPending && markContacted.variables === r.application_id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              "Mark Contacted"
                            )}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-muted-foreground">
                      {search
                        ? "No matches."
                        : showContacted
                        ? "Queue is clear. Hold the Standard."
                        : "Inbox zero. Every applicant has been contacted."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({
  label,
  value,
  variant = "default",
}: {
  label: string;
  value: number;
  variant?: "default" | "warning" | "success" | "danger";
}) {
  const cls =
    variant === "danger"
      ? "border-rose-600/40 text-rose-200"
      : variant === "warning"
      ? "border-amber-500/40 text-amber-200"
      : variant === "success"
      ? "border-emerald-500/40 text-emerald-200"
      : "border-border text-foreground";
  return (
    <div className={`rounded-md border bg-card/50 p-3 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
    </div>
  );
}
