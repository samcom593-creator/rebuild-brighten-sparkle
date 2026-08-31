import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowRight, CalendarClock, Check, Loader2, Mail,
  MessageSquare, Phone, PhoneCall, Sparkles, TrendingUp, Undo2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/useConfirm";
import { cn } from "@/lib/utils";
import { HIRE_RUNGS, stageForRank, stageLabel, stageRank } from "@/lib/hireLadder";

export type HireRow = {
  agent_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  license_status: string;
  onboarding_stage: string | null;
  stage_rank: number | null;
  hired_at: string;
  days_in_stage: number;
  days_since_hired: number;
  first_deal_at: string | null;
  manager_name: string | null;
  book_deals: number | string | null;
  book_ap: number | string | null;
  next_call_at: string | null;
  modules_done: number | string | null;
  calls_7d: number | string | null;
  calls_30d: number | string | null;
  conversations_30d: number | string | null;
  last_call_at: string | null;
  hired_this_month: boolean;
  next_action_key: string;
  next_action_label: string;
  is_stalled: boolean;
  email_missing: boolean;
};

type Lens = "working" | "all" | "stalled" | "licensing" | "producing";

const LENSES: ReadonlyArray<readonly [Lens, string, string]> = [
  ["working", "Still ramping", "Everyone who has not reached producing yet"],
  ["stalled", "Stalled", "No movement in more than 14 days"],
  ["licensing", "Needs a license", "Blocked before onboarding can start"],
  ["producing", "Producing", "Writing business — coach, do not onboard"],
  ["all", "Everyone", "Every active hire on the roster"],
];

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function money(value: number) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function phoneHref(phone: string | null) {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? `tel:${digits}` : null;
}

function smsHref(phone: string | null) {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? `sms:${digits}` : null;
}

export function HireLaunchBoard({ searchTerm }: { searchTerm: string }) {
  // Named askConfirm, not confirm, matching ControlTerminal and
  // AgentProfileDrawer: a local binding called `confirm` is indistinguishable
  // from the native blocking modal to a reader and to check:blocking-modal.
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [lens, setLens] = useState<Lens>("working");
  const [busyId, setBusyId] = useState<string | null>(null);

  const board = useQuery({
    queryKey: ["hire-launch-board"],
    staleTime: 60_000,
    refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_hire_launch_board" as never)
        .select("*")
        .order("stage_rank", { ascending: true, nullsFirst: true })
        .order("days_in_stage", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as HireRow[];
    },
  });

  const move = useMutation({
    mutationFn: async (input: {
      row: HireRow;
      kind: "stage" | "license";
      value: string;
      expected: string | null;
    }) => {
      // Both names are written as literals rather than picked from a
      // variable, so check:rpc-args can actually resolve them against the live
      // catalogue instead of filing this call site under "unprovable".
      const { data, error } = input.kind === "stage"
        ? await supabase.rpc("advance_hire_stage" as never, {
            p_agent_id: input.row.agent_id,
            p_to_stage: input.value,
            p_expected_stage: input.expected,
          } as never)
        : await supabase.rpc("set_hire_license_status" as never, {
            p_agent_id: input.row.agent_id,
            p_to_status: input.value,
            p_expected_status: input.expected,
          } as never);
      if (error) throw error;
      return data as unknown as {
        ok: boolean; changed: boolean; message?: string;
        stage?: string; licenseStatus?: string; from?: string; queuedEmails?: string[];
      };
    },
    onSuccess: (result, input) => {
      if (!result?.changed) {
        toast.info(result?.message ?? "Nothing changed.");
        return;
      }
      const queued = result.queuedEmails ?? [];
      const what = input.kind === "stage"
        ? `${input.row.display_name} → ${stageLabel(result.stage)}`
        : `${input.row.display_name} is now ${result.licenseStatus}`;
      toast.success(queued.length
        ? `${what}. ${queued.length} onboarding email${queued.length === 1 ? "" : "s"} queued: ${queued.join(", ")}.`
        : `${what}.`);
      void queryClient.invalidateQueries({ queryKey: ["hire-launch-board"] });
      void queryClient.invalidateQueries({ queryKey: ["interviews-pipeline"] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "The move could not be saved.";
      toast.error(message);
      // A 40001 means somebody else moved this hire. Re-read rather than
      // leaving a card that argues with the database.
      void queryClient.invalidateQueries({ queryKey: ["hire-launch-board"] });
    },
    onSettled: () => setBusyId(null),
  });

  // Every move that can send mail says so before it is made. The trigger
  // fn_enqueue_hired_licensed_onboarding queues the course and Discord emails
  // when a licensed hire reaches 'live' or is first marked licensed, and the
  // hire is a real person who will receive them.
  const runMove = useCallback(async (
    row: HireRow,
    kind: "stage" | "license",
    value: string,
    expected: string | null,
  ) => {
    const sends = kind === "license" ? value === "licensed" : value === "live" && row.license_status === "licensed";
    // True when the target rung is BELOW where they are now. Named for what it
    // is: the condition is current-rank > target-rank.
    const backward = kind === "stage" && (row.stage_rank ?? -1) > (stageRank(value) ?? 0);
    const ok = await askConfirm({
      title: kind === "license"
        ? `Mark ${row.display_name} as ${value}?`
        : backward
          ? `Move ${row.display_name} back to ${stageLabel(value)}?`
          : `Move ${row.display_name} to ${stageLabel(value)}?`,
      description: sends
        ? `This is the point the onboarding emails go out — ${row.display_name} will be sent the course and Discord invites at ${row.email ?? "no email on file"}. Everything is recorded against your name.`
        : backward
          ? "Moving somebody backwards is recorded the same as moving them forwards. Nothing is sent."
          : "Recorded against your name. No email is sent at this step.",
      confirmText: kind === "license" ? "Mark it" : "Move them",
      tone: sends || backward ? "danger" : "primary",
    });
    if (!ok) return;
    setBusyId(row.agent_id);
    move.mutate({ row, kind, value, expected });
  }, [askConfirm, move]);

  const term = searchTerm.trim().toLowerCase();
  const rows = board.data ?? [];

  const matching = useMemo(() => (term
    ? rows.filter((row) => [row.display_name, row.email, row.phone, row.onboarding_stage, row.manager_name]
        .some((value) => (value ?? "").toLowerCase().includes(term)))
    : rows), [rows, term]);

  const counts = useMemo(() => ({
    working: matching.filter((row) => (row.stage_rank ?? 0) < 4).length,
    stalled: matching.filter((row) => row.is_stalled).length,
    licensing: matching.filter((row) => row.license_status !== "licensed").length,
    producing: matching.filter((row) => (row.stage_rank ?? 0) >= 4).length,
    all: matching.length,
  }), [matching]);

  const visible = useMemo(() => matching.filter((row) => {
    if (lens === "all") return true;
    if (lens === "stalled") return row.is_stalled;
    if (lens === "licensing") return row.license_status !== "licensed";
    if (lens === "producing") return (row.stage_rank ?? 0) >= 4;
    return (row.stage_rank ?? 0) < 4;
  }), [matching, lens]);

  if (board.isLoading) {
    // stable-key-allow:static-hire-skeleton — fixed placeholders never reorder or hold state.
    return <div className="space-y-3">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-2xl border border-border bg-muted/20" />)}</div>;
  }
  if (board.isError) {
    return (
      <div role="alert" className="rounded-2xl border border-destructive/30 p-8 text-center text-sm text-destructive">
        The hire roster could not be read, so no count on this screen should be trusted as zero.{" "}
        <button className="underline" onClick={() => void board.refetch()}>Retry</button>
      </div>
    );
  }

  const stalledTotal = rows.filter((row) => row.is_stalled).length;
  const unlicensedProducers = rows.filter((row) => row.license_status !== "licensed" && Number(row.book_deals ?? 0) > 0);

  return (
    <section aria-labelledby="hire-launch-heading" className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-primary/25 bg-card">
        <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1.35fr_1fr] lg:items-center">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              <Sparkles className="h-3.5 w-3.5" /> New-hire launch board
            </div>
            <h2 id="hire-launch-heading" className="text-2xl font-black tracking-tight sm:text-3xl">Move every hire forward from here.</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Every active hire, not just this month&apos;s. Click a step on any card to move that person; the license badge sets the license. Each move is recorded against your name.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Still ramping", value: counts.working },
              { label: "Stalled 14d+", value: stalledTotal },
              { label: "Producing", value: counts.producing },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-border bg-muted/20 p-3 text-center">
                <p className="text-2xl font-black tabular-nums">{item.value}</p>
                <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {unlicensedProducers.length > 0 && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-muted-foreground">
            <span className="font-bold text-foreground">{unlicensedProducers.length} hire{unlicensedProducers.length === 1 ? " is" : "s are"} writing business while still marked unlicensed</span>
            {" — "}{unlicensedProducers.slice(0, 3).map((row) => row.display_name).join(", ")}
            {unlicensedProducers.length > 3 ? ` and ${unlicensedProducers.length - 3} more` : ""}. Either the license status is stale or the production is attributed to the wrong person.
          </p>
        </div>
      )}

      <div className="flex max-w-full gap-2 overflow-x-auto" aria-label="Filter hires">
        {LENSES.map(([key, label, description]) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={lens === key ? "default" : "outline"}
            className="h-10 shrink-0 rounded-xl"
            onClick={() => setLens(key)}
            aria-pressed={lens === key}
            title={description}
          >
            {label}
            <span className="ml-1 rounded-full bg-black/10 px-1.5 text-[10px] tabular-nums">{counts[key]}</span>
          </Button>
        ))}
      </div>

      {visible.length === 0 && (
        <div role="status" className="rounded-2xl border border-border p-10 text-center text-sm text-muted-foreground">
          {term ? `No hires match “${searchTerm.trim()}”.` : "Nobody is in this view right now."}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {visible.map((row) => (
          <HireCard
            key={row.agent_id}
            row={row}
            busy={busyId === row.agent_id}
            onMove={runMove}
          />
        ))}
      </div>
    </section>
  );
}

function HireCard({
  row, busy, onMove,
}: {
  row: HireRow;
  busy: boolean;
  onMove: (row: HireRow, kind: "stage" | "license", value: string, expected: string | null) => void;
}) {
  const rank = row.stage_rank;
  const offLadder = rank === null;
  const licensed = row.license_status === "licensed";
  const deals = Number(row.book_deals ?? 0);
  const ap = Number(row.book_ap ?? 0);
  const callHref = phoneHref(row.phone);
  const textHref = smsHref(row.phone);

  return (
    <article className={cn(
      "group overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-xl",
      row.is_stalled ? "border-warning/40" : "border-border/80 hover:border-primary/35",
    )}>
      <div className={cn("h-1", row.is_stalled ? "bg-warning" : "bg-gradient-to-r from-primary to-transparent")} />
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-sm font-black text-primary">
            {initials(row.display_name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-base font-black">{row.display_name}</p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  Hired {format(new Date(row.hired_at), "MMM d")} · {row.email_missing ? "no email on file" : row.email}
                  {row.manager_name ? ` · ${row.manager_name}` : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onMove(row, "license", licensed ? "unlicensed" : "licensed", row.license_status)}
                title={licensed ? "Recorded as licensed — click to correct it" : "Mark this hire licensed"}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors disabled:opacity-50",
                  licensed
                    ? "border-success/30 bg-success/5 text-success hover:bg-success/10"
                    : "border-warning/40 bg-warning/10 text-warning hover:bg-warning/20",
                )}
              >
                {licensed ? "licensed" : "mark licensed"}
              </button>
            </div>
          </div>
        </div>

        {offLadder ? (
          <div className="mt-4 rounded-xl border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
            Stage is <span className="font-bold text-foreground">{stageLabel(row.onboarding_stage)}</span>, which is a status flag rather than a step on the ladder. Put them back on it with a step below.
            <div className="mt-2 flex flex-wrap gap-1.5">
              {HIRE_RUNGS.map((rung) => (
                <Button key={rung.rank} size="sm" variant="outline" className="h-8" disabled={busy}
                  onClick={() => onMove(row, "stage", rung.stage, row.onboarding_stage)}>
                  {rung.label}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-5" role="group" aria-label={`Move ${row.display_name} through onboarding`}>
            <div className="grid grid-cols-5 gap-1">
              {HIRE_RUNGS.map((rung) => {
                const done = rung.rank <= (rank ?? 0);
                const current = rung.rank === rank;
                const target = stageForRank(rung.rank, row.onboarding_stage);
                return (
                  <button
                    key={rung.rank}
                    type="button"
                    disabled={busy || current || !target}
                    onClick={() => target && onMove(row, "stage", target, row.onboarding_stage)}
                    aria-current={current ? "step" : undefined}
                    title={current ? `Currently ${stageLabel(row.onboarding_stage)}` : `Move to ${rung.label}`}
                    className="min-w-0 text-left disabled:cursor-default"
                  >
                    <div className={cn(
                      "h-1.5 rounded-full transition-colors",
                      done ? "bg-primary" : "bg-muted",
                      !current && !busy && "group-hover:opacity-100",
                    )} />
                    <p className={cn(
                      "mt-1.5 truncate text-[9px] font-bold uppercase tracking-wide",
                      current ? "text-primary" : done ? "text-foreground" : "text-muted-foreground/60",
                    )}>
                      {rung.short}
                    </p>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {stageLabel(row.onboarding_stage)} for {row.days_in_stage} day{row.days_in_stage === 1 ? "" : "s"}
              {row.is_stalled ? " · not moved in over two weeks" : ""}
              {" · click any step to move them"}
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {deals > 0 && (
            <span className="inline-flex items-center gap-1 font-semibold text-foreground">
              <TrendingUp className="h-3 w-3 text-success" /> {deals} deal{deals === 1 ? "" : "s"} · {money(ap)}
            </span>
          )}
          {row.next_call_at && (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3 w-3" /> call {format(new Date(row.next_call_at), "EEE MMM d · h:mma")}
            </span>
          )}
          {Number(row.calls_30d ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1">
              <PhoneCall className="h-3 w-3" />
              {Number(row.calls_30d).toLocaleString()} calls / 30d
              {Number(row.conversations_30d ?? 0) > 0 ? ` · ${row.conversations_30d} conversations` : ""}
            </span>
          )}
          {Number(row.modules_done ?? 0) > 0 && <span>{row.modules_done} course module{Number(row.modules_done) === 1 ? "" : "s"} done</span>}
          {!row.hired_this_month && <span>hired {row.days_since_hired}d ago</span>}
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/25 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Next action</p>
            <p className="text-sm font-bold leading-snug">{row.next_action_label}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {busy && <span className="inline-flex items-center px-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></span>}
            {callHref && <Button asChild size="icon" aria-label={`Call ${row.display_name}`} className="h-10 w-10"><a href={callHref}><Phone className="h-4 w-4" /></a></Button>}
            {textHref && <Button asChild size="icon" variant="outline" aria-label={`Text ${row.display_name}`} className="h-10 w-10"><a href={textHref}><MessageSquare className="h-4 w-4" /></a></Button>}
            {!row.email_missing && row.email && <Button asChild size="icon" variant="outline" aria-label={`Email ${row.display_name}`} className="h-10 w-10"><a href={`mailto:${row.email}`}><Mail className="h-4 w-4" /></a></Button>}
            {!offLadder && (rank ?? 0) < 4 && (
              <Button
                size="sm"
                className="h-10"
                disabled={busy}
                onClick={() => {
                  const next = stageForRank((rank ?? 0) + 1, null);
                  if (next) onMove(row, "stage", next, row.onboarding_stage);
                }}
              >
                <Check className="h-4 w-4" /> {HIRE_RUNGS[(rank ?? 0) + 1]?.label ?? "Advance"}
              </Button>
            )}
            {!offLadder && (rank ?? 0) > 0 && (
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10"
                disabled={busy}
                aria-label={`Move ${row.display_name} back a step`}
                title="Move back a step"
                onClick={() => {
                  const back = stageForRank((rank ?? 0) - 1, null);
                  if (back) onMove(row, "stage", back, row.onboarding_stage);
                }}
              >
                <Undo2 className="h-4 w-4" />
              </Button>
            )}
            <Button asChild size="sm" variant="outline" className="h-10">
              <Link to={`/dashboard/profile?agentId=${row.agent_id}`}>Manage <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}
