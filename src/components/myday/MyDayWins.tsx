import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * The three wins Sam counts by tapping (2026-10-08). Long-form video is first because it is the highest
 * return on his time. Each tap is one timestamped row, so today / this week / total are real counts and an
 * undo removes only a recent mis-tap. A failed read shows "?" and says so; it never shows a believable 0.
 */
export const WIN_KINDS = [
  { kind: "long_form_posted", label: "Long-form video posted" },
  { kind: "hire_contracts_sent", label: "Hire, all contracts sent" },
  { kind: "unlicensed_course_hire", label: "Unlicensed hire bought the course" },
] as const;
export type WinKind = (typeof WIN_KINDS)[number]["kind"];
type Counts = Record<WinKind, { today: number; week: number; total: number }>;

const KEY = ["myday_counters"] as const;

export function MyDayWins() {
  const qc = useQueryClient();
  const { data, isError, isLoading } = useQuery({
    queryKey: KEY,
    staleTime: 30_000,
    queryFn: async (): Promise<Counts> => {
      const { data: res, error } = await supabase.rpc("myday_counters");
      if (error) throw new Error(error.message);
      return res as unknown as Counts;
    },
  });

  const add = useMutation({
    mutationFn: async (kind: WinKind) => {
      const { data: res, error } = await supabase.rpc("myday_counter_add", { p_kind: kind });
      if (error) throw new Error(error.message);
      if (!(res as { ok?: boolean })?.ok) throw new Error("Not saved");
    },
    onSuccess: (_d, kind) => { toast.success(`+1 ${WIN_KINDS.find((w) => w.kind === kind)?.label}`); void qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e: Error) => toast.error(`Could not add: ${e.message}`),
  });
  const undo = useMutation({
    mutationFn: async (kind: WinKind) => {
      const { data: res, error } = await supabase.rpc("myday_counter_undo", { p_kind: kind });
      if (error) throw new Error(error.message);
      if (!(res as { ok?: boolean })?.ok) throw new Error("Nothing recent to undo");
    },
    onSuccess: () => { toast.success("Removed the last tap"); void qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section aria-label="Wins" className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {WIN_KINDS.map((w) => {
        const c = data?.[w.kind];
        const busy = (add.isPending && add.variables === w.kind) || (undo.isPending && undo.variables === w.kind);
        return (
          <div key={w.kind} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
            <button
              type="button"
              onClick={() => add.mutate(w.kind)}
              disabled={busy}
              aria-label={`Add one: ${w.label}`}
              className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95 disabled:opacity-60")}
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-6 w-6" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight text-foreground">{w.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {isLoading ? "Loading…" : isError || !c ? "Could not load counts" : `${c.today} today · ${c.week} this week · ${c.total} total`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => undo.mutate(w.kind)}
              disabled={busy || !c || c.today === 0}
              aria-label={`Undo last: ${w.label}`}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              <Undo2 className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </section>
  );
}
