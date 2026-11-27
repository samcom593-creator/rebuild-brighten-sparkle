// MyLeads: the leads Sam or Aisha gave you to work (MP-310 wave 3, 2026-10-29).
//
// my_lead_bundles() returns only the caller's live leads in bundles they hold, with the dialer's do-not-call numbers
// already removed. One tap records what happened (lead_bundle_item_set). Do not call takes the Call link away for
// good, and the number never goes into another bundle.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Inbox, Info, Phone, PhoneCall, Mic, Check, Trophy, UserPlus, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { LeadStatePrompt } from "@/components/dashboard/LeadStatePrompt";
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
import { holdLabels } from "@/lib/leadManagerFilters";
import { MY_LEADS_QUERY_KEY, fetchMyLeads } from "@/lib/myLeads";
import { cn } from "@/lib/utils";
import { CallCenterVoiceRecorder } from "@/components/callcenter/CallCenterVoiceRecorder";
import { QueryState } from "@/components/ui/query-state";
import { LeadFilterSelect, LeadPagination, LeadSearchField } from "@/components/leads/LeadWorklistControls";
import { useLeadPagination } from "@/hooks/useLeadPagination";
import { matchesLeadQuery } from "@/lib/leadWorklist";
import { compareLeadResponse, leadResponsePriority } from "@/lib/leadResponsePriority";
import { formatRelativeFromNow } from "@/lib/dateUtils";

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
const heldReason = (r: Pick<MyLead, "attrs" | "status">): string => {
  if (r.status === "do_not_call") return "Do not call";
  const flags = r.attrs ?? {};
  const labels = holdLabels({ true_dnc: flags.true_dnc, dnc: flags.dnc, current_client: flags.current_client, import_review_required: flags.import_review_required, invalid_number: flags.invalid_number });
  return labels.join(" · ") || (flags.blocked === true ? "Contact held" : "");
};
const callableNow = (r: Pick<MyLead, "callable_now" | "attrs" | "status">) => r.callable_now !== false && !heldReason(r);
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
type Show = "open" | "scheduled" | "done" | "held" | "all";
const SHOW: ReadonlyArray<{ key: Show; label: string }> = [
  { key: "open", label: "To call" },
  { key: "scheduled", label: "Scheduled" },
  { key: "done", label: "Done" },
  { key: "held", label: "Held" },
  { key: "all", label: "All" },
];
// Due work, unscheduled follow-ups, oldest first-outcome leads, then retries.
// A future callback is planned work, not an overdue response.
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

function LeadBaseDetailGrid({ itemId }: { itemId: string }) {
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

// One fetcher and one query key with the Home card (src/lib/myLeads.ts), so the two never disagree.
const fetchMine = () => fetchMyLeads<MyLead>();

export default function MyLeads() {
  usePageTitle("My Leads");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: MY_LEADS_QUERY_KEY, queryFn: fetchMine, staleTime: 30_000 });
  const [show, setShow] = useState<Show>("open");
  const [notes, setNotes] = useState<Record<string, string>>({});
  // the one lead whose recorder is open, and per-lead saved recording paths
  const [recordingFor, setRecordingFor] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<Record<string, string>>({});
  // Work mode (Sam, 2026-11-09): one lead at a time, full client file, and the
  // ONLY way to the next lead is marking what happened — there is no skip.
  const [workBundle, setWorkBundle] = useState<string | null>(null);
  const [workLeadIds, setWorkLeadIds] = useState<Set<string>>(new Set());
  // list rows whose full client file is expanded
  const [detailOpen, setDetailOpen] = useState<Set<string>>(new Set());
  // The one lead whose result buttons are showing. null = the first lead in view (so the page opens ready to
  // work), "" = the agent closed it. Every other lead is a single line until it is opened or its number is tapped.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusLeadId, setFocusLeadId] = useState<string | null>(null);
  const leadElements = useRef(new Map<string, HTMLLIElement>());
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [bundleFilter, setBundleFilter] = useState("");
  const orderRef = useRef<string[]>([]);
  const openRef = useRef<string | null>(null);
  // MP-LEAD-MANAGER-RM (2026-11-24): a recording is saved against its lead the moment the upload
  // finishes. Before this it rode along with the next result tap, so closing the card, reloading or
  // just not tapping a result threw it away: one recording had ever been kept across 4,641 leads handed out.
  // The AI summary arrives on its own clock; whichever of the two lands second completes the row.
  const recPath = useRef<Record<string, string>>({});
  const recSummary = useRef<Record<string, unknown>>({});
  const saveRecording = async (item: string) => {
    const path = recPath.current[item];
    if (!path) return;
    const { error } = await supabase.rpc("lead_item_add_recording" as never, {
      p_item: item, p_path: path, p_summary: recSummary.current[item] ?? null,
    } as never);
    if (error) toast.error(`The recording uploaded but was not attached to the lead: ${error.message}`);
  };
  // One tap puts a lead into the agent's own client pipeline with everything on file carried over
  // (my_lead_to_pipeline). A second tap finds the same client instead of making a twin.
  const navigate = useNavigate();
  const [inPipeline, setInPipeline] = useState<Record<string, boolean>>({});
  const toPipeline = useMutation({
    mutationFn: async (item: string) => {
      const { data, error } = await supabase.rpc("my_lead_to_pipeline" as never, { p_item: item } as never);
      if (error) throw new Error(error.message);
      return data as unknown as { client_id: string; created: boolean };
    },
    onSuccess: (res, item) => {
      setInPipeline((m) => ({ ...m, [item]: true }));
      toast.success(res.created ? "Added to your pipeline." : "Already in your pipeline.", {
        action: { label: "Open pipeline", onClick: () => navigate("/dashboard/clients") },
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const pipelineButton = (item: string, status: string, held = false) => status === "do_not_call" || held ? null : (
    <Button type="button" size="sm" variant="outline" disabled={toPipeline.isPending || inPipeline[item]} onClick={() => toPipeline.mutate(item)} data-testid="lead-to-pipeline">
      {inPipeline[item] ? <><Check className="mr-1 h-3.5 w-3.5" />In your pipeline</> : <><UserPlus className="mr-1 h-3.5 w-3.5" />Add to my pipeline</>}
    </Button>
  );
  const recorderProps = (item: string) => ({
    onTranscriptionUpdate: () => { /* the audio and its summary are what is kept */ },
    onSummaryComplete: (summary: unknown) => { recSummary.current[item] = summary; void saveRecording(item); },
    onAudioSaved: (path: string) => {
      recPath.current[item] = path;
      setRecordings((r) => ({ ...r, [item]: path }));
      void saveRecording(item).then(() => toast.success("Recording saved to this lead. Now tap what happened."));
    },
  });
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
      // A result on the open lead opens the next one down, so a pack is worked without scrolling or hunting.
      if (openRef.current === v.item) {
        const at = orderRef.current.indexOf(v.item);
        setActiveId(at >= 0 ? orderRef.current[at + 1] ?? null : null);
      }
      void qc.invalidateQueries({ queryKey: MY_LEADS_QUERY_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = q.data ?? [];
  const mySold = rows.filter((r) => r.status === "sold").length;
  const myWorked = rows.filter((r) => !isOpenLead(r.status)).length;
  // Sam (2026-11-10): after 7 PM leads can't be worked, so they leave "To call". Closed
  // leads stay under "All" so a call made at 6:58 can still be logged.
  const inView = (r: MyLead, s: Show) => s === "all" || (s === "held" ? !!heldReason(r)
    : s === "scheduled" ? !heldReason(r) && leadResponsePriority(r, clock).kind === "scheduled"
    : s === "open" ? isOpenLead(r.status) && callableNow(r) && leadResponsePriority(r, clock).kind !== "scheduled"
    : !isOpenLead(r.status));
  const matchingRows = rows.filter((r) => (!stateFilter || r.state === stateFilter) && (!bundleFilter || r.bundle_id === bundleFilter)
    && matchesLeadQuery(search, [r.first_name, r.last_name, r.email, r.state, r.bundle_name], [r.phone10]));
  const count = (s: Show) => matchingRows.filter((r) => inView(r, s)).length;
  const matched = matchingRows.filter((r) => inView(r, show));
  const visible = show === "open" || show === "scheduled" ? [...matched].sort((a, b) => compareLeadResponse(a, b, clock)) : matched;
  const pagination = useLeadPagination(visible, JSON.stringify([show, search, stateFilter, bundleFilter]));
  const { pageSize, setPage } = pagination;
  const openId = activeId === "" ? null : pagination.items.some((r) => r.item_id === activeId) ? activeId : pagination.items[0]?.item_id ?? null;
  // Result taps can advance across a page boundary. Search/filter/page changes explicitly reset the active row.
  useEffect(() => {
    if (!activeId) return;
    const index = visible.findIndex((r) => r.item_id === activeId);
    if (index >= 0) setPage(Math.floor(index / pageSize));
  }, [activeId, visible, pageSize, setPage]);
  useEffect(() => {
    if (!focusLeadId) return;
    const element = leadElements.current.get(focusLeadId);
    if (!element || openId !== focusLeadId) return;
    element.scrollIntoView?.({ behavior: "smooth", block: "center" });
    element.focus({ preventScroll: true });
    setFocusLeadId(null);
  }, [focusLeadId, openId, pagination.page, pagination.items]);
  const states = [...new Set(rows.map((r) => r.state).filter((state): state is string => !!state))].sort();
  const bundles = [...new Map(rows.map((r) => [r.bundle_id, r.bundle_name])).entries()];
  const filtersActive = !!(search.trim() || stateFilter || bundleFilter || show !== "open");
  const resetFilters = () => { setSearch(""); setStateFilter(""); setBundleFilter(""); setShow("open"); setActiveId(null); };
  orderRef.current = visible.map((r) => r.item_id);
  openRef.current = openId;
  const actionable = rows.filter((r) => inView(r, "open") && !!phoneHref(r.phone10)).sort((a, b) => compareLeadResponse(a, b, clock));
  const nextLead = actionable[0];
  const callbacksDue = actionable.filter((r) => leadResponsePriority(r, clock).kind === "overdue").length;
  const missingPlans = actionable.filter((r) => leadResponsePriority(r, clock).kind === "followup_unplanned").length;
  const firstOutcomes = actionable.filter((r) => leadResponsePriority(r, clock).kind === "first_outcome").length;
  const workNextLead = () => {
    if (!nextLead || !q.isSuccess) return;
    resetFilters(); setPage(0); setActiveId(nextLead.item_id); setFocusLeadId(nextLead.item_id);
  };
  const closedOpen = rows.filter((r) => isOpenLead(r.status) && !heldReason(r) && !callableNow(r));
  const heldCount = rows.filter((r) => !!heldReason(r)).length;
  const groups: Array<{ id: string; name: string; note: string | null; format: string; leads: MyLead[] }> = [];
  for (const r of pagination.items) {
    // Keep the priority order across packs instead of regrouping later leads
    // ahead of an earlier deadline in another pack.
    const last = groups[groups.length - 1];
    const g = last?.id === r.bundle_id ? last : undefined;
    if (g) g.leads.push(r);
    else groups.push({ id: r.bundle_id, name: r.bundle_name, note: r.bundle_note, format: r.format, leads: [r] });
  }
  return (
    <div className="space-y-6">
      <PageHeader title="My Leads" subtitle="Leads given to you to work. Call, then tap what happened." />
      <LeadStatePrompt />
      {q.isSuccess && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <Trophy className="h-4 w-4 text-primary" /> {myWorked} completed outcomes · {mySold} marked sold
          </span>
          {callbacksDue > 0 && (
            <Badge variant="outline" className="border-primary/40 bg-primary/10 font-normal text-primary" data-testid="callbacks-due">
              {callbacksDue} follow-up{callbacksDue === 1 ? "" : "s"} due, listed first
            </Badge>
          )}
          {missingPlans > 0 && <Badge variant="outline" data-testid="followups-unplanned">{missingPlans} follow-up{missingPlans === 1 ? " needs" : "s need"} an agreed time</Badge>}
          {firstOutcomes > 0 && <Badge variant="outline" data-testid="first-outcomes-pending">{firstOutcomes} awaiting a first outcome</Badge>}
          {nextLead && <Button type="button" size="sm" onClick={workNextLead}>Work next lead</Button>}
          <span className="text-muted-foreground">
            Open the call, then save the actual outcome. Opening the phone app alone does not record a result.
          </span>
        </div>
      )}
      {heldCount > 0 && <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="lead-holds">
        {heldCount} lead{heldCount === 1 ? " is" : "s are"} held from contact. Open Held to review the reason; calling and pipeline actions are disabled.
      </div>}
      {closedOpen.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="calling-hours-closed">
          <p className="font-semibold text-foreground">
            {closedOpen.length} lead{closedOpen.length === 1 ? " is" : "s are"} hidden: calling hours are closed where {closedOpen.length === 1 ? "that client lives" : "those clients live"}.
          </p>
          <p className="mt-1 text-muted-foreground">
            Leads can be called 8 AM to 7 PM in the client's own time zone. The next ones open {opensLabel(earliestOpening(closedOpen))} (your time).
          </p>
        </div>
      )}
      {q.isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((n) => <Skeleton key={`lead-sk-${n}`} className="h-20 w-full" />)}</div>
      ) : q.isError ? (
        <QueryState status="error" label="your leads" error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Inbox className="h-6 w-6" />} title="No leads assigned to you yet." description="When Sam or Aisha gives you a bundle, it shows here." />
      ) : (
        <>
          <section aria-label="Filter your leads" className="space-y-4 rounded-2xl border border-border bg-card p-4">
            <LeadSearchField value={search} onChange={(value) => { setSearch(value); setActiveId(null); }} label="Find a lead" placeholder="Search name, phone, email, state or pack…" testId="lead-search" />
            <div className="grid gap-3 sm:grid-cols-2">
              <LeadFilterSelect label="Lead state" value={stateFilter} onChange={(value) => { setStateFilter(value); setActiveId(null); }}>
                <option value="">All states</option>{states.map((state) => <option key={state} value={state}>{state}</option>)}
              </LeadFilterSelect>
              <LeadFilterSelect label="Lead pack" value={bundleFilter} onChange={(value) => { setBundleFilter(value); setActiveId(null); }}>
                <option value="">All packs</option>{bundles.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </LeadFilterSelect>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Lead work status">
                {SHOW.map((s) => <Button key={s.key} type="button" className="h-11 rounded-full" variant={show === s.key ? "default" : "outline"}
                  aria-pressed={show === s.key} onClick={() => { setShow(s.key); setActiveId(null); }}>{s.label} ({count(s.key)})</Button>)}
              </div>
              {filtersActive && <Button type="button" variant="ghost" className="h-11" onClick={resetFilters}>Reset filters</Button>}
            </div>
            <p className="text-sm text-muted-foreground" role="status">{visible.length.toLocaleString()} matching lead{visible.length === 1 ? "" : "s"} · {rows.length.toLocaleString()} assigned</p>
          </section>
          {groups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center">
              <p className="font-medium">{search.trim() ? `No lead in this view matches “${search.trim()}”.` : "No leads match this view."}</p>
              <p className="mt-1 text-sm text-muted-foreground">Try another search or filter. All includes completed, held and after-hours leads.</p>
              <Button type="button" variant="outline" className="mt-3 h-11" onClick={() => { resetFilters(); setShow("all"); }}>Show all assigned leads</Button>
            </div>
          ) : (
            groups.map((g) => (
              <GlassCard key={`${g.id}:${g.leads[0].item_id}`} className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold">
                      {g.name} <Badge variant="outline" className="ml-1 font-normal">{formatLabel(g.format)}</Badge>
                      <span className="ml-2 text-xs font-normal text-muted-foreground">{g.leads.length} lead{g.leads.length === 1 ? "" : "s"}</span>
                    </div>
                    {g.note && <p className="mt-1 text-xs italic text-amber-300/90">“{g.note}”</p>}
                  </div>
                  {(() => {
                    if (groups.find(group => group.id === g.id) !== g) return null;
                    const selected = visible.filter((r) => r.bundle_id === g.id);
                    const fresh = selected.filter((r) => r.status === "new" && callableNow(r) && leadResponsePriority(r, clock).kind === "first_outcome" && !!phoneHref(r.phone10));
                    return fresh.length > 0 ? (
                      <Button type="button" size="sm" onClick={() => { setWorkLeadIds(new Set(fresh.map((r) => r.item_id))); setWorkBundle(g.id); }}>
                        <PhoneCall className="mr-1.5 h-3.5 w-3.5" /> Work leads ({fresh.length})
                      </Button>
                    ) : null;
                  })()}
                </div>
                <ul className="divide-y divide-border/60 border-t border-border/60 text-sm">
                  {g.leads.map((l) => {
                    const hoursOpen = callableNow(l);
                    const href = canDial(l.status) && hoursOpen ? phoneHref(l.phone10) : null;
                    const open = openId === l.item_id;
                    const response = leadResponsePriority(l, clock);
                    const leadName = [l.first_name, l.last_name].filter(Boolean).join(" ") || "Name not on file";
                    return (
                      <li key={l.item_id} ref={(element) => { if (element) leadElements.current.set(l.item_id, element); else leadElements.current.delete(l.item_id); }} tabIndex={-1} className={cn("px-4 py-2.5 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]", open && "bg-muted/20")} data-testid="lead-row" data-open={open ? "true" : "false"}>
                        <div className="flex items-start gap-1">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
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
                            <a href={href} {...contactLinkProps(href)} onClick={dialTapHandler(l.item_id)} onClickCapture={() => setActiveId(l.item_id)} data-testid="lead-call-link" className="inline-flex min-h-[32px] items-center gap-1 font-medium text-primary hover:underline"><Phone className="h-3.5 w-3.5" />{formatPhoneDisplay(l.phone10)}</a>
                          ) : (
                            <span className="text-muted-foreground">
                              {formatPhoneDisplay(l.phone10)} · {heldReason(l) || (canDial(l.status) && !hoursOpen ? `calling hours closed, opens ${opensLabel(l.callable_at)}` : "phone unavailable")}
                            </span>
                          )}
                          {/* A closed row carries the tier as a plain label; the tappable badge that explains the tiers is a
                              44px touch target and doubled the row's height, so it shows once the lead is open. */}
                          {open ? (
                            <TierBadge tier={l.quality_tier} pool={(l.attrs as Record<string, unknown> | null)?.pool as string | undefined} />
                          ) : (
                            <Badge variant="outline" className={cn("font-normal", TIER_STYLE[l.quality_tier ?? ""] ?? "")}>{tierLabel(l.quality_tier)}</Badge>
                          )}
                          <span className="text-muted-foreground">{leadStatusLabel(l.status)}{l.status_note ? `: ${l.status_note}` : ""}</span>
                          {isOpenLead(l.status) && !heldReason(l) && <span className={cn("text-xs", response.kind === "overdue" ? "font-semibold text-destructive" : "text-muted-foreground")} data-testid="lead-response-state">
                            {response.label}{response.dueAt ? ` · ${new Date(response.dueAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
                            {l.status === "new" ? response.assignedAt ? ` · assigned ${formatRelativeFromNow(response.assignedAt, clock)}` : " · assignment time unknown" : ""}
                          </span>}
                        </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setActiveId(open ? "" : l.item_id)}
                            aria-expanded={open}
                            aria-label={open ? `Close ${leadName}` : `Open ${leadName}`}
                            data-testid="lead-toggle"
                            className="h-11 w-11 shrink-0 text-muted-foreground"
                          >
                            <ChevronDown className={cn("h-5 w-5 transition-transform", open && "rotate-180")} />
                          </Button>
                        </div>
                        {open && (
                        <div className="space-y-2 pb-1.5 pt-1" data-testid="lead-panel">
                          {isOpenLead(l.status) && !heldReason(l) && <p className="text-sm font-medium" data-testid="lead-next-action">Next: {response.nextAction}</p>}
                          <button
                            type="button"
                            onClick={() => setDetailOpen((s) => { const n = new Set(s); if (n.has(l.item_id)) n.delete(l.item_id); else n.add(l.item_id); return n; })}
                            className="inline-flex min-h-[32px] items-center gap-0.5 text-xs text-primary hover:underline"
                          >
                            Full info <ChevronDown className={cn("h-3 w-3 transition-transform", detailOpen.has(l.item_id) && "rotate-180")} />
                          </button>
                        {detailOpen.has(l.item_id) && (
                          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                            <LeadDetailGrid itemId={l.item_id} context={l.attrs} />
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
                              <Button key={b.key} type="button" size="sm" variant={l.status === b.key ? "default" : "outline"} disabled={set.isPending || (!!heldReason(l) && b.key !== "do_not_call")} onClick={() => set.mutate({ item: l.item_id, status: b.key })}>{b.label}</Button>
                            ))}
                            <Button type="button" size="sm" variant={recordingFor === l.item_id ? "default" : "outline"} onClick={() => setRecordingFor((c) => (c === l.item_id ? null : l.item_id))}>
                              <Mic className="mr-1 h-3.5 w-3.5" />{recordingFor === l.item_id ? "Close recorder" : "Record the call"}
                            </Button>
                            {recordings[l.item_id] && (
                              <Badge variant="outline" className="bg-green-600/15 border-green-600/40 text-green-300"><Check className="mr-1 h-3 w-3" />recorded</Badge>
                            )}
                            {pipelineButton(l.item_id, l.status, !!heldReason(l))}
                            <Input value={notes[l.item_id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [l.item_id]: e.target.value }))} placeholder="Note (saved with the next tap)" className="h-8 min-w-[12rem] flex-1" maxLength={300} aria-label="Note" />
                          </div>
                          {recordingFor === l.item_id && (
                            <CallCenterVoiceRecorder key={l.item_id} {...recorderProps(l.item_id)} className="rounded-lg border border-border/60 p-3" />
                          )}
                        </div>
                        {isOpenLead(l.status) && !heldReason(l) && <LeadFollowUp key={`${l.item_id}:${String(l.attrs?.callback_at ?? "")}:${String(l.attrs?.next_action ?? "")}`} itemId={l.item_id} context={l.attrs} />}
                        </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </GlassCard>
            ))
          )}
          <LeadPagination {...pagination} onPageChange={(page) => { setActiveId(null); pagination.setPage(page); }} label="Assigned leads" />
        </>
      )}
      {workBundle && (() => {
        const pack = rows.filter((r) => r.bundle_id === workBundle && workLeadIds.has(r.item_id));
        if (pack.length === 0) { return null; }
        const queue = pack.filter((r) => r.status === "new" && callableNow(r) && leadResponsePriority(r, clock).kind !== "scheduled" && !!phoneHref(r.phone10)).sort((a, b) => compareLeadResponse(a, b, clock));
        const waiting = pack.filter((r) => r.status === "new" && !heldReason(r) && !callableNow(r));
        const held = pack.filter((r) => !!heldReason(r));
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
                      <LeadDetailGrid itemId={cur.item_id} context={cur.attrs} />
                      <LeadFollowUp key={cur.item_id} itemId={cur.item_id} context={cur.attrs} />
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
                        {pipelineButton(cur.item_id, cur.status, !!heldReason(cur))}
                      </div>
                      {recordingFor === cur.item_id && (
                        <CallCenterVoiceRecorder key={cur.item_id} {...recorderProps(cur.item_id)} className="rounded-lg border border-border/60 p-3" />
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
                    {held.length > 0 && <p className="text-sm text-amber-300">{held.length} held lead{held.length === 1 ? "" : "s"}. Return to the list to review the hold reasons.</p>}
                    {waiting.length > 0 ? (
                      <>
                        <h2 className="text-xl font-semibold">Calling hours are closed for the rest of this pack.</h2>
                        <p className="text-sm text-muted-foreground" data-testid="work-mode-hours-closed">{waiting.length} lead{waiting.length === 1 ? "" : "s"} left. The next ones open {opensLabel(earliestOpening(waiting))} (your time).</p>
                      </>
                    ) : (
                      <>
                        <h2 className="text-xl font-semibold">Every lead in this session has a saved outcome or follow-up.</h2>
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


type SourcePolicyObservation = Record<string, unknown> & { observation_id: string };

/** Source policies stay observations until separately verified by the carrier. */
function LeadDetailGrid({ itemId, context }: { itemId: string; context: Record<string, unknown> | null }) {
  const source = useQuery({
    queryKey: ["my-lead-source-history", itemId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_lead_source_history" as never, { p_item: itemId } as never);
      if (error) throw new Error(error.message);
      return (Array.isArray(data) ? data : []) as unknown as SourcePolicyObservation[];
    }, staleTime: 300_000,
  });
  return <div className="space-y-4">
    <LeadBaseDetailGrid itemId={itemId} />
    {source.isError ? <p className="text-xs text-destructive">Source history did not load: {source.error.message}</p>
      : (source.data?.length ?? 0) > 0 && <section className="space-y-2 border-t pt-3">
        <h3 className="text-sm font-medium">Source policy history</h3>
        <p className="text-xs text-muted-foreground">Supplier-reported ownership. Source dates and status do not verify an active policy. Amounts with an unknown cadence are not monthly or annual premium.</p>
        {source.data?.map((row) => <dl key={row.observation_id} className="grid gap-x-4 gap-y-1 rounded border p-2 text-xs sm:grid-cols-2">
          {Object.entries(row).filter(([key, value]) => !["id", "observation_id"].includes(key) && value != null && value !== "").map(([key, value]) => <div key={key}>
            <dt className="text-muted-foreground">{prettyKey(key)}</dt><dd className="break-words">{prettyVal(key, value)}</dd>
          </div>)}
        </dl>)}
      </section>}
  </div>;
}

function LeadFollowUp({ itemId, context }: { itemId: string; context: Record<string, unknown> | null }) {
  const qc = useQueryClient();
  const [callback, setCallback] = useState(() => {
    if (typeof context?.callback_at !== "string") return "";
    const date = new Date(context.callback_at);
    return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [action, setAction] = useState(typeof context?.next_action === "string" ? context.next_action : "");
  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("lead_bundle_followup_set" as never, {
        p_item: itemId, p_callback_at: callback ? new Date(callback).toISOString() : null,
        p_next_action: action.trim() || null,
      } as never);
      if (error) throw new Error(error.message);
      if ((data as { ok?: boolean } | null)?.ok !== true) throw new Error("Follow-up could not be confirmed. Refresh before retrying.");
    },
    onSuccess: () => { toast.success("Follow-up saved"); qc.invalidateQueries({ queryKey: MY_LEADS_QUERY_KEY }); },
    onError: (error: Error) => toast.error(error.message),
  });
  return <section className="space-y-2 border-t pt-3">
    <h3 className="text-sm font-medium">Follow-up plan</h3>
    <label className="block text-xs text-muted-foreground">Callback time (your local time)
      <Input type="datetime-local" aria-label="Callback time" value={callback} onChange={(e) => setCallback(e.target.value)} />
    </label>
    <Input aria-label="Next action" placeholder="Next action" maxLength={500} value={action} onChange={(e) => setAction(e.target.value)} />
    <Button type="button" size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>Save follow-up</Button>
  </section>;
}
