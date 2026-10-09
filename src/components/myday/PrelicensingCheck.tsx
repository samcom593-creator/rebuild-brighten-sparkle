import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatPhoneDisplay } from "@/lib/phone";
import { cn } from "@/lib/utils";

/**
 * Pre-licensing check. Everyone who bought the licensing course, plus every active unlicensed hire, with two
 * ticks only Sam sets: "In the Slack" and "Pre-licensing done". XCEL progress is shown beside the tick as
 * evidence and never sets it. The list is sorted so the people still to chase come first.
 */
export type PrelicensingRow = {
  email_key: string; name: string | null; phone: string | null; source: "course_buyer" | "unlicensed_hire" | "both";
  bought_at: string | null; xcel_pct: number | null; xcel_status: string | null;
  in_slack: boolean; prelicensing_done: boolean; note: string | null;
};
const KEY = ["prelicensing_check_list"] as const;
const SOURCE_LABEL: Record<PrelicensingRow["source"], string> = { course_buyer: "Bought course", unlicensed_hire: "Unlicensed hire", both: "Hire + bought course" };

export function PrelicensingCheck({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const qc = useQueryClient();
  const { data, isError, isLoading, refetch } = useQuery({
    queryKey: KEY,
    enabled: open,
    staleTime: 30_000,
    queryFn: async (): Promise<PrelicensingRow[]> => {
      const { data: res, error } = await supabase.rpc("prelicensing_check_list");
      if (error) throw new Error(error.message);
      return res as unknown as PrelicensingRow[];
    },
  });

  const save = useMutation({
    mutationFn: async (v: { row: PrelicensingRow; in_slack: boolean; done: boolean }) => {
      const { data: res, error } = await supabase.rpc("prelicensing_set", {
        p_email_key: v.row.email_key, p_in_slack: v.in_slack, p_done: v.done,
      });
      if (error || !(res as { ok?: boolean })?.ok) throw new Error(error?.message ?? "Not saved");
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e: Error) => toast.error(`Could not save: ${e.message}`),
  });

  const todo = (data ?? []).filter((r) => !(r.in_slack && r.prelicensing_done)).length;

  return (
    <section aria-label="Pre-licensing check" className="mb-4 rounded-2xl border border-border bg-card">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 p-4 text-left">
        <span>
          <span className="block text-sm font-bold uppercase tracking-wide text-muted-foreground">Pre-licensing check</span>
          <span className="block text-sm text-foreground">
            {open && data ? `${todo} of ${data.length} still to confirm` : "Is everyone in the Slack actually doing pre-licensing?"}
          </span>
        </span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border p-3">
          {isLoading ? <p className="p-2 text-sm text-muted-foreground">Loading…</p>
            : isError ? (
              <p className="p-2 text-sm text-amber-500">Could not load the list. This is not an empty list.{" "}
                <button type="button" className="underline" onClick={() => void refetch()}>Try again</button></p>
            ) : (data ?? []).length === 0 ? <p className="p-2 text-sm text-muted-foreground">Nobody to check.</p>
            : (data ?? []).map((r) => (
              <div key={r.email_key} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="font-semibold text-foreground">{r.name || r.email_key}</p>
                  <p className="text-xs text-muted-foreground">{SOURCE_LABEL[r.source]}</p>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {r.email_key}{r.phone ? ` · ${formatPhoneDisplay(r.phone)}` : ""}
                </p>
                <p className="mt-1 text-xs">
                  {r.xcel_pct === null
                    ? <span className="text-amber-500">No XCEL progress on file</span>
                    : <span className={r.xcel_pct >= 100 ? "text-emerald-500" : "text-muted-foreground"}>XCEL pre-licensing {r.xcel_pct}%{r.xcel_status ? ` · ${r.xcel_status}` : ""}</span>}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" disabled={save.isPending}
                    onClick={() => save.mutate({ row: r, in_slack: !r.in_slack, done: r.prelicensing_done })}
                    aria-pressed={r.in_slack}
                    className={cn("min-h-[40px] rounded-full border px-3 text-sm font-medium", r.in_slack ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                    {r.in_slack ? "In the Slack" : "Not in the Slack"}
                  </button>
                  <button type="button" disabled={save.isPending}
                    onClick={() => save.mutate({ row: r, in_slack: r.in_slack, done: !r.prelicensing_done })}
                    aria-pressed={r.prelicensing_done}
                    className={cn("min-h-[40px] rounded-full border px-3 text-sm font-medium", r.prelicensing_done ? "border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "border-border")}>
                    {r.prelicensing_done ? "Pre-licensing done" : "Pre-licensing not confirmed"}
                  </button>
                </div>
              </div>
            ))}
        </div>
      ) : null}
    </section>
  );
}
