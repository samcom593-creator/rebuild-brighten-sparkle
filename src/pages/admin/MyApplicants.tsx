import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import {
  Users,
  Search,
  Phone,
  Mail,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Loader2,
  ArrowRight,
  Copy,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Manager self-serve view of recruits they're attributed on.
 *
 * Sam-feedback 2026-06-03: managers should not text Sam to find their recruits.
 * This page lists every applicant where referral_manager_id = current user's
 * agent id, sorted by urgency (oldest uncontacted first).
 */

type Row = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  state: string | null;
  license_status: string | null;
  created_at: string;
  contacted_at: string | null;
  course_purchased_at: string | null;
  license_approved_at: string | null;
  next_step_stage_key: string | null;
};

const STAGE_LABEL: Record<string, string> = {
  applied: "Applied",
  contacted: "Contacted",
  started_prelicense: "In prelicensing",
  finished_prelicense: "Finished prelicensing",
  passed_exam: "Passed exam",
  closed_lost: "Closed (lost)",
};

const STAGE_COLOR: Record<string, string> = {
  applied: "bg-amber-600/15 text-amber-300 border-amber-600/40",
  contacted: "bg-blue-600/15 text-blue-300 border-blue-600/40",
  started_prelicense: "bg-purple-600/15 text-purple-300 border-purple-600/40",
  finished_prelicense: "bg-slate-500/15 text-cyan-300 border-cyan-600/40",
  passed_exam: "bg-emerald-600/15 text-emerald-400 border-emerald-600/40",
  closed_lost: "bg-zinc-600/15 text-zinc-400 border-zinc-600/40",
};

function hoursSince(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60));
}

export default function MyApplicants() {
  usePageTitle("My Applicants · APEX Financial");
  const { user } = useAuth();
  const [search, setSearch] = useState("");

  // First resolve the current user's agent id
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
    queryKey: ["myApplicants", myAgent?.id],
    enabled: !!myAgent?.id,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select(
          "id, first_name, last_name, phone, email, state, license_status, created_at, contacted_at, course_purchased_at, license_approved_at, next_step_stage_key",
        )
        .eq("referral_manager_id", myAgent!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  // Manager referral link
  const refSlug = (myAgent?.display_name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const referralUrl = refSlug
    ? `https://apex-financial.org/apply?ref=${refSlug}`
    : "";

  const copyLink = () => {
    if (!referralUrl) return;
    navigator.clipboard.writeText(referralUrl);
    toast.success("Referral link copied");
  };

  const list = rows ?? [];
  const filtered = search
    ? list.filter((r) =>
        `${r.first_name} ${r.last_name} ${r.phone ?? ""} ${r.email ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
    : list;

  const uncontacted = list.filter((r) => !r.contacted_at).length;
  const inPrelicensing = list.filter(
    (r) => r.course_purchased_at && !r.license_approved_at,
  ).length;
  const licensed = list.filter((r) => r.license_approved_at).length;

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-5xl p-6 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="container mx-auto max-w-5xl p-4 sm:p-6 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6 text-primary" /> My Applicants
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Everyone you referred. Sorted by newest first.
            </p>
          </div>
          <Link to="/admin/add-referral">
            <Button>
              + Add Referral Manually <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>

        {/* Referral link */}
        {referralUrl ? (
          <Card>
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Your referral link</p>
                <code className="text-sm font-mono text-primary truncate block">{referralUrl}</code>
              </div>
              <Button variant="outline" size="sm" onClick={copyLink}>
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="Total referred" value={list.length} />
          <StatTile label="Uncontacted" value={uncontacted} variant={uncontacted > 0 ? "warning" : "default"} />
          <StatTile label="In prelicensing" value={inPrelicensing} />
          <StatTile label="Licensed" value={licensed} variant="success" />
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by name, phone, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10"
          />
        </div>

        {/* Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Pipeline ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[640px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background z-10 border-b">
                  <tr className="text-xs uppercase text-muted-foreground">
                    <th className="text-left p-3">Applicant</th>
                    <th className="text-left p-3">Stage</th>
                    <th className="text-right p-3">Applied</th>
                    <th className="text-right p-3 hidden sm:table-cell">Contacted</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const hrs = hoursSince(r.created_at);
                    const overdue = !r.contacted_at && hrs >= 24;
                    const stage = r.next_step_stage_key ?? "applied";
                    return (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="p-3">
                          <div className="font-medium flex items-center gap-2 flex-wrap">
                            {r.first_name} {r.last_name}
                            {overdue ? (
                              <Badge variant="outline" className="border-rose-600/40 text-rose-300 text-[10px]">
                                <AlertTriangle className="h-3 w-3 mr-1" /> {hrs}h, no call
                              </Badge>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            {r.phone ? (
                              <a href={`tel:${r.phone}`} className="flex items-center gap-1 hover:text-primary">
                                <Phone className="h-3 w-3" /> {r.phone}
                              </a>
                            ) : null}
                            {r.email ? (
                              <a href={`mailto:${r.email}`} className="flex items-center gap-1 hover:text-primary">
                                <Mail className="h-3 w-3" /> {r.email}
                              </a>
                            ) : null}
                            {r.state ? <span>{r.state}</span> : null}
                            <span className="uppercase text-[10px] tracking-wider">{r.license_status}</span>
                          </div>
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" className={STAGE_COLOR[stage] ?? STAGE_COLOR.applied}>
                            {STAGE_LABEL[stage] ?? stage}
                          </Badge>
                        </td>
                        <td className="p-3 text-right tabular-nums text-xs text-muted-foreground">
                          {hrs}h ago
                        </td>
                        <td className="p-3 text-right tabular-nums text-xs text-muted-foreground hidden sm:table-cell">
                          {r.contacted_at ? (
                            <span className="text-emerald-300">
                              <CheckCircle2 className="inline h-3 w-3 mr-1" />
                              {hoursSince(r.contacted_at)}h
                            </span>
                          ) : (
                            <span className="text-rose-300">
                              <Clock className="inline h-3 w-3 mr-1" /> never
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-muted-foreground">
                        {search ? "No matches." : "No referrals yet. Share your link above."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function StatTile({
  label,
  value,
  variant = "default",
}: {
  label: string;
  value: number;
  variant?: "default" | "warning" | "success";
}) {
  const styles =
    variant === "warning"
      ? "border-amber-600/40 bg-amber-600/10"
      : variant === "success"
      ? "border-emerald-600/40 bg-emerald-600/10"
      : "border-border/40 bg-muted/20";
  return (
    <div className={`rounded-xl border ${styles} p-3 text-center`}>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}
