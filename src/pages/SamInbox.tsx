import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, CheckCircle2, Mail, Phone, RefreshCw, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";

type InboxRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  created_at: string | null;
  ica_paid: boolean | null;
  ica_paid_at: string | null;
  status: string | null;
  days_old: number | null;
  is_duplicate: boolean | null;
  referral_source: string | null;
  triage_bucket: string | null;
  seminar_date: string | null;
};

const BUCKET_ORDER = [
  "paid_needs_onboarding",
  "contracting_uncontacted",
  "stale_new_7d",
  "stale_new_3d",
  "uncontacted_24h",
  "fresh",
];

const BUCKET_LABEL: Record<string, string> = {
  paid_needs_onboarding: "Paid - needs onboarding",
  contracting_uncontacted: "Contracting - uncontacted",
  stale_new_7d: "Stale 7d",
  stale_new_3d: "Stale 3d",
  uncontacted_24h: "Uncontacted 24h",
  fresh: "Fresh",
};

function labelFor(bucket: string | null) {
  if (!bucket) return "Unsorted";
  return BUCKET_LABEL[bucket] ?? bucket.replace(/_/g, " ");
}

export default function SamInbox() {
  usePageTitle("Sam Inbox - APEX recruiting triage");

  const query = useQuery({
    queryKey: ["sam-inbox"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_sam_inbox" as any)
        .select("*")
        .neq("triage_bucket", "fresh")
        .order("ica_paid", { ascending: false })
        .order("days_old", { ascending: false })
        .limit(120);
      if (error) throw error;
      return (data ?? []) as unknown as InboxRow[];
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<string, InboxRow[]>();
    for (const row of query.data ?? []) {
      const key = row.triage_bucket ?? "unsorted";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ai = BUCKET_ORDER.indexOf(a);
      const bi = BUCKET_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [query.data]);

  if (query.isLoading) return <PageLoadingSkeleton variant="dashboard" />;

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 space-y-5">
      <PageHeader
                eyebrow="Recruiting triage"
        eyebrowIcon={<UserCheck className="h-3 w-3" />}
        title="Sam's applicant inbox"
        subtitle="Paid, stale, and uncontacted applicants pulled straight from the live funnel."
        actions={
          <Button size="sm" variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">Needs action</div>
            <div className="text-2xl font-bold tabular-nums">{query.data?.length ?? 0}</div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">Paid waiting</div>
            <div className="text-2xl font-bold tabular-nums">
              {(query.data ?? []).filter((r) => r.ica_paid).length}
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">Seven-day stale</div>
            <div className="text-2xl font-bold tabular-nums">
              {(query.data ?? []).filter((r) => r.triage_bucket === "stale_new_7d").length}
            </div>
          </CardContent>
        </Card>
      </div>

      {grouped.length === 0 ? (
        <Card className="border-border/60">
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
            No urgent recruiting leaks in the inbox.
          </CardContent>
        </Card>
      ) : (
        grouped.map(([bucket, rows]) => (
          <section key={bucket} className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide">{labelFor(bucket)}</h2>
              <Badge variant="outline">{rows.length}</Badge>
            </div>
            <div className="grid gap-2">
              {rows.map((row) => {
                const name = [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unnamed applicant";
                const age = row.created_at
                  ? formatDistanceToNowStrict(new Date(row.created_at), { addSuffix: true })
                  : "unknown age";
                return (
                  <Card key={row.id} className="border-border/60">
                    <CardHeader className="p-4 pb-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <CardTitle className="text-base">{name}</CardTitle>
                        <div className="flex flex-wrap gap-1.5">
                          {row.ica_paid && <Badge className="bg-emerald-500 text-white">Paid</Badge>}
                          {row.is_duplicate && <Badge variant="outline">Duplicate</Badge>}
                          <Badge variant="outline">{row.status ?? "no status"}</Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="grid gap-3 text-sm sm:grid-cols-[1fr_auto] sm:items-end">
                        <div className="space-y-1 text-muted-foreground">
                          <div>{row.email ?? "No email"} · {row.phone ?? "No phone"}</div>
                          <div>
                            {row.state ?? "No state"} · {age} · {row.referral_source ?? "unknown source"}
                            {row.seminar_date ? ` · seminar ${row.seminar_date}` : ""}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {row.phone ? (
                            <Button size="sm" asChild>
                              <a href={`tel:${row.phone}`}>
                                <Phone className="mr-1 h-4 w-4" />
                                Call
                              </a>
                            </Button>
                          ) : null}
                          {row.email ? (
                            <Button size="sm" variant="outline" asChild>
                              <a href={`mailto:${row.email}`}>
                                <Mail className="mr-1 h-4 w-4" />
                                Email
                              </a>
                            </Button>
                          ) : null}
                          {!row.phone && !row.email ? (
                            <Badge variant="outline" className="border-destructive/40 text-destructive">
                              <AlertTriangle className="mr-1 h-3 w-3" />
                              No contact
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
