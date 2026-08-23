import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  DELIVERY_COPY,
  DESTINATION_COPY,
  type DeliveryState,
} from "@/lib/contractingIntake";
import {
  buildContractingCsv,
  buildEthosCsv,
  ethosCsvFilename,
  contractingCsvFilename,
  type ContractingExportRow,
} from "@/lib/contractingExport";

/**
 * Staff view of contracting intakes and where each destination actually got to.
 *
 * Reads v_contracting_intake_status, which is security_invoker, so the
 * staff-read RLS policy on the base tables is what governs visibility — a
 * non-admin gets zero rows from the database itself rather than being hidden by
 * this component. Receipts are shown as provider ids and ranges only; the view
 * carries no webhook URL, no API key, and no Google credential.
 *
 * The four destinations are deliberately visually distinct. "Accepted by
 * provider" is not "Delivered", and "Not configured" is neither a success nor a
 * failure — collapsing any of those into a green tick is the exact defect this
 * feature exists to avoid.
 */

type StatusRow = {
  intake_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_e164: string;
  npn: string;
  status: string;
  review_reason: string | null;
  created_at: string;
  destination: string;
  state: DeliveryState;
  receipt: Record<string, unknown> | null;
  accepted_at: string | null;
  delivered_at: string | null;
  last_error_redacted: string | null;
  attempts: number | null;
  next_retry_at: string | null;
};

const TONE_CLASS: Record<string, string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  pending: "border-info/30 bg-info/10 text-info dark:text-info",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  muted: "border-border bg-muted/40 text-muted-foreground",
};

function receiptSummary(row: StatusRow): string | null {
  const r = row.receipt;
  if (!r) return null;
  if (r.provider === "resend") return `Resend ${String(r.message_id ?? "").slice(0, 24)}`;
  if (r.provider === "discord") return `Discord HTTP ${r.http_status}${r.message_id ? ` · ${r.message_id}` : ""}`;
  if (r.provider === "google_sheets") return `Sheet ${String(r.updated_range ?? "")}`;
  return null;
}

export function ContractingIntakeAdmin({ showEmptyState = false }: { showEmptyState?: boolean } = {}) {
  const [exporting, setExporting] = useState(false);

  const statusQ = useQuery({
    queryKey: ["contracting-intake-status"],
    staleTime: 30_000,
    queryFn: async (): Promise<StatusRow[]> => {
      const { data, error } = await supabase
        .from("v_contracting_intake_status" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      // Do not swallow. A staff member seeing an empty panel must be able to
      // tell "no intakes yet" from "the query failed".
      if (error) throw error;
      return ((data ?? []) as unknown) as StatusRow[];
    },
  });

  const intakes = useMemo(() => {
    const byIntake = new Map<string, { head: StatusRow; rows: StatusRow[] }>();
    for (const row of statusQ.data ?? []) {
      const entry = byIntake.get(row.intake_id);
      if (entry) entry.rows.push(row);
      else byIntake.set(row.intake_id, { head: row, rows: [row] });
    }
    return [...byIntake.values()];
  }, [statusQ.data]);

  const onExport = (variant: "workbook" | "ethos" = "workbook") => {
    setExporting(true);
    try {
      const seen = new Set<string>();
      const rows: ContractingExportRow[] = [];
      for (const { head } of intakes) {
        if (seen.has(head.intake_id)) continue;
        seen.add(head.intake_id);
        rows.push({
          intake_id: head.intake_id,
          first_name: head.first_name,
          last_name: head.last_name,
          email: head.email,
          phone_e164: head.phone_e164,
          npn: head.npn,
          status: head.status,
          created_at: head.created_at,
        });
      }
      // 2026-08-16: same rows, two sheets. Sam keeps an Ethos signup sheet AND
      // his own contract workbook, with different column orders; exporting only
      // the workbook meant the Ethos half was always retyped by hand.
      const useEthos = variant === "ethos";
      const blob = new Blob([(useEthos ? buildEthosCsv : buildContractingCsv)(rows)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (useEthos ? ethosCsvFilename : contractingCsvFilename)(new Date());
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  // An empty result is the normal state for a non-staff viewer, because the RLS
  // policy returns no rows. Render nothing rather than an empty admin panel —
  // EXCEPT where the page's whole promise is this monitor (the Requests
  // sub-page), which passes showEmptyState so an admin can see the surface
  // exists instead of a void under the Start Contracting card.
  if (!statusQ.isLoading && !statusQ.error && intakes.length === 0) {
    if (!showEmptyState) return null;
    return (
      <GlassCard className="p-6 text-center" data-testid="contracting-intake-admin">
        <h2 className="text-base font-semibold">Contracting intakes</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          No contracting requests yet. When a recruit submits the Start Contracting
          form, their intake lands here with per-destination delivery receipts.
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-4 sm:p-5" data-testid="contracting-intake-admin">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Contracting intakes</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The database is the source of truth. Each destination shows where it actually got to.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => statusQ.refetch()} disabled={statusQ.isFetching}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", statusQ.isFetching && "animate-spin")} aria-hidden />
            Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={() => onExport("workbook")} disabled={exporting || intakes.length === 0}>
            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Contract workbook
          </Button>
          <Button size="sm" variant="outline" onClick={() => onExport("ethos")} disabled={exporting || intakes.length === 0}>
            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Ethos sheet
          </Button>
        </div>
      </div>

      {/* Workbook sync is honestly unconfigured. The export above is the
          supported path until a hosted destination exists. */}
      <p className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Spreadsheet sync: <span className="font-medium">not configured</span>. No hosted workbook
        destination is set, so nothing is written to a spreadsheet automatically. Use Export CSV.
      </p>

      {statusQ.isLoading ? (
        <div className="mt-4 space-y-2">
          {/* stable-key-allow:skeleton — static Array(N) decorative loader, no reorder */}
          {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
        </div>
      ) : statusQ.error ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-500/35 bg-rose-500/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />
          <p className="text-xs">
            Could not load intake status: {String((statusQ.error as Error).message).slice(0, 160)}
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {intakes.map(({ head, rows }) => (
            <li key={head.intake_id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  {head.first_name} {head.last_name}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">NPN {head.npn}</span>
                </p>
                {head.status === "needs_review" && (
                  <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    Needs review · {head.review_reason ?? "unspecified"}
                  </span>
                )}
              </div>

              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {rows.map((row) => {
                  const copy = DELIVERY_COPY[row.state] ?? { label: row.state, tone: "muted" as const };
                  return (
                    <div
                      key={`${row.intake_id}-${row.destination}`}
                      className={cn("rounded-md border px-2 py-1.5 text-xs", TONE_CLASS[copy.tone])}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {DESTINATION_COPY[row.destination] ?? row.destination}
                        </span>
                        <span>{copy.label}</span>
                      </div>
                      {receiptSummary(row) && (
                        <p className="mt-0.5 font-mono text-[10px] opacity-80">{receiptSummary(row)}</p>
                      )}
                      {row.last_error_redacted && (
                        <p className="mt-0.5 text-[10px] opacity-90">{row.last_error_redacted}</p>
                      )}
                      {row.state === "failed" && row.next_retry_at && (
                        <p className="mt-0.5 text-[10px] opacity-80">
                          Attempt {row.attempts ?? 0} · retry {new Date(row.next_retry_at).toLocaleTimeString()}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}

export default ContractingIntakeAdmin;
