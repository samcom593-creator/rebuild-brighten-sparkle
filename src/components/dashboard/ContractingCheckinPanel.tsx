import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowRight, Check, Copy, Flag, List, MessageSquare, Phone, PhoneCall, PhoneOff, Search, UserX, Voicemail, X,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/dateUtils";
import { contactLinkProps, formatPhoneDisplay, phoneHref, smsHref, startPhoneCall } from "@/lib/phone";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/hooks/useConfirm";
import { markNoLongerWithUs } from "@/lib/noLongerWithUs";

/**
 * Contracting call list (2026-09-30).
 *
 * Sam, running check-ins: "make it easier for me to call them directly from the
 * dashboard ... show me their phone numbers ... so I can get through it a lot
 * smoother." Two views over one list:
 *   - List: every person, grouped by where their contracts stand.
 *   - Call mode: one person at a time, big Call/Text buttons, one-tap outcome
 *     that logs the call and jumps to the next person.
 * The list holds agents, licensed applicants and people who only exist by name.
 * Every tick, call and note is written through set_contracting_checkin() and
 * logged with who did it.
 */
type Stage = "needs_contracts" | "contracts_sent" | "contracts_confirmed" | "ready_for_training" | "producing";
type Step = "contracts_sent" | "contracts_confirmed" | "training_ready";
type Outcome = "talked" | "no_answer" | "voicemail" | "texted" | "wrong_number";

type Row = {
  checkin_id: string | null;
  agent_id: string | null;
  display_name: string;
  manager_name: string | null;
  phone: string | null;
  email: string | null;
  agent_status: string;
  license_status: string | null;
  npn: string | null;
  is_agent: boolean;
  source: string;
  intake_received: boolean;
  deals_30d: number;
  producing: boolean;
  flagged: boolean;
  contracts_sent_at: string | null;
  contracts_confirmed_at: string | null;
  training_ready_at: string | null;
  last_call_at: string | null;
  last_call_outcome: Outcome | null;
  call_count: number;
  last_checkin_at: string | null;
  note: string | null;
  stage: Stage;
};

const STAGE_LABEL: Record<Stage, string> = {
  needs_contracts: "No contracts yet",
  contracts_sent: "Contracts sent",
  contracts_confirmed: "Contracted",
  ready_for_training: "Ready for training",
  producing: "Producing",
};
const STAGE_TONE: Record<Stage, string> = {
  needs_contracts: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  contracts_sent: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  contracts_confirmed: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  ready_for_training: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  producing: "bg-emerald-500/10 text-emerald-200 border-emerald-500/20",
};

const TABS: { key: string; label: string; match: (r: Row) => boolean }[] = [
  { key: "list", label: "Your no-contracts list", match: (r) => r.flagged },
  { key: "needs_contracts", label: "No contracts", match: (r) => r.stage === "needs_contracts" },
  { key: "contracts_sent", label: "Sent", match: (r) => r.stage === "contracts_sent" },
  { key: "contracts_confirmed", label: "Contracted", match: (r) => r.stage === "contracts_confirmed" },
  { key: "ready_for_training", label: "Ready for training", match: (r) => r.stage === "ready_for_training" },
  { key: "producing", label: "Producing", match: (r) => r.stage === "producing" },
  { key: "all", label: "Everyone", match: () => true },
];

const STEPS: { step: Step; label: string; field: "contracts_sent_at" | "contracts_confirmed_at" | "training_ready_at" }[] = [
  { step: "contracts_sent", label: "Contracts sent", field: "contracts_sent_at" },
  { step: "contracts_confirmed", label: "Contracts confirmed", field: "contracts_confirmed_at" },
  { step: "training_ready", label: "Ready for training", field: "training_ready_at" },
];

const OUTCOMES: { key: Outcome; label: string; icon: typeof Check; tone: string; hotkey: string }[] = [
  { key: "talked", label: "Talked", icon: PhoneCall, tone: "bg-emerald-600 hover:bg-emerald-500 text-white", hotkey: "1" },
  { key: "no_answer", label: "No answer", icon: PhoneOff, tone: "bg-zinc-700 hover:bg-zinc-600 text-white", hotkey: "2" },
  { key: "voicemail", label: "Left voicemail", icon: Voicemail, tone: "bg-zinc-700 hover:bg-zinc-600 text-white", hotkey: "3" },
  { key: "texted", label: "Texted", icon: MessageSquare, tone: "bg-zinc-700 hover:bg-zinc-600 text-white", hotkey: "4" },
  { key: "wrong_number", label: "Wrong number", icon: X, tone: "bg-rose-900/70 hover:bg-rose-800 text-white", hotkey: "5" },
];
const OUTCOME_LABEL: Record<Outcome, string> = {
  talked: "Talked", no_answer: "No answer", voicemail: "Left voicemail", texted: "Texted", wrong_number: "Wrong number",
};

function digitsOf(phone: string | null): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}
// Call/Text go through @/lib/phone: native dialer on phones, Google Voice on desktop.
const telHref = (p: string | null) => (digitsOf(p) ? phoneHref(p) : null);
const rowKey = (r: Row) => r.agent_id ?? r.checkin_id ?? r.display_name;
const calledToday = (r: Row) =>
  !!r.last_call_at && new Date(r.last_call_at).toDateString() === new Date().toDateString();

function StatusBadges({ r }: { r: Row }) {
  return (
    <>
      <Badge variant="outline" className={cn("text-[12px]", STAGE_TONE[r.stage])}>{STAGE_LABEL[r.stage]}</Badge>
      {r.agent_status === "terminated" && <Badge variant="outline" className="border-rose-500/50 text-[12px] text-rose-300">Terminated in system</Badge>}
      {r.agent_status === "inactive" && <Badge variant="outline" className="border-amber-500/50 text-[12px] text-amber-300">Inactive in system</Badge>}
      {!r.is_agent && <Badge variant="outline" className="text-[12px]">Not an agent yet · {r.source}</Badge>}
      {r.license_status === "licensed" ? (
        <Badge variant="outline" className="text-[12px]">Licensed</Badge>
      ) : r.license_status ? (
        <Badge variant="outline" className="text-[12px] text-muted-foreground">Not licensed</Badge>
      ) : null}
      {r.npn ? (
        <span className="text-[12px] text-muted-foreground">NPN {r.npn}</span>
      ) : (
        <Badge variant="outline" className="border-rose-500/40 text-[12px] text-rose-300">No NPN</Badge>
      )}
      {r.producing && (
        <span className="text-[12px] text-emerald-300">{r.deals_30d} deal{r.deals_30d === 1 ? "" : "s"} in 30 days</span>
      )}
    </>
  );
}

export function ContractingCheckinPanel() {
  const qc = useQueryClient();
  const askConfirm = useConfirm();
  const { isAdmin, isManager } = useAuth();
  const canRemove = !!(isAdmin || isManager);
  const [tab, setTab] = useState("list");
  const [mode, setMode] = useState<"list" | "call">("call");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["contracting-checkin"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("contracting_checkin_list" as never);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const all = useMemo(() => data ?? [], [data]);
  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0];

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter(activeTab.match)
      .filter((r) => !q || `${r.display_name} ${r.manager_name ?? ""} ${r.phone ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [all, activeTab, search]);

  // Call order: people not yet reached today first, people with no number last.
  const queue = useMemo(
    () => [...rows].sort((a, b) =>
      Number(calledToday(a)) - Number(calledToday(b)) ||
      Number(!digitsOf(a.phone)) - Number(!digitsOf(b.phone)) ||
      a.display_name.localeCompare(b.display_name)),
    [rows],
  );
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const current = useMemo(() => {
    if (pinnedKey) {
      const hit = queue.find((r) => rowKey(r) === pinnedKey);
      if (hit) return hit;
    }
    return queue[Math.min(cursor, Math.max(queue.length - 1, 0))];
  }, [queue, cursor, pinnedKey]);
  const currentIndex = current ? queue.indexOf(current) : -1;

  const save = useCallback(
    async (r: Row, step: Step | "note" | "call" | "flag" | "phone", done: boolean, note?: string | null) => {
      setBusy(true);
      const { error } = await supabase.rpc("set_contracting_checkin" as never, {
        p_checkin_id: r.agent_id ? null : r.checkin_id,
        p_agent_id: r.agent_id,
        p_step: step,
        p_done: done,
        p_note: note ?? null,
      } as never);
      setBusy(false);
      if (error) {
        toast.error(`Not saved for ${r.display_name}: ${error.message}`);
        return false;
      }
      await qc.invalidateQueries({ queryKey: ["contracting-checkin"] });
      return true;
    },
    [qc],
  );

  const go = useCallback(
    (delta: number) => {
      if (!queue.length) return;
      const next = (Math.max(currentIndex, 0) + delta + queue.length) % queue.length;
      setPinnedKey(rowKey(queue[next]));
      setCursor(next);
    },
    [queue, currentIndex],
  );

  const logCall = useCallback(
    async (outcome: Outcome) => {
      if (!current || busy) return;
      const nextRow = queue[(currentIndex + 1) % queue.length];
      const ok = await save(current, "call", true, outcome);
      if (ok) {
        toast.success(`${current.display_name}: ${OUTCOME_LABEL[outcome]}`);
        if (nextRow && rowKey(nextRow) !== rowKey(current)) setPinnedKey(rowKey(nextRow));
      }
    },
    [current, busy, queue, currentIndex, save],
  );

  // "No longer with us": set inactive (off the roster and this list), log it,
  // then send the re-engagement email. The roster change never waits on email.
  const markLeft = useCallback(
    async (r: Row) => {
      const ok = await askConfirm({
        title: `${r.display_name} is no longer with us?`,
        description: r.is_agent
          ? "They'll be set inactive and removed from your roster and this list, which also ends their team access. We'll email them that the door is still open."
          : "They'll be removed from this list. We'll email them that the door is still open.",
        confirmText: "Remove and send email",
        tone: "danger",
      });
      if (!ok) return;
      const nextRow = queue[(currentIndex + 1) % Math.max(queue.length, 1)];
      setBusy(true);
      const out = await markNoLongerWithUs({ agentId: r.agent_id, checkinId: r.checkin_id, displayName: r.display_name });
      setBusy(false);
      if (!out.ok || out.emailFailed) toast.error(out.message);
      else toast.success(out.message);
      if (!out.ok) return;
      if (nextRow && rowKey(nextRow) !== rowKey(r)) setPinnedKey(rowKey(nextRow));
      await qc.invalidateQueries({ queryKey: ["contracting-checkin"] });
    },
    [askConfirm, queue, currentIndex, qc],
  );

  // Keyboard: ← → move, C calls, 1-5 log an outcome. Ignored while typing.
  useEffect(() => {
    if (mode !== "call") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key.toLowerCase() === "c" && current && telHref(current.phone)) { startPhoneCall(current.phone); }
      else {
        const o = OUTCOMES.find((x) => x.hotkey === e.key);
        if (o) { e.preventDefault(); void logCall(o.key); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, go, logCall, current]);

  if (isLoading) return <Skeleton className="h-56 w-full" />;
  if (isError) {
    return <p className="text-sm text-rose-400">The contracting list did not load. Nothing is being guessed at in its place; refresh to retry.</p>;
  }

  const flagged = all.filter((r) => r.flagged);
  const flaggedSent = flagged.filter((r) => r.contracts_sent_at).length;
  const flaggedReady = flagged.filter((r) => r.training_ready_at).length;
  const flaggedCalledToday = flagged.filter(calledToday).length;

  return (
    <div className="space-y-4">
      {/* Progress on Sam's list */}
      {flagged.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "On your list", value: flagged.length },
            { label: "Called today", value: `${flaggedCalledToday}/${flagged.length}` },
            { label: "Contracts sent", value: `${flaggedSent}/${flagged.length}` },
            { label: "Ready for training", value: `${flaggedReady}/${flagged.length}` },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-background/40 px-3 py-2">
              <div className="text-[12px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
              <div className="text-xl font-semibold tabular-nums">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs + mode switch */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => {
            const n = all.filter(t.match).length;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => { setTab(t.key); setCursor(0); setPinnedKey(null); }}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition",
                  tab === t.key ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label} <span className="tabular-nums opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative w-44 sm:w-56">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="h-9 pl-8" />
          </div>
          <div className="flex rounded-md border border-border p-0.5">
            <Button size="sm" variant={mode === "call" ? "default" : "ghost"} className="h-8 gap-1.5" onClick={() => setMode("call")}>
              <Phone className="h-4 w-4" /> Call mode
            </Button>
            <Button size="sm" variant={mode === "list" ? "default" : "ghost"} className="h-8 gap-1.5" onClick={() => setMode("list")}>
              <List className="h-4 w-4" /> List
            </Button>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nobody here.</p>
      ) : mode === "call" && current ? (
        <CallCard
          r={current}
          index={currentIndex}
          total={queue.length}
          busy={busy}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          onOutcome={logCall}
          onStep={(step, done) => save(current, step, done)}
          onNote={(v) => save(current, "note", true, v)}
          onPhone={(v) => save(current, "phone", true, v)}
          onLeft={canRemove ? () => markLeft(current) : undefined}
        />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {rows.map((r) => {
            const tel = telHref(r.phone);
            return (
              <div key={rowKey(r)} className="flex flex-col gap-2 bg-card p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="truncate text-left font-semibold hover:underline"
                      onClick={() => { setPinnedKey(rowKey(r)); setMode("call"); }}
                    >
                      {r.display_name}
                    </button>
                    {r.manager_name && <span className="text-xs text-muted-foreground">under {r.manager_name}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5"><StatusBadges r={r} /></div>
                  {(r.last_call_at || r.note) && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {r.last_call_at && r.last_call_outcome && <>Last call: {OUTCOME_LABEL[r.last_call_outcome]} {formatTimeAgo(r.last_call_at)}</>}
                      {r.last_call_at && r.note && " · "}
                      {r.note}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {tel ? (
                    <>
                      <span className="font-mono text-sm tabular-nums">{formatPhoneDisplay(r.phone)}</span>
                      <Button asChild size="sm" className="h-8 gap-1 bg-emerald-600 text-white hover:bg-emerald-500">
                        <a href={tel} {...contactLinkProps(tel)}><Phone className="h-3.5 w-3.5" /> Call</a>
                      </Button>
                      <Button asChild size="sm" variant="outline" className="h-8 gap-1">
                        <a href={smsHref(r.phone) ?? undefined} {...contactLinkProps(smsHref(r.phone))}><MessageSquare className="h-3.5 w-3.5" /> Text</a>
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-rose-300">No phone on file</span>
                  )}
                  <div className="flex gap-1">
                    {STEPS.map((s) => {
                      const on = !!r[s.field];
                      return (
                        <button
                          key={s.step}
                          type="button"
                          title={s.label}
                          disabled={busy}
                          onClick={() => save(r, s.step, !on)}
                          className={cn(
                            "rounded-md border px-2 py-1 text-[12px] transition",
                            on ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {on && <Check className="mr-0.5 inline h-3 w-3" />}
                          {s.step === "contracts_sent" ? "Sent" : s.step === "contracts_confirmed" ? "Confirmed" : "Training"}
                        </button>
                      );
                    })}
                  </div>
                  {!r.flagged && (
                    <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs text-muted-foreground" onClick={() => save(r, "flag", true)}>
                      <Flag className="h-3.5 w-3.5" /> Add to list
                    </Button>
                  )}
                  {canRemove && (
                    <Button size="sm" variant="ghost" disabled={busy} className="h-8 gap-1 text-xs text-rose-300 hover:text-rose-200" onClick={() => markLeft(r)}>
                      <UserX className="h-3.5 w-3.5" /> No longer with us
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CallCard(props: {
  r: Row;
  index: number;
  total: number;
  busy: boolean;
  onPrev: () => void;
  onNext: () => void;
  onOutcome: (o: Outcome) => void;
  onStep: (step: Step, done: boolean) => void;
  onNote: (v: string) => void;
  onPhone: (v: string) => void;
  onLeft?: () => void;
}) {
  const { r, index, total, busy } = props;
  const tel = telHref(r.phone);
  const [phoneDraft, setPhoneDraft] = useState("");
  const pct = total ? Math.round(((index + 1) / total) * 100) : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="h-1 bg-border"><div className="h-1 bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
      <div className="flex items-center justify-between px-4 pt-3 text-xs text-muted-foreground">
        <span>Person {index + 1} of {total}</span>
        <span className="hidden sm:inline">Keys: ← → move · C call · 1-5 log outcome</span>
      </div>

      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold leading-tight sm:text-3xl">{r.display_name}</h2>
            <div className="mt-1 text-sm text-muted-foreground">
              {r.manager_name ? `Under ${r.manager_name}` : r.is_agent ? "No manager set" : "Not on the roster yet"}
              {r.email && <> · {r.email}</>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5"><StatusBadges r={r} /></div>
          </div>

          {tel ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => { void navigator.clipboard.writeText(formatPhoneDisplay(r.phone)); toast.success("Number copied"); }}
                className="group inline-flex items-center gap-2 font-mono text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl"
                title="Copy number"
              >
                {formatPhoneDisplay(r.phone)}
                <Copy className="h-4 w-4 opacity-0 transition group-hover:opacity-60" />
              </button>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="lg" className="h-12 gap-2 bg-emerald-600 px-6 text-base text-white hover:bg-emerald-500">
                  <a href={tel} {...contactLinkProps(tel)}><Phone className="h-5 w-5" /> Call</a>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-12 gap-2 px-6 text-base">
                  <a href={smsHref(r.phone) ?? undefined} {...contactLinkProps(smsHref(r.phone))}><MessageSquare className="h-5 w-5" /> Text</a>
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
              <div className="text-sm text-rose-300">No phone number on file.</div>
              {!r.is_agent && (
                <div className="flex gap-2">
                  <Input value={phoneDraft} onChange={(e) => setPhoneDraft(e.target.value)} placeholder="Add their number" className="h-9" />
                  <Button size="sm" className="h-9" disabled={!digitsOf(phoneDraft) || busy} onClick={() => { props.onPhone(phoneDraft); setPhoneDraft(""); }}>
                    Save
                  </Button>
                </div>
              )}
            </div>
          )}

          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">How did the call go?</div>
            <div className="flex flex-wrap gap-2">
              {OUTCOMES.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  disabled={busy}
                  onClick={() => props.onOutcome(o.key)}
                  className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition disabled:opacity-50", o.tone)}
                >
                  <o.icon className="h-4 w-4" /> {o.label}
                  <span className="ml-1 rounded bg-black/20 px-1 text-[11px] opacity-70">{o.hotkey}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {r.last_call_at && r.last_call_outcome
                ? <>Last call: {OUTCOME_LABEL[r.last_call_outcome]} {formatTimeAgo(r.last_call_at)} · {r.call_count} call{r.call_count === 1 ? "" : "s"} logged</>
                : "Not called yet"}
              {" · logging an outcome moves to the next person"}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Contracts</div>
            <div className="space-y-2">
              {STEPS.map((s) => {
                const at = r[s.field];
                return (
                  <button
                    key={s.step}
                    type="button"
                    disabled={busy}
                    onClick={() => props.onStep(s.step, !at)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition",
                      at ? "border-emerald-500/40 bg-emerald-500/10" : "border-border hover:border-foreground/30",
                    )}
                  >
                    <span className={cn("flex h-5 w-5 items-center justify-center rounded border", at ? "border-emerald-400 bg-emerald-500 text-white" : "border-muted-foreground/50")}>
                      {at && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="flex-1 text-sm font-medium">{s.label}</span>
                    {at && <span className="text-[12px] text-muted-foreground">{formatTimeAgo(at)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</div>
            <textarea
              key={`${r.agent_id ?? r.checkin_id}-${r.note ?? ""}`}
              defaultValue={r.note ?? ""}
              rows={3}
              placeholder="What did they say? Saves when you click away."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              onBlur={(e) => { if (e.target.value.trim() !== (r.note ?? "")) props.onNote(e.target.value.trim()); }}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border px-4 py-3">
        <Button variant="ghost" className="gap-1.5" onClick={props.onPrev}><ArrowLeft className="h-4 w-4" /> Previous</Button>
        {props.onLeft && (
          <Button variant="ghost" disabled={busy} className="gap-1.5 text-rose-300 hover:text-rose-200" onClick={props.onLeft}>
            <UserX className="h-4 w-4" /> No longer with us
          </Button>
        )}
        <Button variant="outline" className="gap-1.5" onClick={props.onNext}>Skip <ArrowRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
