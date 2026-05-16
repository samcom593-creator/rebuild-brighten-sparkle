import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, AlertTriangle, Clock, ChevronRight, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "sonner";
import { format } from "date-fns";

interface ReferralRow {
  referral_id: string;
  status: string;
  referrer_agent_id: string;
  referrer_name: string | null;
  referrer_code: string | null;
  referred_name: string;
  referred_email: string | null;
  referred_phone: string | null;
  referred_state: string | null;
  referred_license: string | null;
  relationship: string | null;
  application_id: string | null;
  bonus_owed_cents: number | null;
  bonus_paid_cents: number | null;
  assigned_manager_id: string | null;
  next_action: string | null;
  next_action_due_at: string | null;
  days_since_submitted: number | null;
  created_at: string;
  contacted_at: string | null;
  booked_at: string | null;
  attended_at: string | null;
  onboarded_at: string | null;
  licensed_at: string | null;
  contracted_at: string | null;
  producing_at: string | null;
  is_duplicate: boolean | null;
  duplicate_of: string | null;
  triage_bucket: string;
}

const STATUS_OPTIONS = [
  "contacted",
  "booked",
  "attended",
  "no_show",
  "onboarded",
  "licensed",
  "contracted",
  "producing",
  "rejected",
  "lost",
] as const;

const BUCKET_LABELS: Record<string, string> = {
  overdue_contact: "Overdue first contact",
  stalled_after_contact: "Stalled after first contact",
  stalled_before_attend: "Booked but not attended",
  overdue_action: "Overdue follow-up",
  on_track: "On track",
};

const BUCKET_ORDER = [
  "overdue_contact",
  "stalled_after_contact",
  "stalled_before_attend",
  "overdue_action",
  "on_track",
];

export default function ReferralPipeline() {
  usePageTitle("Referral pipeline · APEX");
  const { isAdmin, isManager } = useAuth();
  const qc = useQueryClient();

  // Defense-in-depth: ProtectedRoute(requireAdmin allowManagers) already
  // gates the route. If a plain agent ever lands here via a bad link, we
  // render an Unauthorized state below — AFTER all hooks have been called.
  // Previously the unauth early-return came BEFORE useQuery/useMutation and
  // caused React's "Rendered fewer hooks than expected" crash whenever
  // role context flipped mid-session.
  const isAuthorized = isAdmin || isManager;

  const { data, isLoading } = useQuery({
    queryKey: ["referral-pipeline"],
    refetchInterval: 60_000,
    enabled: isAuthorized,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_referral_pipeline" as any)
        .select("*")
        .order("triage_bucket", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ReferralRow[];
    },
  });

  const advance = useMutation({
    mutationFn: async ({ id, status, note }: { id: string; status: string; note?: string }) => {
      const { error } = await (supabase.rpc as any)("advance_referral_status", {
        p_referral_id: id,
        p_new_status: status as any,
        p_note: note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["referral-pipeline"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't update"),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, ReferralRow[]>();
    for (const r of data ?? []) {
      if (!map.has(r.triage_bucket)) map.set(r.triage_bucket, []);
      map.get(r.triage_bucket)!.push(r);
    }
    return BUCKET_ORDER.map((b) => [b, map.get(b) ?? []] as const).filter(([, rows]) => rows.length > 0);
  }, [data]);

  if (!isAuthorized) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          The referral pipeline is for managers and admins. To see referrals you've
          submitted, go to <a href="/dashboard/referrals/mine" className="underline">My Referrals</a>.
        </div>
      </div>
    );
  }

  if (isLoading) return <PageLoadingSkeleton />;

  if (!data || data.length === 0) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" /> Referral pipeline
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center py-12 text-sm text-muted-foreground">
            No referrals yet. Agents can submit from{" "}
            <Link to="/dashboard/referrals/new" className="underline">/dashboard/referrals/new</Link>.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader
        accent="blue"
        eyebrow="Referrals · Pipeline"
        eyebrowIcon={<Users className="h-3 w-3" />}
        title="Referrals"
        subtitle={`${data.length} active referral${data.length === 1 ? "" : "s"} across your team's pipeline.`}
        actions={
          <Link to="/dashboard/referrals/new">
            <Button size="sm">Submit a referral</Button>
          </Link>
        }
      />

      {grouped.map(([bucket, rows]) => (
        <Card key={bucket}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {bucket.includes("overdue") || bucket.includes("stalled") ? (
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              ) : (
                <Clock className="h-4 w-4 text-muted-foreground" />
              )}
              {BUCKET_LABELS[bucket] ?? bucket}
              <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-0 divide-y divide-border/50 p-0">
            {rows.map((r) => (
              <div key={r.referral_id} className="flex items-center justify-between gap-3 p-3 sm:p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{r.referred_name}</span>
                    <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                    {r.is_duplicate && <Badge variant="destructive" className="text-[10px]">dup</Badge>}
                    {r.referred_license && (
                      <Badge variant="secondary" className="text-[10px]">{r.referred_license}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    From {r.referrer_name ?? "?"} · {r.referred_email ?? r.referred_phone ?? "no contact"} ·
                    {" "}
                    {r.days_since_submitted != null ? `${Math.floor(r.days_since_submitted)}d ago` : ""}
                    {r.next_action ? ` · next: ${r.next_action}` : ""}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      Advance <ChevronRight className="h-3 w-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {STATUS_OPTIONS.map((s) => (
                      <DropdownMenuItem
                        key={s}
                        onClick={() => advance.mutate({ id: r.referral_id, status: s })}
                      >
                        {s === "contracted" ? <CheckCircle2 className="h-3 w-3 mr-2" /> : null}
                        Mark {s}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {!isAdmin && (
        <p className="text-[11px] text-muted-foreground text-center">
          You see referrals from agents you manage. Admins see all.
        </p>
      )}
    </div>
  );
}
