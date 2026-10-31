import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { contactLinkProps, formatPhoneDisplay, phoneHref, smsHref } from "@/lib/phone";
import {
  OUTCOMES, callReason, contractingLink, fetchCallList, followupText, licenseText, logFollowup, smsBody,
  type CallRow, type FollowupChannel, type FollowupOutcome,
} from "@/lib/contractingRequests";
import { ChevronDown, Copy, MessageSquare, Phone, Search } from "lucide-react";

const QK = ["contracting-call-list"];

/**
 * My Team › Contracting calls. One job (Sam, 2026-10-14): call the licensed agents who fell off in contracting and get
 * it done. Each row is a person, the next thing they have to do, their number, and Call / Text. Tapping Call or Text
 * logs the attempt at once and asks how it went; anyone touched this week drops below the list so nobody is called
 * twice, and finished people leave it. Unlicensed people are counted, not listed: they cannot contract yet.
 */
export function ContractingCallList() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: QK, queryFn: fetchCallList, staleTime: 30_000, refetchOnWindowFocus: true });
  const [search, setSearch] = useState("");
  const [showNotNow, setShowNotNow] = useState(false);
  const [showFinished, setShowFinished] = useState(false);
  const [showSelling, setShowSelling] = useState(false);
  const [active, setActive] = useState<{ id: string; channel: FollowupChannel } | null>(null);
  const log = useMutation({
    mutationFn: (v: { agentId: string; channel: FollowupChannel; outcome?: FollowupOutcome }) => logFollowup(v.agentId, v.channel, v.outcome),
    onSuccess: (res, v) => {
      if (!res.ok) { toast.error(res.error ?? "Could not log that."); return; }
      if (v.outcome) { toast.success(`Logged: ${OUTCOMES.find((o) => o.key === v.outcome)?.label ?? v.outcome}`); setActive(null); }
      void qc.invalidateQueries({ queryKey: QK });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.rows ?? []).filter((r) => !s || r.display_name.toLowerCase().includes(s) || (r.phone ?? "").includes(s));
  }, [q.data, search]);
  const toCall = rows.filter((r) => r.bucket === "to_call");
  const called = rows.filter((r) => r.bucket === "called_recently");
  const notNow = rows.filter((r) => r.bucket === "not_now");
  const selling = rows.filter((r) => r.bucket === "selling");
  const finished = rows.filter((r) => r.bucket === "finished");
  const activeRow = active ? q.data?.rows.find((r) => r.agent_id === active.id) ?? null : null;

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(contractingLink()); toast.success("Contracting link copied."); }
    catch { toast.error("Could not copy. Long-press the link instead."); }
  };
  const openPerson = (r: CallRow) => { const next = new URLSearchParams(params); next.set("person", r.agent_id); navigate({ search: `?${next.toString()}` }, { replace: true }); };
  /** Call/Text: the attempt is logged the moment the button is tapped, before the phone app takes over. */
  const start = (r: CallRow, channel: FollowupChannel) => { setActive({ id: r.agent_id, channel }); log.mutate({ agentId: r.agent_id, channel }); };

  if (q.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading…</p>;
  if (q.isError || !q.data) {
    return <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">The call list did not load. <button type="button" className="font-semibold underline" onClick={() => void qc.invalidateQueries({ queryKey: QK })}>Retry</button></p>;
  }
  const c = q.data.counts;

  const Row = ({ r, muted }: { r: CallRow; muted?: boolean }) => {
    const call = phoneHref(r.phone);
    const text = smsHref(r.phone, smsBody(r.display_name));
    const phone = formatPhoneDisplay(r.phone);
    const touch = followupText(r);
    return (
      <li className={cn("rounded-xl border border-border bg-card p-3", muted && "opacity-75")}>
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
          <button type="button" onClick={() => openPerson(r)} className="min-w-0 flex-1 text-left" aria-label={`Open ${r.display_name}`}>
            <span className="block truncate text-base font-semibold text-foreground">{r.display_name}</span>
            <span className="block text-sm text-muted-foreground">{licenseText(r)} · {callReason(r)}</span>
            <span className="block text-sm text-foreground/80">{phone || "No phone on file"}{touch ? <span className="text-muted-foreground"> · {touch}</span> : null}</span>
          </button>
          <div className="flex shrink-0 gap-1.5">
            {call ? (
              <a href={call} {...contactLinkProps(call)} onClick={() => start(r, "call")} className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-10 flex-1 gap-1.5 px-3 sm:flex-none")} aria-label={`Call ${r.display_name}`}>
                <Phone className="h-4 w-4" aria-hidden /> Call
              </a>
            ) : null}
            {text ? (
              <a href={text} {...contactLinkProps(text)} onClick={() => start(r, "text")} className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-10 flex-1 gap-1.5 px-3 sm:flex-none")} aria-label={`Text ${r.display_name}`}>
                <MessageSquare className="h-4 w-4" aria-hidden /> Text
              </a>
            ) : null}
            <Button type="button" size="sm" variant="ghost" className="h-10 px-3" onClick={() => setActive({ id: r.agent_id, channel: "note" })} aria-label={`Log a call with ${r.display_name}`}>Log</Button>
          </div>
        </div>
      </li>
    );
  };

  const List = ({ items, muted, empty }: { items: CallRow[]; muted?: boolean; empty?: string }) =>
    items.length === 0
      ? <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground" role="status">{empty}</p>
      : <ul className="space-y-2">{items.map((r) => <Row key={r.agent_id} r={r} muted={muted} />)}</ul>;

  return (
    <section className="space-y-4" aria-label="Contracting calls">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Licensed agents who never finished contracting</h2>
          <p className="text-sm text-muted-foreground">Tap Call, then tap how it went. Anyone touched this week moves below the list; people already selling or finished drop off it.</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-10 gap-1.5" onClick={() => void copyLink()}><Copy className="h-4 w-4" aria-hidden /> Copy link</Button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-primary/50 bg-primary/5 px-2 py-3"><p className="text-2xl font-bold tabular-nums text-foreground">{c.to_call}</p><p className="text-xs text-muted-foreground">to call</p></div>
        <div className="rounded-xl border border-border bg-card px-2 py-3"><p className="text-2xl font-bold tabular-nums text-foreground">{c.called_recently}</p><p className="text-xs text-muted-foreground">called this week</p></div>
        <div className="rounded-xl border border-border bg-card px-2 py-3"><p className="text-2xl font-bold tabular-nums text-foreground">{c.finished}</p><p className="text-xs text-muted-foreground">finished</p></div>
      </div>
      <p className="text-xs text-muted-foreground">
        {c.selling > 0 ? `${c.selling} ${c.selling === 1 ? "person is" : "people are"} already selling, so they are listed below the call list, not in it. ` : ""}{c.unlicensed} unlicensed {c.unlicensed === 1 ? "person is" : "people are"} not shown; they cannot contract until licensed.
        {c.no_phone > 0 ? ` ${c.no_phone} on the list ${c.no_phone === 1 ? "has" : "have"} no phone on file.` : ""}
      </p>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a name or number" aria-label="Search people" className="h-11 pl-9" />
      </div>

      {active && activeRow ? (
        <div className="rounded-xl border border-primary/60 bg-primary/5 p-3" role="region" aria-label={`How did it go with ${activeRow.display_name}`}>
          <p className="text-sm font-semibold text-foreground">{activeRow.display_name} · how did it go?</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {OUTCOMES.map((o) => (
              <Button key={o.key} type="button" size="sm" variant="outline" className="h-9" disabled={log.isPending} onClick={() => log.mutate({ agentId: active.id, channel: active.channel, outcome: o.key })}>{o.label}</Button>
            ))}
            <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => setActive(null)}>Skip</Button>
          </div>
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground">To call · {toCall.length}</h3>
        <List items={toCall} empty={search ? "No one on the list matches that." : "Everyone licensed has finished or been reached this week."} />
      </div>

      {called.length > 0 ? (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Called this week · {called.length}</h3>
          <List items={called} muted />
        </div>
      ) : null}

      {notNow.length > 0 ? (
        <div>
          <button type="button" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground" aria-expanded={showNotNow} onClick={() => setShowNotNow((v) => !v)}>
            Not interested right now · {notNow.length} <ChevronDown className={cn("h-4 w-4 transition-transform", showNotNow && "rotate-180")} aria-hidden />
          </button>
          {showNotNow ? <div className="mt-2"><List items={notNow} muted /></div> : null}
        </div>
      ) : null}

      {selling.length > 0 ? (
        <div>
          <button type="button" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground" aria-expanded={showSelling} onClick={() => setShowSelling((v) => !v)}>
            Already selling · {selling.length} <ChevronDown className={cn("h-4 w-4 transition-transform", showSelling && "rotate-180")} aria-hidden />
          </button>
          {showSelling ? <div className="mt-2"><List items={selling} muted /></div> : null}
        </div>
      ) : null}

      <div>
        <button type="button" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground" aria-expanded={showFinished} onClick={() => setShowFinished((v) => !v)}>
          Finished · {finished.length} <ChevronDown className={cn("h-4 w-4 transition-transform", showFinished && "rotate-180")} aria-hidden />
        </button>
        {showFinished ? <div className="mt-2"><List items={finished} muted empty="Nobody yet." /></div> : null}
      </div>
    </section>
  );
}
