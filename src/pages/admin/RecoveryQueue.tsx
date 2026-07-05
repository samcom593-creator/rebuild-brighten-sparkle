import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Phone, Mail, ChevronRight, Flame, AlertTriangle, GraduationCap, CheckCircle2, Clock, DollarSign } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Row {
  application_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  state: string | null;
  license_progress: string | null;
  cohort: string;
  days_since_touch: number | null;
  last_contacted_at: string | null;
}

const COHORT_META: Record<string, { label: string; help: string; icon: any; tone: string }> = {
  A_WAITING_ON_LICENSE: {
    label: "Waiting on License",
    help: "Passed exam. Chase state issuance. Highest urgency — closest to producing.",
    icon: Clock,
    tone: "border-emerald-500/40 bg-emerald-500/5",
  },
  B_PASSED_TEST_NO_LIC_YET: {
    label: "Passed Test",
    help: "Passed but license_progress hasn't been flipped to waiting_on_license. Confirm status.",
    icon: CheckCircle2,
    tone: "border-emerald-500/40 bg-emerald-500/5",
  },
  C_TEST_SCHEDULED: {
    label: "Test Scheduled",
    help: "Push day-of. Confirm they show up.",
    icon: AlertTriangle,
    tone: "border-amber-500/40 bg-amber-500/5",
  },
  D_FINISHED_COURSE_NO_EXAM: {
    label: "Finished Course · No Exam",
    help: "Highest volume near-license cohort. Book their state exam today.",
    icon: GraduationCap,
    tone: "border-amber-500/40 bg-amber-500/5",
  },
  E_BOUGHT_NEVER_STARTED: {
    label: "Bought · Never Started",
    help: "Money already spent. Re-engage or dispose. Wasted opportunity.",
    icon: DollarSign,
    tone: "border-rose-500/40 bg-rose-500/5",
  },
  F_COURSE_IN_PROGRESS: {
    label: "Course in Progress",
    help: "Studying. Light nudge every 3-5 days.",
    icon: GraduationCap,
    tone: "border-slate-500/30 bg-slate-500/5",
  },
  G_UNLICENSED_STARTER: {
    label: "Unlicensed · Starter",
    help: "Applied but no course purchased. Sell the value + get them into pre-licensing.",
    icon: Flame,
    tone: "border-slate-500/30 bg-slate-500/5",
  },
};

const ORDER = [
  "A_WAITING_ON_LICENSE",
  "B_PASSED_TEST_NO_LIC_YET",
  "C_TEST_SCHEDULED",
  "D_FINISHED_COURSE_NO_EXAM",
  "E_BOUGHT_NEVER_STARTED",
  "F_COURSE_IN_PROGRESS",
  "G_UNLICENSED_STARTER",
] as const;

function formatPhone(raw: string | null): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

function telHref(raw: string | null): string {
  if (!raw) return "#";
  const digits = raw.replace(/\D/g, "");
  return `tel:${digits.startsWith("1") ? "+" : "+1"}${digits}`;
}

export default function RecoveryQueue() {
  usePageTitle("Recovery Queue · APEX");

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["v_hot_licensing_prospects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_hot_licensing_prospects" as any)
        .select("application_id, name, phone, email, state, license_progress, cohort, days_since_touch, last_contacted_at")
        .order("days_since_touch", { ascending: false });
      if (error) throw error;
      return (data as unknown as Row[]) ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const byCohort = useMemo(() => {
    const map: Record<string, Row[]> = {};
    for (const r of rows) {
      const c = r.cohort ?? "G_UNLICENSED_STARTER";
      if (!map[c]) map[c] = [];
      map[c].push(r);
    }
    return map;
  }, [rows]);

  const totals = ORDER.map((c) => ({ cohort: c, n: byCohort[c]?.length ?? 0 }));

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Assistant Queue"
        eyebrowIcon={<Flame className="h-3 w-3" />}
        title="Recovery Queue"
        subtitle="Every unlicensed applicant near the finish line. Sorted by proximity to licensed. Work top-down."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {totals.map((t) => {
          const meta = COHORT_META[t.cohort];
          const Icon = meta.icon;
          return (
            <Card key={t.cohort} className={cn("border", meta.tone)}>
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <Icon className="h-3 w-3" />
                  <span className="truncate">{meta.label}</span>
                </div>
                <div className="text-xl font-bold mt-1">{t.n}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading queue…</div>}

      {ORDER.map((cohort) => {
        const list = byCohort[cohort] ?? [];
        if (list.length === 0) return null;
        const meta = COHORT_META[cohort];
        const Icon = meta.icon;

        return (
          <div key={cohort} className="space-y-2">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4" />
              <h2 className="text-sm font-bold uppercase tracking-wide">{meta.label}</h2>
              <Badge variant="outline" className="text-xs">{list.length}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{meta.help}</p>

            <div className="space-y-1.5">
              {list.map((r) => (
                <Card key={r.application_id} className={cn("border", meta.tone)}>
                  <CardContent className="p-3 flex items-center gap-3 flex-wrap sm:flex-nowrap">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{r.name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                        {r.state && <span>{r.state}</span>}
                        {r.days_since_touch !== null && (
                          <span className="text-amber-500">{r.days_since_touch}d stale</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {r.phone && (
                        <a
                          href={telHref(r.phone)}
                          className="inline-flex items-center gap-1 text-xs bg-emerald-500 hover:bg-emerald-600 text-white px-2 py-1.5 rounded-md font-medium"
                        >
                          <Phone className="h-3 w-3" />
                          {formatPhone(r.phone)}
                        </a>
                      )}
                      {r.email && (
                        <a
                          href={`mailto:${r.email}`}
                          className="inline-flex items-center gap-1 text-xs bg-slate-700 hover:bg-slate-600 text-white px-2 py-1.5 rounded-md"
                          title={r.email}
                        >
                          <Mail className="h-3 w-3" />
                        </a>
                      )}
                      <Button asChild variant="ghost" size="sm" className="h-8 px-2">
                        <Link to={`/dashboard/applicants?id=${r.application_id}`}>
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
