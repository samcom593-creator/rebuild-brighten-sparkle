import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, CheckCircle2, Clock, XCircle, Send, Award } from "lucide-react";
import { format } from "date-fns";

import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

interface ContractRow {
  carrier_id: number;
  carrier_name: string | null;
  carrier_logo: string | null;
  status: string | null;
  writing_number: string | null;
  contract_number: string | null;
  activated_date: string | null;
  carrier_portal_url: string | null;
  contracting_speed: number | null;
}

const STATUS_META: Record<string, { label: string; icon: React.ElementType; tint: string }> = {
  active: { label: "Active", icon: CheckCircle2, tint: "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" },
  pending_upline_assignment: { label: "Pending upline", icon: Clock, tint: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300" },
  submitted: { label: "Submitted", icon: Send, tint: "border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-300" },
  rejected: { label: "Rejected", icon: XCircle, tint: "border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-300" },
};

/**
 * CarrierContracts — v22 Wave B (2026-06-10)
 *
 * Sam: "Send out contract requests for American Home Life and Combined
 * Chubb through the website. They use InsurancePay. Build the way."
 *
 * Phase 1 (shipped): admin grid showing every carrier with current contract
 * status + writing number + direct-link to carrier portal (e.g. Chubb's
 * insuranceadmin.com URL). Sam can jump straight to the carrier dashboard
 * to manage in-flight contracts. Data mirrors AgentLink's
 * /api/contract-requests endpoint, synced via apex_carrier_contracts table.
 *
 * Phase 2 (next): in-app contract submission form — file an upline
 * request that pushes to InsurancePay / Surancebay API on submit, sets
 * status to 'submitted', notifies Sam via Telegram.
 */
export default function CarrierContracts() {
  usePageTitle("Carrier Contracts · APEX");
  const { isAdmin } = useAuth();

  const contracts = useQuery({
    queryKey: ["carrier-contracts-summary"],
    enabled: isAdmin,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ContractRow[]> => {
      const { data, error } = await supabase
        .from("v_apex_contracts_summary" as any)
        .select("*");
      if (error) throw error;
      return ((data ?? []) as unknown) as ContractRow[];
    },
  });

  const grouped = useMemo(() => {
    const byStatus: Record<string, ContractRow[]> = {
      active: [],
      pending_upline_assignment: [],
      submitted: [],
      rejected: [],
      none: [],
    };
    for (const row of contracts.data ?? []) {
      const k = row.status ?? "none";
      (byStatus[k] ??= []).push(row);
    }
    return byStatus;
  }, [contracts.data]);

  if (!isAdmin) {
    return (
      <div className="page-enter px-4 sm:px-6 pb-24">
        <EmptyState icon={<Award className="h-6 w-6" />} title="Admin only" description="Contract management is reserved for the agency owner." />
      </div>
    );
  }

  const totalActive = grouped.active?.length ?? 0;
  const totalPending = (grouped.pending_upline_assignment?.length ?? 0) + (grouped.submitted?.length ?? 0);
  const totalNone = grouped.none?.length ?? 0;

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Carriers · Contracts"
        eyebrowIcon={<Award className="h-3 w-3" />}
        title="Carrier contracts"
        subtitle="Mirrors AgentLink contracting · tile counts below"
      />

      {/* v24 audit fix: loading state IN-PLACE (top, persistent). Was
          bottom-pinned skeleton that caused layout collapse-then-expand. */}
      {contracts.isLoading ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Skeleton className="h-24" /><Skeleton className="h-24" />
            <Skeleton className="h-24" /><Skeleton className="h-24" />
          </div>
          <Skeleton className="h-40" />
        </>
      ) : (contracts.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Award className="h-6 w-6" />}
          title="No contracts synced yet"
          description="Run the AgentLink sync from /admin or wait for the next cron tick. Contracts will surface here automatically."
        />
      ) : (
        <>
          {/* Quick summary tiles — neutral white cards + colored dot */}
          <div className="grid gap-3 sm:grid-cols-4">
            <SummaryTile label="Active" count={totalActive} status="active" />
            <SummaryTile label="Pending" count={grouped.pending_upline_assignment?.length ?? 0} status="pending_upline_assignment" />
            <SummaryTile label="Submitted" count={grouped.submitted?.length ?? 0} status="submitted" />
            <SummaryTile label="Rejected" count={grouped.rejected?.length ?? 0} status="rejected" />
          </div>

          {/* Status sections — rows hover directly against page bg
              (no card-within-card double-surface per audit complaint) */}
          {(["active", "pending_upline_assignment", "submitted", "rejected", "none"] as const).map((s) => {
            const rows = grouped[s] ?? [];
            if (rows.length === 0) return null;
            return (
              <section key={s} className="space-y-2">
                <p className="text-11 font-semibold uppercase tracking-wider text-slate-500 pt-2">
                  {s === "none" ? "Not contracted yet" : STATUS_META[s]?.label ?? s} · {rows.length}
                </p>
                <div className="space-y-2">
                  {rows.map((row, i) => (
                    <ContractRowView key={`${row.carrier_id}-${i}`} row={row} />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

/** v24 audit fix: neutral white tile + tiny 2x2px colored status dot.
 *  Was tinted border via STATUS_META.tint (rose/amber/blue/emerald). */
function SummaryTile({ label, count, status }: { label: string; count: number; status: string }) {
  const meta = STATUS_META[status];
  const dot = status === "active" ? "bg-emerald-500"
            : status === "pending_upline_assignment" ? "bg-amber-500"
            : status === "submitted" ? "bg-blue-500"
            : status === "rejected" ? "bg-rose-500"
            : "bg-slate-400";
  const Icon = meta?.icon ?? Award;
  return (
    <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`h-2 w-2 rounded-full ${dot}`} />
            <p className="text-11 uppercase tracking-wider font-semibold">{label}</p>
          </div>
          <p className="text-28 font-bold tabular-nums">{count}</p>
        </div>
        <Icon className="h-5 w-5 opacity-50" />
      </CardContent>
    </Card>
  );
}

function ContractRowView({ row }: { row: ContractRow }) {
  const meta = row.status ? STATUS_META[row.status] : null;
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-base">
      {row.carrier_logo ? (
        <img src={row.carrier_logo} alt={row.carrier_name ?? ""} className="h-9 w-9 rounded object-contain bg-white" />
      ) : (
        <div className="h-9 w-9 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-12 font-semibold text-slate-500">
          {row.carrier_name?.[0] ?? "—"}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-14 font-semibold truncate">{row.carrier_name ?? "—"}</p>
          {meta && (
            <Badge variant="outline" className={`text-11 ${meta.tint}`}>
              {meta.label}
            </Badge>
          )}
          {row.contracting_speed && row.contracting_speed > 1 && (
            <Badge variant="outline" className="text-11">⚡ fast</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-12 text-slate-500 mt-1">
          {row.writing_number && (
            <span>Writing #: <span className="font-mono font-medium text-slate-700 dark:text-slate-300">{row.writing_number}</span></span>
          )}
          {row.contract_number && (
            <span>Contract: <span className="font-mono">{row.contract_number}</span></span>
          )}
          {row.activated_date && (
            <span>Activated {format(new Date(row.activated_date), "MMM d, yyyy")}</span>
          )}
          {!row.status && (
            <span className="text-amber-700 dark:text-amber-400 italic">No contract yet — request via portal</span>
          )}
        </div>
      </div>
      {row.carrier_portal_url && (
        <Button asChild size="sm" variant="outline">
          <a href={row.carrier_portal_url} target="_blank" rel="noopener noreferrer">
            Portal <ExternalLink className="h-3 w-3 ml-1" />
          </a>
        </Button>
      )}
    </div>
  );
}
