/**
 * ProducerDetailsDrawer — deep-profile Sheet for a single producer in the
 * MP-259 Producer Trends surface. Right-side on desktop, full-viewport on
 * mobile. Reuses the existing agent tables + views + agent_notes coaching
 * history — never invents columns.
 *
 * Sections (per Sam's MP-259 brief):
 *   1. Producer profile
 *   2. Manager
 *   3. Stage
 *   4. AgentLink status
 *   5. Weekly ALP mini-chart (last 12 weeks from v_agent_weekly_production)
 *   6. Policy count (agents.total_policies)
 *   7. Production trend (delta % vs 3 weeks ago)
 *   8. Last contact (max(agent_notes.created_at))
 *   9. Training status (agents.onboarding_stage / license_status)
 *  10. Next Best Action + primary CTA
 *  11. Notes composer
 *  12. Coaching history (agent_notes list — sorted desc)
 *  13. Assign follow-up (queues a note with [FOLLOW_UP due YYYY-MM-DD] tag)
 *  14. Mark reviewed + Mark recovered buttons (agent_notes with canonical tag)
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ExternalLink,
  Loader2,
  UserCheck,
  Link2,
  Link2Off,
  ClipboardCheck,
  CheckCheck,
  CalendarClock,
  MessageSquarePlus,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { getNextBestAction } from "@/lib/nextBestAction";
import {
  getPriorityScore,
  getPriorityLabel,
  priorityBadgeClasses,
} from "@/lib/priority";

export interface ProducerDrawerInput {
  producer_id: string;
  display_name: string;
  current_week_alp: number;
  alp_1w_ago: number | null;
  alp_2w_ago: number | null;
  alp_3_weeks_ago: number | null;
  delta_pct: number;
  direction: "up" | "down" | "flat";
  currently_dropping: boolean;
  weekly_series: number[];
  never_activated_60_days?: boolean;
  no_alp_30_days?: boolean;
  no_agentlink?: boolean;
  no_recent_contact?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  producer: ProducerDrawerInput | null;
}

interface AgentDetail {
  id: string;
  display_name: string | null;
  agent_code: string | null;
  status: string | null;
  onboarding_stage: string | null;
  license_status: string | null;
  al_user_id: string | null;
  manager_id: string | null;
  total_policies: number | null;
  first_deal_at: string | null;
}

interface AgentNoteRow {
  id: string;
  agent_id: string;
  note: string;
  created_at: string;
}

function fmtUSDCompact(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ProducerDetailsDrawer({
  open,
  onOpenChange,
  producer,
}: Props) {
  const qc = useQueryClient();
  const [noteText, setNoteText] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");

  // Agent detail — real columns only. Missing = fallback.
  const agentQ = useQuery<AgentDetail | null>({
    enabled: !!producer?.producer_id,
    queryKey: ["mp259-agent-detail", producer?.producer_id],
    queryFn: async () => {
      const q: any = supabase;
      const { data, error } = await q
        .from("agents")
        .select(
          "id, display_name, agent_code, status, onboarding_stage, license_status, al_user_id, manager_id, total_policies, first_deal_at",
        )
        .eq("id", producer!.producer_id)
        .maybeSingle();
      if (error) return null;
      return (data ?? null) as AgentDetail | null;
    },
  });

  const managerQ = useQuery<{ id: string; display_name: string | null } | null>({
    enabled: !!agentQ.data?.manager_id,
    queryKey: ["mp259-agent-manager", agentQ.data?.manager_id],
    queryFn: async () => {
      const q: any = supabase;
      const { data, error } = await q
        .from("agents")
        .select("id, display_name")
        .eq("id", agentQ.data!.manager_id)
        .maybeSingle();
      if (error) return null;
      return (data ?? null) as { id: string; display_name: string | null } | null;
    },
  });

  // Coaching history from agent_notes — chronological desc.
  const notesQ = useQuery<AgentNoteRow[]>({
    enabled: !!producer?.producer_id,
    queryKey: ["mp259-agent-notes", producer?.producer_id],
    queryFn: async () => {
      const q: any = supabase;
      const { data, error } = await q
        .from("agent_notes")
        .select("id, agent_id, note, created_at")
        .eq("agent_id", producer!.producer_id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) return [];
      return (data ?? []) as AgentNoteRow[];
    },
  });

  const lastContact = useMemo(() => notesQ.data?.[0]?.created_at ?? null, [notesQ.data]);

  const nba = useMemo(() => {
    if (!producer) return null;
    return getNextBestAction({
      kind: "producer_risk",
      dropped_3_weeks: producer.currently_dropping,
      down_this_week: producer.direction === "down" && !producer.currently_dropping,
      never_activated_60_days: producer.never_activated_60_days,
      no_alp_30_days: producer.no_alp_30_days,
      no_agentlink: producer.no_agentlink,
      no_recent_contact: producer.no_recent_contact,
    });
  }, [producer]);

  const priorityBadge = useMemo(() => {
    if (!producer) return null;
    const score = getPriorityScore({
      kind: "producer_risk",
      dropped_3_weeks: producer.currently_dropping,
      down_this_week: producer.direction === "down" && !producer.currently_dropping,
      never_activated_60_days: producer.never_activated_60_days,
      no_alp_30_days: producer.no_alp_30_days,
      no_agentlink: producer.no_agentlink,
      no_recent_contact: producer.no_recent_contact,
    });
    return priorityBadgeClasses(getPriorityLabel(score));
  }, [producer]);

  const writeNote = useMutation({
    mutationFn: async (payload: { note: string }) => {
      if (!producer) throw new Error("No producer selected");
      const q: any = supabase;
      const { error } = await q.from("agent_notes").insert({
        agent_id: producer.producer_id,
        note: payload.note,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mp259-agent-notes", producer?.producer_id] });
      qc.invalidateQueries({ queryKey: ["producer-trend-alert"] });
      qc.invalidateQueries({ queryKey: ["mp259-review-tags"] });
    },
  });

  function submitNote() {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    writeNote.mutate(
      { note: trimmed },
      {
        onSuccess: () => {
          setNoteText("");
          toast.success("Note logged");
        },
        onError: (e: any) => toast.error(e?.message ?? "Failed to log note"),
      },
    );
  }

  function markReviewed() {
    writeNote.mutate(
      { note: `[REVIEWED] Producer trend reviewed on ${new Date().toISOString().slice(0, 10)}` },
      {
        onSuccess: () => toast.success("Marked reviewed"),
        onError: (e: any) => toast.error(e?.message ?? "Failed to mark reviewed"),
      },
    );
  }

  function markRecovered() {
    writeNote.mutate(
      { note: `[RECOVERED] Producer recovered on ${new Date().toISOString().slice(0, 10)}` },
      {
        onSuccess: () => toast.success("Marked recovered"),
        onError: (e: any) => toast.error(e?.message ?? "Failed to mark recovered"),
      },
    );
  }

  function scheduleFollowUp() {
    if (!followUpDate) {
      toast.error("Pick a follow-up date");
      return;
    }
    writeNote.mutate(
      { note: `[FOLLOW_UP due ${followUpDate}] Assigned by producer trends review` },
      {
        onSuccess: () => {
          toast.success(`Follow-up assigned for ${followUpDate}`);
          setFollowUpDate("");
        },
        onError: (e: any) => toast.error(e?.message ?? "Failed to schedule"),
      },
    );
  }

  if (!producer) return null;
  const agent = agentQ.data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg border-l border-white/[0.08] bg-card text-foreground overflow-y-auto"
      >
        <SheetHeader className="text-left space-y-1">
          <div className="flex items-center gap-2">
            {priorityBadge && (
              <Badge className={cn("text-[10px] font-semibold", priorityBadge.className)}>
                {priorityBadge.text}
              </Badge>
            )}
            {producer.currently_dropping && (
              <Badge className="bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[10px] font-semibold">
                DROPPING 3W
              </Badge>
            )}
          </div>
          <SheetTitle className="text-xl font-bold text-foreground">
            {producer.display_name}
          </SheetTitle>
          <SheetDescription className="text-muted-foreground">
            Weekly ALP trend, coaching history, and next-best-action for this producer.
          </SheetDescription>
        </SheetHeader>

        {/* 1 · Profile · 2 · Manager · 3 · Stage · 4 · AgentLink · 6 · Policies */}
        <section className="mt-5 rounded-lg border border-white/[0.08] bg-muted/30 p-4 space-y-2 text-sm">
          <Row label="Agent code" value={agent?.agent_code ?? "—"} />
          <Row
            label="Manager"
            value={managerQ.data?.display_name ?? (agent?.manager_id ? "—" : "Unassigned")}
          />
          <Row
            label="Stage"
            value={agent?.onboarding_stage ?? agent?.status ?? "—"}
          />
          <Row
            label="License status"
            value={agent?.license_status ?? "—"}
          />
          <Row
            label="AgentLink"
            value={
              <span className="inline-flex items-center gap-1.5">
                {agent?.al_user_id ? (
                  <>
                    <Link2 className="h-3.5 w-3.5 text-emerald-400" />
                    linked
                  </>
                ) : (
                  <>
                    <Link2Off className="h-3.5 w-3.5 text-amber-400" />
                    unlinked
                  </>
                )}
              </span>
            }
          />
          <Row label="Policies" value={agent?.total_policies ?? "—"} />
          <Row label="First deal" value={fmtDate(agent?.first_deal_at)} />
          <Row label="Last contact" value={fmtDate(lastContact)} />
        </section>

        {/* 5 · Weekly ALP mini-chart */}
        <section className="mt-4 rounded-lg border border-white/[0.08] bg-muted/30 p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Weekly ALP · last 12 weeks
          </div>
          <MiniChart
            series={producer.weekly_series}
            highlight={
              producer.currently_dropping
                ? "rose"
                : producer.direction === "up"
                  ? "emerald"
                  : "muted"
            }
          />
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              This week <span className="font-semibold tabular-nums text-foreground">{fmtUSDCompact(producer.current_week_alp)}</span>
            </span>
            <span className="text-muted-foreground">
              3W ago <span className="tabular-nums">{fmtUSDCompact(producer.alp_3_weeks_ago)}</span>
            </span>
            <span
              className={cn(
                "tabular-nums font-semibold",
                producer.delta_pct < -25 && "text-rose-400",
                producer.delta_pct >= -25 && producer.delta_pct < 0 && "text-amber-400",
                producer.delta_pct === 0 && "text-muted-foreground",
                producer.delta_pct > 0 && "text-emerald-400",
              )}
            >
              {producer.delta_pct > 0 ? "+" : ""}
              {producer.delta_pct}%
            </span>
          </div>
        </section>

        {/* 10 · Next Best Action */}
        {nba && (
          <section className="mt-4 rounded-lg border border-teal-500/30 bg-teal-500/10 p-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-teal-300 mb-1">
              Next best action
            </div>
            <div className="text-sm font-semibold text-foreground">{nba.action}</div>
            <div className="text-xs text-muted-foreground mt-1">{nba.reason}</div>
            {nba.cta && (
              <Button
                size="sm"
                className="mt-3 bg-teal-500 hover:bg-teal-500/90 text-slate-950 font-semibold"
                onClick={markReviewed}
                disabled={writeNote.isPending}
              >
                {nba.cta}
              </Button>
            )}
          </section>
        )}

        {/* 11 · Notes composer */}
        <section className="mt-4 rounded-lg border border-white/[0.08] bg-muted/30 p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2 flex items-center gap-1.5">
            <MessageSquarePlus className="h-3.5 w-3.5" /> Log coaching note
          </div>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="What did you cover with this producer?"
            className="w-full min-h-[70px] rounded-md border border-white/[0.08] bg-card p-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-teal-500/50 focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={submitNote}
              disabled={writeNote.isPending || !noteText.trim()}
              className="border-white/[0.14] text-foreground hover:bg-white/[0.04]"
            >
              {writeNote.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save note"}
            </Button>
          </div>
        </section>

        {/* 13 · Assign follow-up */}
        <section className="mt-4 rounded-lg border border-white/[0.08] bg-muted/30 p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2 flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" /> Assign follow-up
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              className="bg-card border-white/[0.08] text-foreground"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={scheduleFollowUp}
              disabled={writeNote.isPending || !followUpDate}
              className="border-white/[0.14] text-foreground hover:bg-white/[0.04]"
            >
              Assign
            </Button>
          </div>
        </section>

        {/* 14 · Mark reviewed + Mark recovered */}
        <section className="mt-4 grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={markReviewed}
            disabled={writeNote.isPending}
            className="border-info/30 bg-info/10 text-info hover:bg-info/20"
          >
            <ClipboardCheck className="h-4 w-4 mr-1.5" /> Mark reviewed
          </Button>
          <Button
            variant="outline"
            onClick={markRecovered}
            disabled={writeNote.isPending}
            className="border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
          >
            <CheckCheck className="h-4 w-4 mr-1.5" /> Mark recovered
          </Button>
        </section>

        {/* 12 · Coaching history */}
        <section className="mt-4 rounded-lg border border-white/[0.08] bg-muted/30 p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Coaching history
          </div>
          {notesQ.isLoading ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : (notesQ.data ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">No notes yet.</div>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {(notesQ.data ?? []).map((n) => (
                <li
                  key={n.id}
                  className="rounded border border-white/[0.05] bg-card p-2 text-xs"
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {fmtDate(n.created_at)}
                  </div>
                  <div className="text-foreground whitespace-pre-wrap mt-0.5">{n.note}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {agent?.id && (
          <div className="mt-5">
            <a
              href={`/dashboard/agents/${agent.id}`}
              className="inline-flex items-center gap-1 text-xs text-teal-300 hover:text-teal-200"
            >
              Open full profile <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        <div className="h-6" />
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground tabular-nums text-right">{value}</span>
    </div>
  );
}

function MiniChart({
  series,
  highlight,
}: {
  series: number[];
  highlight: "rose" | "emerald" | "muted";
}) {
  if (!series || series.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">No weekly production data yet.</div>
    );
  }
  const max = Math.max(...series, 1);
  const barClass =
    highlight === "rose"
      ? "bg-rose-400/70"
      : highlight === "emerald"
        ? "bg-emerald-400/70"
        : "bg-muted-foreground/40";
  return (
    <div
      className="flex items-end gap-1 h-16 w-full"
      role="img"
      aria-label={`Weekly ALP series across ${series.length} weeks`}
    >
      {series.map((v, i) => (
        // stable-key-allow:deterministic-week-index-fixed-length-sparkline
        <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
          <div
            className={cn("w-full rounded-sm", barClass)}
            style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
            title={`Week ${i + 1}: $${v.toLocaleString()}`}
          />
        </div>
      ))}
    </div>
  );
}

export { MiniChart as ProducerMiniChart };
