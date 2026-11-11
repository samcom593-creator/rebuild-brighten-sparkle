// MyLeads: the leads Sam or Aisha gave you to work (MP-310 wave 3, 2026-10-29).
//
// my_lead_bundles() returns only the caller's live leads in bundles they hold, with the dialer's do-not-call numbers
// already removed. One tap records what happened (lead_bundle_item_set). Do not call takes the Call link away for
// good, and the number never goes into another bundle.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Inbox, Info, Phone, PhoneCall, Mic, Check, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { contactLinkProps, formatPhoneDisplay, phoneHref } from "@/lib/phone";
import { dispositionLabel } from "@/lib/readymodeDispositions";
import { LEAD_STATUS_BUTTONS, TIER_STYLE, canDial, flagBadges, formatLabel, isOpenLead, leadStatusLabel, tierLabel, tierLegendFor } from "@/lib/leadBundles";
import { dialTapHandler } from "@/lib/leadDialTap";
import { cn } from "@/lib/utils";
import { CallCenterVoiceRecorder } from "@/components/callcenter/CallCenterVoiceRecorder";

interface MyLead {
  item_id: string;
  bundle_id: string;
  bundle_name: string;
  bundle_note: string | null;
  format: string;
  phone10: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  state: string | null;
  age: number | null;
  quality_tier: string | null;
  quality_reason: string | null;
  attrs: Record<string, unknown> | null;
  attempts: number | null;
  last_dialed_at: string | null;
  last_disposition: string | null;
  status: string;
  status_note: string | null;
  status_at: string | null;
  granted_at: string | null;
  /** MP-LEAD-CALLING-HOURS: server verdict — 8 AM to 7 PM in the LEAD's time zone. */
  callable_now?: boolean | null;
  /** Next opening when closed (an instant; shown in the agent's own clock). */
  callable_at?: string | null;
}
// A lead is workable unless the server says its calling hours are closed. An older server
// that does not send the flag leaves every lead workable, exactly as before.
const callableNow = (r: Pick<MyLead, "callable_now">) => r.callable_now !== false;
function opensLabel(iso: string | null | undefined): string {
  if (!iso) return "tomorrow morning";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "tomorrow morning";
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return `today at ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`;
  return `${d.toLocaleDateString("en-US", { weekday: "long" })} at ${time}`;
}
function earliestOpening(list: Array<Pick<MyLead, "callable_at">>): string | null {
  let best: string | null = null;
  for (const r of list) if (r.callable_at && (!best || r.callable_at < best)) best = r.callable_at;
  return best;
}
type Show = "open" | "done" | "all";
const SHOW: ReadonlyArray<{ key: Show; label: string }> = [
  { key: "open", label: "To call" },
  { key: "done", label: "Done" },
  { key: "all", label: "All" },
];
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

// ---- Full client file (Sam, 2026-11-09: "they need to be able to see all
// client data — it's the whole purpose of said lead"). my_lead_detail joins
// back to the lead's SOURCE record (client_leads / booking packet / lapsed
// deal / dialer history) and the grid renders every non-empty field, so a
// richer source automatically shows more without a UI change.
const DETAIL_LABELS: Record<string, string> = {
  date_of_birth: "Date of birth", ssn_last4: "SSN last 4", alt_phone: "Alt phone", alt_email: "Alt email",
  estimated_ltv: "Est. LTV", last_call_seconds: "Last call (sec)",
};
const prettyKey = (k: string) => DETAIL_LABELS[k] ?? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, " ");
const MONEY_KEY = /(premium|amount|value|balance|equity|loan)/;
const DATE_KEY = /(date|_at$|dob)/;
function prettyVal(k: string, v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return MONEY_KEY.test(k) ? `$${v.toLocaleString()}` : String(v);
  if (typeof v === "string") {
    if (DATE_KEY.test(k)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
    return v;
  }
  if (Array.isArray(v)) {
    return v
      .map((x) => (x && typeof x === "object" ? Object.values(x as Record<string, unknown>).filter((y) => y != null && y !== "").join(" — ") : String(x)))
      .join(" • ");
  }
  return JSON.stringify(v);
}
const LONG_FIELDS = new Set(["call_summary", "health_notes", "notes", "key_points", "beneficiaries", "missing_fields", "call_notes", "transcript_excerpt"]);

function LeadDetailGrid({ itemId }: { itemId: string }) {
  const q = useQuery({
    queryKey: ["my-lead-detail", itemId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_lead_detail" as never, { p_item: itemId } as never);
      if (error) throw new Error(error.message);
      return data as unknown as { source: string; detail: Record<string, unknown> };
    },
    staleTime: 300_000,
  });
  if (q.isLoading) return <div className="grid gap-1.5 sm:grid-cols-2">{[1, 2, 3, 4].map((n) => <Skeleton key={`detail-sk-${n}`} className="h-5 w-full" />)}</div>;
  if (q.isError) return <p className="text-xs text-destructive">Client details did not load: {(q.error as Error).message}</p>;
  const entries = Object.entries(q.data?.detail ?? {}).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && v.length === 0));
  if (entries.length === 0) return <p className="text-xs text-muted-foreground">No extra client data on file for this lead — the card above is everything we have.</p>;
  return (
    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className={cn("min-w-0", LONG_FIELDS.has(k) && "sm:col-span-2")}>
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{prettyKey(k)}</dt>
          <dd className="break-words">
            {/* the call itself (Sam, 2026-11-09): a recording URL renders as a
                tappable listen link, not a wall of URL text */}
            {k === "call_recording" && typeof v === "string" && v.startsWith("http") ? (
              <a href={v} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                <Mic className="h-3.5 w-3.5" /> Listen to the call
              </a>
            ) : (
              prettyVal(k, v)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// Tier badge that explains itself (Sam, 2026-11-09: "explain the differences
// between A, B, C, D type of leads") — tap it, see the whole ladder for this
// lead's pool with the current tier highlighted.
function TierBadge({ tier, pool }: { tier: string | null; pool: string | null | undefined }) {
  const legend = tierLegendFor(pool);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex" aria-label="What this tier means">
          <Badge variant="outline" className={cn("cursor-pointer font-normal", TIER_STYLE[tier ?? ""] ?? "")}>
            {tierLabel(tier)}<Info className="ml-1 h-3 w-3 opacity-60" />
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm" align="start">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What the tiers mean</p>
        <ul className="space-y-1.5">
          {legend.map((t) => (
            <li key={t.tier} className={cn("flex gap-2", t.tier === tier && "font-medium")}>
              <Badge variant="outline" className={cn("h-5 shrink-0 font-normal", TIER_STYLE[t.tier] ?? "")}>{tierLabel(t.tier)}</Badge>
              <span className={cn(t.tier !== tier && "text-muted-foreground")}>{t.desc}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

async function fetchMine(): Promise<MyLead[]> {
  const { data, error } = await supabase.rpc("my_lead_bundles" as never);
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []) as MyLead[];
}

export default function MyLeads() {
  usePageTitle("My Leads");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["my-leads"], queryFn: fetchMine, staleTime: 30_000 });
  const [show, setShow] = useState<Show>("open");
  const [notes, setNotes] = useState<Record<string, string>>({});
  // the one lead whose recorder is open, and per-lead saved recording paths
  const [recordingFor, setRecordingFor] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<Record<string, string>>({});
  // Work mode (Sam, 2026-11-09): one lead at a time, full client file, and the
  // ONLY way to the next lead is marking what happened — there is no skip.
  const [workBundle, setWorkBundle] = useState<string | null>(null);
  // list rows whose full client file is expanded
  const [detailOpen, setDetailOpen] = useState<Set<string>>(new Set());
  const set = useMutation({
    mutationFn: async ({ item, status }: { item: string; status: string }) => {
      // lead_bundle_item_log is the superset of item_set: same status + note, plus
      // it stores the voice-note path when the agent recorded the call.
      const { error } = await supabase.rpc("lead_bundle_item_log" as never, {
        p_item: item, p_status: status,
        p_note: (notes[item] ?? "").trim() || null,
        p_recording_path: recordings[item] ?? null,
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_r, v) => {
      toast.success(`Marked ${leadStatusLabel(v.status).toLowerCase()}.`);
      setNotes((n) => ({ ...n, [v.item]: "" }));
      setRecordingFor((cur) => (cur === v.item ? null : cur));
      void qc.invalidateQueries({ queryKey: ["my-leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = q.data ?? [];
  const mySold = rows.filter((r) => r.status === "sold").length;
  const myWorked = rows.filter((r) => !isOpenLead(r.status)).length;
  // Sam (2026-11-10): after 7 PM leads can't be worked, so they leave "To call". Closed
  // leads stay under "All" so a call made at 6:58 can still be logged.
  const inView = (r: MyLead, s: Show) => s === "all" || (s === "open" ? isOpenLead(r.status) && callableNow(r) : !isOpenLead(r.status));
  const count = (s: Show) => rows.filter((r) => inView(r, s)).length;
  const visible = rows.filter((r) => inView(r, show));
  const closedOpen = rows.filter((r) => isOpenLead(r.status) && !callableNow(r));
  const groups: Array<{ id: string; name: string; note: string | null; format: string; leads: MyLead[] }> = [];
  for (const r of visible) {
    const g = groups.find((x) => x.id === r.bundle_id);
    if (g) g.leads.push(r);
    else groups.push({ id: r.bundle_id, name: r.bundle_name, note: r.bundle_note, format: r.format, leads: [r] });
  }
  return (
    <div className="space-y-6">
      <PageHeader title="My Leads" subtitle="Leads given to you to work. Call, then tap what happened." />
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <Trophy className="h-4 w-4 text-primary" /> You: {myWorked} worked · {mySold} sold
          </span>
          <span className="text-muted-foreground">
            Work a lead: <b className="text-foreground">1.</b> Call · <b className="text-foreground">2.</b> Record what happened · <b className="text-foreground">3.</b> Tap the result
          </span>
        </div>
      )}
      {closedOpen.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="calling-hours-closed">
          <p className="font-semibold text-amber-200">
            {closedOpen.length} lead{closedOpen.length === 1 ? " is" : "s are"} hidden: it's past calling hours where {closedOpen.length === 1 ? "that client lives" : "those clients live"}.
          </p>
          <p className="mt-1 text-muted-foreground">
            Leads can be called 8 AM to 7 PM in the client's own time zone. The next ones open {opensLabel(earliestOpening(closedOpen))} (your time).
          </p>
        </div>
      )}
      {q.isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((n) => <Skeleton key={`lead-sk-${n}`} className="h-20 w-full" />)}</div>
      ) : q.isError ? (
        <EmptyState icon={<Inbox className="h-6 w-6" />} title="Your leads did not load" description={(q.error as Error).message} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Inbox className="h-6 w-6" />} title="No leads assigned to you yet." description="When Sam or Aisha gives you a bundle, it shows here." />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {SHOW.map((s) => (
              <Button key={s.key} type="button" size="sm" variant={show === s.key ? "default" : "outline"} onClick={() => setShow(s.key)}>{s.label} ({count(s.key)})</Button>
            ))}
          </div>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing in this view.</p>
          ) : (
            groups.map((g) => (
              <GlassCard key={g.id} className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">
                      {g.name} <Badge variant="outline" className="ml-1 font-normal">{formatLabel(g.format)}</Badge>
                      <span className="ml-2 text-xs font-normal text-muted-foreground">{g.leads.length} lead{g.leads.length === 1 ? "" : "s"}</span>
                    </p>
                    {g.note && <p className="mt-1 text-xs italic text-amber-300/90">“{g.note}”</p>}
                  </div>
                  {(() => {
                    const fresh = rows.filter((r) => r.bundle_id === g.id && r.status === "new" && callableNow(r)).length;
                    return fresh > 0 ? (
                      <Button type="button" size="sm" onClick={() => setWorkBundle(g.id)}>
                        <PhoneCall className="mr-1.5 h-3.5 w-3.5" /> Work leads ({fresh})
                      </Button>
                    ) : null;
                  })()}
                </div>
                <ul className="divide-y divide-border/60 border-t border-border/60 text-sm">
                  {g.leads.map((l) => {
                    const hoursOpen = callableNow(l);
                    const href = canDial(l.status) && hoursOpen ? phoneHref(l.phone10) : null;
                    return (
                      <li key={l.item_id} className="space-y-2 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-medium">
                            {[l.first_name, l.last_name].filter(Boolean).join(" ") || "Name not on file"}
                            {(l.age || l.state) && (
                              <span className="ml-1.5 font-normal text-muted-foreground">
                                {[l.age ? `${l.age}` : null, l.state].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </span>
                          {href ? (
                            // PKG2: the tap is the dial record now that the dialer is canceled; never blocks the call
                            <a href={href} {...contactLinkProps(href)} onClick={dialTapHandler(l.item_id)} data-testid="lead-call-link" className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><Phone className="h-3.5 w-3.5" />{formatPhoneDisplay(l.phone10)}</a>
                          ) : (
                            <span className="text-muted-foreground">
                              {formatPhoneDisplay(l.phone10)} · {canDial(l.status) && !hoursOpen ? `calling hours closed, opens ${opensLabel(l.callable_at)}` : "do not call"}
                            </span>
                          )}
                          <TierBadge tier={l.quality_tier} pool={(l.attrs as Record<string, unknown> | null)?.pool as string | undefined} />
                          <span className="text-muted-foreground">{leadStatusLabel(l.status)}{l.status_note ? `: ${l.status_note}` : ""}</span>
                          <button
                            type="button"
                            onClick={() => setDetailOpen((s) => { const n = new Set(s); if (n.has(l.item_id)) n.delete(l.item_id); else n.add(l.item_id); return n; })}
                            className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
                          >
                            Full info <ChevronDown className={cn("h-3 w-3 transition-transform", detailOpen.has(l.item_id) && "rotate-180")} />
                          </button>
                        </div>
                        {detailOpen.has(l.item_id) && (
                          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                            <LeadDetailGrid itemId={l.item_id} />
                          </div>
                        )}
                        {(() => {
                          const chips = flagBadges((l.attrs ?? {}) as Record<string, unknown>, l.attrs?.under_9mo === true);
                          return chips.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {chips.slice(0, 6).map((b) => (
                                <Badge key={b.key} variant="outline" className={cn("text-[10px]", b.cls)}>{b.label}</Badge>
                              ))}
                            </div>
                          ) : l.quality_reason ? (
                            <p className="text-xs text-muted-foreground">{l.quality_reason}</p>
                          ) : null;
                        })()}
                        {(l.last_dialed_at || l.last_disposition) && (
                          <p className="text-xs text-muted-foreground">
                            {l.last_dialed_at ? `last dialed ${shortDate(l.last_dialed_at)}` : ""}
                            {l.last_disposition ? ` (${dispositionLabel(l.last_disposition)})` : ""}
                          </p>
                        )}
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {LEAD_STATUS_BUTTONS.map((b) => (
                              <Button key={b.key} type="button" size="sm" variant={l.status === b.key ? "default" : "outline"} disabled={set.isPending} onClick={() => set.mutate({ item: l.item_id, status: b.key })}>{b.label}</Button>
                            ))}
                            <Button type="button" size="sm" variant={recordingFor === l.item_id ? "default" : "outline"} onClick={() => setRecordingFor((c) => (c === l.item_id ? null : l.item_id))}>
                              <Mic className="mr-1 h-3.5 w-3.5" />{recordingFor === l.item_id ? "Close recorder" : "Record"}
                            </Button>
                            {recordings[l.item_id] && (
                              <Badge variant="outline" className="bg-green-600/15 border-green-600/40 text-green-300"><Check className="mr-1 h-3 w-3" />recorded</Badge>
                            )}
                            <Input value={notes[l.item_id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [l.item_id]: e.target.value }))} placeholder="Note (saved with the next tap)" className="h-8 min-w-[12rem] flex-1" maxLength={300} aria-label="Note" />
                          </div>
                          {recordingFor === l.item_id && (
                            <CallCenterVoiceRecorder
                              onTranscriptionUpdate={() => { /* transcript not needed here — audio + summary only */ }}
                              onAudioSaved={(p) => { setRecordings((r) => ({ ...r, [l.item_id]: p })); toast.success("Recording saved — now tap what happened"); }}
                              className="rounded-lg border border-border/60 p-3"
                            />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </GlassCard>
            ))
          )}
        </>
      )}
      {workBundle && (() => {
        const pack = rows.filter((r) => r.bundle_id === workBundle);
        if (pack.length === 0) { return null; }
        const queue = pack.filter((r) => r.status === "new" && callableNow(r));
        const waiting = pack.filter((r) => r.status === "new" && !callableNow(r));
        const cur = queue[0] ?? null;
        const workedN = pack.filter((r) => r.status !== "new").length;
        const soldN = pack.filter((r) => r.status === "sold").length;
        const pool = (pack[0].attrs as Record<string, unknown> | null)?.pool as string | undefined;
        const href = cur && canDial(cur.status) && callableNow(cur) ? phoneHref(cur.phone10) : null;
        return (
          <div className="fixed inset-0 z-50 flex flex-col bg-background">
            <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{pack[0].bundle_name}</p>
                <p className="text-xs text-muted-foreground">{workedN} of {pack.length} worked{soldN > 0 ? ` · ${soldN} sold` : ""}</p>
              </div>
              <Button type="button" size="icon" variant="ghost" onClick={() => setWorkBundle(null)} aria-label="Close work mode"><X className="h-5 w-5" /></Button>
            </div>
            <div className="h-1 w-full bg-muted"><div className="h-1 bg-primary transition-all" style={{ width: `${pack.length ? Math.round((workedN / pack.length) * 100) : 0}%` }} /></div>
            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-2xl space-y-4 p-4 pb-10">
                {cur ? (
                  <>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Lead {workedN + 1} of {pack.length}</p>
                    <div className="space-y-1">
                      <h2 className="text-2xl font-semibold leading-tight">
                        {[cur.first_name, cur.last_name].filter(Boolean).join(" ") || "Name not on file"}
                        {(cur.age || cur.state) && <span className="ml-2 text-base font-normal text-muted-foreground">{[cur.age ? `${cur.age}` : null, cur.state].filter(Boolean).join(" · ")}</span>}
                      </h2>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <TierBadge tier={cur.quality_tier} pool={pool} />
                        {flagBadges((cur.attrs ?? {}) as Record<string, unknown>, cur.attrs?.under_9mo === true).map((b) => (
                          <Badge key={b.key} variant="outline" className={cn("text-[10px]", b.cls)}>{b.label}</Badge>
                        ))}
                      </div>
                    </div>
                    {href ? (
                      <Button asChild size="lg" className="h-12 w-full text-base">
                        <a href={href} {...contactLinkProps(href)} onClick={dialTapHandler(cur.item_id)} data-testid="work-mode-call-link"><Phone className="mr-2 h-5 w-5" />Call {formatPhoneDisplay(cur.phone10)}</a>
                      </Button>
                    ) : (
                      <p className="text-sm text-muted-foreground">{formatPhoneDisplay(cur.phone10)} · do not call</p>
                    )}
                    {typeof cur.attrs?.replaced_phone10 === "string" && cur.attrs.replaced_phone10 && (
                      // MP-LEAD-PHONE-READYMODE: say which number was replaced so nobody
                      // falls back to the one in the book that never picked up.
                      <p className="text-xs text-muted-foreground" data-testid="replaced-number-note">
                        This is the number ReadyMode reached them on. The book had {formatPhoneDisplay(cur.attrs.replaced_phone10)}, which never answered.
                      </p>
                    )}
                    {pack[0].bundle_note && <p className="text-sm italic text-amber-300/90">“{pack[0].bundle_note}”</p>}
                    <GlassCard className="p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client file</p>
                      <LeadDetailGrid itemId={cur.item_id} />
                    </GlassCard>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">What happened? <span className="font-normal text-muted-foreground">(required — this is what moves you to the next lead)</span></p>
                      <Input
                        value={notes[cur.item_id] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [cur.item_id]: e.target.value }))}
                        placeholder="Note (saved with your result)"
                        maxLength={300}
                        aria-label="Note"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" size="sm" variant={recordingFor === cur.item_id ? "default" : "outline"} onClick={() => setRecordingFor((c) => (c === cur.item_id ? null : cur.item_id))}>
                          <Mic className="mr-1 h-3.5 w-3.5" />{recordingFor === cur.item_id ? "Close recorder" : "Record the call"}
                        </Button>
                        {recordings[cur.item_id] && (
                          <Badge variant="outline" className="bg-green-600/15 border-green-600/40 text-green-300"><Check className="mr-1 h-3 w-3" />recorded</Badge>
                        )}
                      </div>
                      {recordingFor === cur.item_id && (
                        <CallCenterVoiceRecorder
                          onTranscriptionUpdate={() => { /* audio + summary only */ }}
                          onAudioSaved={(p) => { setRecordings((r) => ({ ...r, [cur.item_id]: p })); toast.success("Recording saved — now tap what happened"); }}
                          className="rounded-lg border border-border/60 p-3"
                        />
                      )}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {LEAD_STATUS_BUTTONS.map((b) => (
                          <Button
                            key={b.key}
                            type="button"
                            variant={b.key === "sold" ? "default" : "outline"}
                            className="h-11"
                            disabled={set.isPending}
                            onClick={() => set.mutate({ item: cur.item_id, status: b.key })}
                          >
                            {b.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-16 text-center">
                    <Trophy className="h-10 w-10 text-primary" />
                    {waiting.length > 0 ? (
                      <>
                        <h2 className="text-xl font-semibold">Calling hours are closed for the rest of this pack.</h2>
                        <p className="text-sm text-muted-foreground" data-testid="work-mode-hours-closed">{waiting.length} lead{waiting.length === 1 ? "" : "s"} left. The next ones open {opensLabel(earliestOpening(waiting))} (your time).</p>
                      </>
                    ) : (
                      <>
                        <h2 className="text-xl font-semibold">Pack worked — every lead has a result.</h2>
                        <p className="text-sm text-muted-foreground">{pack.length} lead{pack.length === 1 ? "" : "s"} · {soldN} sold. Callbacks and no-answers stay in your To call list.</p>
                      </>
                    )}
                    <Button type="button" onClick={() => setWorkBundle(null)}>Back to my leads</Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
