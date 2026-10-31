// My Pipeline (Sell → My Pipeline, /dashboard/agent-pipeline and /dashboard/clients).
//
// OVERHAUL-agentpipeline (2026-10-31). Sam: "ridiculously ugly head to toe... I can't imagine that for
// my agents wanting to use this. Make this 10 times better." The brief: one clear list with stage
// colour, one next action per row, and no more than four summary numbers.
//
// What it replaced: a "Client sales cockpit" with five gold buttons on the first screen (Add Client,
// Work next client, the selected queue chip and every card's Open call sheet), a three-way view toggle,
// two rows of queue chips, a coverage bar, and a folded "diagnostics" section holding four more big
// numbers, a renters-vs-homeowners split that was empty for every client, a funnel, a "chargebacks
// watchlist" that was really callbacks, recent additions and a directory with four dropdowns. Its
// headline numbers came from v_client_pipeline_stats, which ignores the call results saved in this
// app, so they disagreed with the list under them (1,076 sold in the header, 1,094 in the list).
//
// What it is now, top to bottom: the header (Add client); four numbers that each open their list
// (Call today, Never called, No next step, Almost there); four lists (To do, Scheduled, Sold,
// Everyone) and a search; then one list. Its first person is Up next, with what to do and why and
// the one gold button; every other row shows the stage as a coloured bar and word, when the next step
// is due, and one button that does it. Every number and row comes from src/lib/clientPipelineView.ts
// over the same loaded rows, so a number always equals the list it opens.
//
// Data: agentlink_clients (RLS: the owner sees every client, a manager their team's, an agent their
// own), paged past PostgREST's 1,000-row cap, with client_pipeline_overrides (the call sheet's saved
// stage, contact, schedule and "exact next step") laid over it. Calling records nothing: Call dials and
// opens the call sheet, where the outcome saved after the call is the record.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlarmClock, Ban, BadgeCheck, CalendarClock, ChevronDown, ChevronRight, CircleSlash, Clock, FolderKanban,
  Mail, Phone, PhoneCall, PhoneForwarded, PhoneOff, Plus, RefreshCw, Search, ShieldAlert, Target, Upload, UserRound,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAgentIdentity } from "@/hooks/useAgentIdentity";
import { useSoldCallKeys } from "@/hooks/useSoldCallKeys";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ToneBubble } from "@/components/ui/delight/ToneBubble";
import { GrowScoreboard, type ScoreTile } from "@/components/recruiting/GrowScoreboard";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { contactLinkProps, formatPhoneDisplay, phoneHref } from "@/lib/phone";
import { firstGrapheme } from "@/lib/personInitials";
import { resolveAgentNames } from "@/shared/api/agentDisplayNames";
import { TONE_CLASS, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import {
  CLIENT_STEPS,
  PIPELINE_LISTS,
  WORK_NOW,
  clientName,
  clientNextStep,
  clientQueue,
  clientStage,
  matchesClientSearch,
  mergeClientOverrides,
  parsePipelineList,
  pipelineListCounts,
  pipelineListRows,
  plural,
  type ClientNextStep,
  type ClientNextStepKey,
  type ClientStage,
  type PipelineClient,
  type PipelineListKey,
  type PipelineBackState,
  type PipelineOverride,
} from "@/lib/clientPipelineView";

/** Rows shown before "Show more": enough to work a morning, few enough to render at once on a phone. */
const PAGE = 50;

const CLIENT_COLUMNS =
  "id, insuracloud_pipeline_client_id, agent_id, first_name, last_name, phone, email, state, city, pipeline_stage, created_at, updated_at, stage_changed_at, last_contact_date, next_action_date, callback_date, callback_time, do_not_call, do_not_email, do_not_text, hostile_language_detected, policy_number";

function pipelineRpc<T>(name: string, args: Record<string, unknown>) {
  return (supabase.rpc as unknown as (fn: string, values: Record<string, unknown>) => Promise<{ data: T | null; error: { message?: string } | null }>)(name, args);
}

/** The lists the chips pick. The four numbers above them pick the other four. */
const CHIP_LISTS: PipelineListKey[] = ["todo", "scheduled", "sold", "all"];

/** One icon per kind of next step, beside the words that say it (decoration: the bubble is aria-hidden). */
const STEP_ICON: Record<ClientNextStepKey, LucideIcon> = {
  late: AlarmClock,
  today: Clock,
  first_call: PhoneCall,
  follow_up: PhoneForwarded,
  scheduled: CalendarClock,
  email_for_phone: Mail,
  no_phone: PhoneOff,
  do_not_call: Ban,
  sold: BadgeCheck,
  closed: CircleSlash,
};

/** The 8% wash behind the Up next step, the depth of a selected tile. Written out so Tailwind sees each class. */
const WASH: Record<Tone, string> = {
  good: "bg-tone-good/8",
  warm: "bg-tone-warm/8",
  hot: "bg-tone-hot/8",
  cool: "bg-tone-cool/8",
  royal: "bg-tone-royal/8",
  gold: "bg-tone-gold/8",
  slate: "bg-tone-slate/8",
};

/** Hover only where a pointer can hover, so a tapped row never stays lit on a phone. */
const ROW_HOVER = "[@media(hover:hover)_and_(pointer:fine)]:hover:border-primary/40 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/40";

const chipClass = (active: boolean) => cn(
  "inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
  active ? "border-primary bg-primary/15 font-semibold text-foreground" : "border-border bg-card text-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted",
);

function initialsOf(client: PipelineClient): string {
  return `${firstGrapheme(client.first_name)}${firstGrapheme(client.last_name)}`.toUpperCase();
}

function loadedAtLabel(ms: number): string {
  return ms ? new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return "Unknown error";
}

export default function ClientPipeline() {
  usePageTitle("My Pipeline");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, isAdmin, isManager, effectiveMode } = useAuth();
  const { agentId: myAgentId } = useAgentIdentity();
  const soldKeys = useSoldCallKeys();
  const [params, setParams] = useSearchParams();
  // The call sheet's Back returns here, to this list and search (src/pages/ClientDetail.tsx).
  const location = useLocation();
  const backState = useMemo<PipelineBackState>(() => ({ from: `${location.pathname}${location.search}` }), [location.pathname, location.search]);
  const list = parsePipelineList(params.get("list"));
  const search = params.get("q") ?? "";
  const [shown, setShown] = useState(PAGE);
  const [explainOpen, setExplainOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  // MP-348: the dialog offered 4 fields while agentlink_clients already stored
  // street_address, city, state, zip_code and date_of_birth. Sam, mid-call:
  // "not letting me input info like address or anything."
  const [newClient, setNewClient] = useState({
    firstName: "", lastName: "", phone: "", email: "",
    street: "", city: "", state: "", zip: "", dob: "", notes: "",
  });

  // "Today" moves at midnight even while the page stays open.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const clientsQ = useQuery({
    queryKey: ["client-pipeline", user?.id, isAdmin],
    enabled: !!user?.id,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      // PostgREST returns at most 1,000 rows per request, and the agency's book is past 2,000. Page
      // until a short page so nobody falls off the end of the list.
      const pageSize = 1_000;
      const loaded: PipelineClient[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("agentlink_clients")
          .select(CLIENT_COLUMNS)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const page = (data ?? []) as unknown as PipelineClient[];
        loaded.push(...page);
        if (page.length < pageSize) break;
      }
      return loaded;
    },
  });

  const overridesQ = useQuery({
    queryKey: ["client-pipeline-overrides", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const pageSize = 1_000;
      const loaded: PipelineOverride[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("client_pipeline_overrides" as never)
          .select("client_id, stage_override, stage_changed_at, last_contact_date, next_action_date, callback_date, callback_time, schedule_overridden, reminder_notes")
          .order("client_id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const page = (data ?? []) as unknown as PipelineOverride[];
        loaded.push(...page);
        if (page.length < pageSize) break;
      }
      return loaded;
    },
  });

  // Both reads are needed for a true list: without the saved call results every stage and callback
  // would be the imported one. Neither has loaded yet → loading; either failed with nothing kept → error.
  const loaded = clientsQ.data !== undefined && overridesQ.data !== undefined;
  const loadError = !loaded && (clientsQ.isError || overridesQ.isError) ? (clientsQ.error ?? overridesQ.error) : null;
  const staleError = loaded && (clientsQ.isError || overridesQ.isError) ? (clientsQ.error ?? overridesQ.error) : null;
  const rows = useMemo(
    () => (loaded ? mergeClientOverrides(clientsQ.data ?? [], overridesQ.data ?? []) : []),
    [loaded, clientsQ.data, overridesQ.data],
  );

  // A manager, an agency owner or the owner sees other agents' clients: say whose each one is. An agent
  // sees only their own.
  const mode = effectiveMode ?? (isAdmin ? "admin" : isManager ? "manager" : "agent");
  const showOwner = Boolean(isAdmin || isManager || mode === "manager" || mode === "agency_owner");
  const agentIds = useMemo(
    () => (showOwner ? Array.from(new Set(rows.map((r) => r.agent_id).filter((id): id is string => Boolean(id)))).sort() : []),
    [rows, showOwner],
  );
  const namesQ = useQuery({
    queryKey: ["client-pipeline-agent-names", agentIds],
    enabled: showOwner && agentIds.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const agents: Array<{ id: string; user_id: string | null; display_name: string | null }> = [];
      // Long .in() lists are chunked at 100 ids so the request URL stays short.
      for (let i = 0; i < agentIds.length; i += 100) {
        const { data, error } = await supabase.from("agents").select("id, user_id, display_name").in("id", agentIds.slice(i, i + 100));
        if (error) throw error;
        agents.push(...((data ?? []) as typeof agents));
      }
      const resolved = await resolveAgentNames(agents);
      return new Map(Array.from(resolved, ([id, v]) => [id, v.name] as const));
    },
  });
  const names = namesQ.data;
  const ownerOf = useCallback((client: PipelineClient): string | null => {
    if (!showOwner || !client.agent_id || client.agent_id === myAgentId) return null;
    const name = names?.get(client.agent_id);
    return name && name !== "—" ? name : null;
  }, [showOwner, myAgentId, names]);

  const searched = useMemo(
    () => rows.filter((client) => matchesClientSearch(client, search, ownerOf(client))),
    [rows, search, ownerOf],
  );
  const counts = useMemo(() => pipelineListCounts(searched, now), [searched, now]);
  const visible = useMemo(() => pipelineListRows(searched, list, now), [searched, list, now]);
  const first = visible[0];
  const upNext = first && WORK_NOW.has(clientQueue(first, now)) ? first : null;
  const rest = upNext ? visible.slice(1) : visible;
  const notShown = Math.max(0, rest.length - shown);

  const setParam = (key: string, value: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };
  /** A tile is a switch: tapping the list that is on goes back to To do. A chip always picks its list. */
  const pickTile = (key: PipelineListKey) => { setParam("list", key === list ? null : key); setShown(PAGE); };
  const pickChip = (key: PipelineListKey) => { setParam("list", key === "todo" ? null : key); setShown(PAGE); };
  const reload = () => { void clientsQ.refetch(); void overridesQ.refetch(); };

  const createClient = useMutation({
    mutationFn: async () => {
      const { data, error } = await pipelineRpc<string>("fn_client_pipeline_create", {
        p_first_name: newClient.firstName,
        p_last_name: newClient.lastName,
        p_phone: newClient.phone,
        p_email: newClient.email || null,
        p_street_address: newClient.street || null,
        p_city: newClient.city || null,
        p_state: newClient.state || null,
        p_zip_code: newClient.zip || null,
        p_date_of_birth: newClient.dob || null,
        p_notes: newClient.notes || null,
      });
      if (error || !data) throw new Error(error?.message || "Client could not be created");
      return data;
    },
    onSuccess: async (clientId) => {
      await queryClient.invalidateQueries({ queryKey: ["client-pipeline"] });
      setCreateOpen(false);
      setNewClient({ firstName: "", lastName: "", phone: "", email: "", street: "", city: "", state: "", zip: "", dob: "", notes: "" });
      toast.success("Client added to the pipeline");
      navigate(`/dashboard/clients/${clientId}`, { state: backState });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Client could not be created"),
  });

  const subtitle = isAdmin
    // Short enough for one line on a 390px phone, where the header clamps the subtitle to one line.
    ? "All clients, in the order to call them."
    : showOwner
      ? "Your team's clients, in the order to call."
      : "Your clients, in the order to call them.";
  const known = loaded ? counts : null;
  const tile = (key: PipelineListKey, look: Pick<ScoreTile, "hint" | "tone" | "icon" | "emphasis">): ScoreTile => ({
    label: PIPELINE_LISTS[key].label,
    value: known ? known[key] : null,
    definition: PIPELINE_LISTS[key].rule,
    onSelect: () => pickTile(key),
    active: list === key,
    ...look,
  });
  const listDef = PIPELINE_LISTS[list];
  const people = (n: number) => plural(n, "client");
  const soldCall = (client: PipelineClient) => soldKeys.ready && soldKeys.has(client.phone, client.first_name, client.last_name);
  const openClient = (id: string) => navigate(`/dashboard/clients/${id}`, { state: backState });

  const fetching = clientsQ.isFetching || overridesQ.isFetching;
  const emptyBook = loaded && rows.length === 0;

  return (
    // One column, ordered for the screen: on a phone the person to call comes straight under the
    // header so the gold button is on the first screen; from 640px they head the list, under the
    // numbers. The DOM order is the phone's, so a screen reader meets Up next first everywhere.
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-24 pt-4 sm:px-6">
      <PageHeader
        className="order-1 mb-0"
        eyebrow="Sell"
        icon={<FolderKanban />}
        tone="good"
        title="My Pipeline"
        subtitle={subtitle}
        primaryAction={
          // Outline on purpose: the one gold button is Up next's, the call to make right now.
          <Button type="button" variant="outline" className="h-11 bg-card" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Add client
          </Button>
        }
        secondaryActions={isAdmin ? (
          <Button type="button" variant="outline" className="h-11 bg-card" onClick={() => navigate("/dashboard/import")}>
            <Upload className="h-4 w-4" aria-hidden /> Import
          </Button>
        ) : undefined}
      />

      {loaded && upNext && (
        <UpNextClient
          key={upNext.id}
          className="order-2 sm:order-6"
          client={upNext}
          now={now}
          owner={ownerOf(upNext)}
          soldCall={soldCall(upNext)}
          backState={backState}
          onOpen={() => openClient(upNext.id)}
        />
      )}

      {/* A brand-new book has nothing to count, sort or search: it gets the welcome and Add client alone. */}
      {!emptyBook && (
        <GrowScoreboard
          className="order-3"
          label="Pipeline numbers"
          compactOnPhone
          notice={loadError ? <span>The numbers are hidden because your clients did not load.</span> : undefined}
          tiles={[
            tile("today", { hint: "Late or due today", tone: "hot", icon: <AlarmClock />, emphasis: true }),
            tile("new", { hint: "No call logged yet", tone: "cool", icon: <PhoneCall /> }),
            tile("follow_up", { hint: "Talked, nothing set", tone: "warm", icon: <PhoneForwarded /> }),
            tile("almost", { hint: "Appointment set", tone: clientStage("ALMOST_THERE").tone, icon: <Target /> }),
          ]}
        />
      )}

      {!emptyBook && (
        <div className="order-4 space-y-3">
          <div role="group" aria-label="Which clients to show" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {CHIP_LISTS.map((key) => (
              <button key={key} type="button" aria-pressed={list === key} title={PIPELINE_LISTS[key].rule} onClick={() => pickChip(key)} className={chipClass(list === key)}>
                {PIPELINE_LISTS[key].label}
                <span className="tabular-nums text-muted-foreground">{known ? known[key].toLocaleString() : "—"}</span>
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={search}
              onChange={(event) => { setParam("q", event.target.value || null); setShown(PAGE); }}
              placeholder={showOwner ? "Search name, phone, email or agent" : "Search name, phone or email"}
              aria-label="Search clients"
              enterKeyHint="search"
              className="h-11 bg-card pl-9 text-base"
            />
          </div>
        </div>
      )}

      {staleError && (
        <div role="status" className="order-4 flex flex-col gap-2 rounded-lg border border-tone-hot/35 bg-tone-hot/8 p-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 font-medium">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-tone-hot" aria-hidden />
            Showing clients loaded at {loadedAtLabel(Math.max(clientsQ.dataUpdatedAt, overridesQ.dataUpdatedAt))}. The latest reload failed: {errorText(staleError)}
          </p>
          <Button type="button" variant="outline" className="h-11 shrink-0" onClick={reload}><RefreshCw className="h-4 w-4" aria-hidden /> Try again</Button>
        </div>
      )}

      {!loaded && !loadError ? (
        <div className="order-7 space-y-2" aria-busy="true" aria-label="Loading your clients">
          <Skeleton className="h-56 w-full rounded-xl" />
          {Array.from({ length: 5 }, (_, n) => <Skeleton key={`pipe-sk-${n}`} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : loadError ? (
        <EmptyState
          className="order-7"
          icon={<ShieldAlert />}
          variant="warning"
          title="Your clients did not load"
          description={errorText(loadError)}
          actions={<Button type="button" variant="outline" className="h-11" onClick={reload}><RefreshCw className="h-4 w-4" aria-hidden /> Try again</Button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          className="order-7"
          icon={<FolderKanban />}
          title="No clients yet"
          description="Add a client when you start talking with a lead. Everyone you add shows up here in the order to call them."
          actions={<Button type="button" className="h-12 px-6" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Add client</Button>}
        />
      ) : (
        <>
          <div className="order-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 text-[15px] leading-6 text-muted-foreground">
                <span className="font-semibold text-foreground">{listDef.label}</span>
                {` · ${people(visible.length)}`}
                {visible.length > 1 && <span className="hidden sm:inline">{`, ${listDef.order}`}</span>}
              </p>
              <div className="flex shrink-0 items-center">
                <Button type="button" variant="ghost" className="h-11 px-3 text-muted-foreground" aria-expanded={explainOpen} aria-controls="pipeline-how" onClick={() => setExplainOpen((v) => !v)}>
                  How it works <ChevronDown className={cn("h-4 w-4 transition-transform", explainOpen && "rotate-180")} aria-hidden />
                </Button>
                <Button type="button" variant="ghost" className="h-11 w-11 px-0 text-muted-foreground sm:w-auto sm:px-3" aria-label="Reload clients" onClick={reload} disabled={fetching}>
                  <RefreshCw className={cn("h-4 w-4", fetching && "animate-spin")} aria-hidden /> <span className="hidden sm:inline">Reload</span>
                </Button>
              </div>
            </div>
            {/* Always in the page so the toggle's aria-controls names a real element; hidden until asked. */}
            <div id="pipeline-how" hidden={!explainOpen}><HowItWorks /></div>
          </div>

          {visible.length === 0 ? (
            <EmptyList
              className="order-7"
              list={list}
              search={search}
              scheduled={counts.scheduled}
              onClearSearch={() => setParam("q", null)}
              onPick={pickChip}
            />
          ) : rest.length > 0 ? (
            <ul aria-label={upNext ? `${listDef.label}, after Up next` : listDef.label} className="apex-rise-list order-7 space-y-2">
              {rest.slice(0, shown).map((client) => (
                <ClientRow
                  key={client.id}
                  client={client}
                  now={now}
                  owner={ownerOf(client)}
                  soldCall={soldCall(client)}
                  backState={backState}
                  onOpen={() => openClient(client.id)}
                />
              ))}
            </ul>
          ) : null}
          {notShown > 0 && (
            <Button type="button" variant="outline" className="order-8 h-11 w-full bg-card" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, notShown)} more ({notShown.toLocaleString()} not shown yet)
            </Button>
          )}
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Start a client call</DialogTitle>
            <DialogDescription>Thirty-second setup. Add the basics, open the call sheet, and capture everything else without leaving the screen.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-client-first">First name</Label>
              <Input id="new-client-first" value={newClient.firstName} onChange={(event) => setNewClient((value) => ({ ...value, firstName: event.target.value }))} autoComplete="given-name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-client-last">Last name</Label>
              <Input id="new-client-last" value={newClient.lastName} onChange={(event) => setNewClient((value) => ({ ...value, lastName: event.target.value }))} autoComplete="family-name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-client-phone">Phone number</Label>
              <Input id="new-client-phone" value={newClient.phone} onChange={(event) => setNewClient((value) => ({ ...value, phone: event.target.value }))} type="tel" autoComplete="tel" placeholder="(555) 000-0000" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-client-email">Email (optional)</Label>
              <Input id="new-client-email" value={newClient.email} onChange={(event) => setNewClient((value) => ({ ...value, email: event.target.value }))} type="email" autoComplete="email" />
            </div>
          </div>
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">Add DOB or address now <span className="font-normal text-muted-foreground">(optional)</span></summary>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="new-client-dob">Date of birth</Label><Input id="new-client-dob" value={newClient.dob} onChange={(event) => setNewClient((value) => ({ ...value, dob: event.target.value }))} type="date" /></div>
              <div className="space-y-1.5"><Label htmlFor="new-client-street">Street address</Label><Input id="new-client-street" value={newClient.street} onChange={(event) => setNewClient((value) => ({ ...value, street: event.target.value }))} autoComplete="street-address" placeholder="123 Main St" /></div>
              <div className="space-y-1.5"><Label htmlFor="new-client-city">City</Label><Input id="new-client-city" value={newClient.city} onChange={(event) => setNewClient((value) => ({ ...value, city: event.target.value }))} autoComplete="address-level2" /></div>
              <div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label htmlFor="new-client-state">State</Label><Input id="new-client-state" value={newClient.state} maxLength={2} onChange={(event) => setNewClient((value) => ({ ...value, state: event.target.value.toUpperCase() }))} autoComplete="address-level1" placeholder="TX" /></div><div className="space-y-1.5"><Label htmlFor="new-client-zip">ZIP</Label><Input id="new-client-zip" value={newClient.zip} onChange={(event) => setNewClient((value) => ({ ...value, zip: event.target.value }))} autoComplete="postal-code" inputMode="numeric" /></div></div>
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="new-client-notes">Opening notes</Label><Input id="new-client-notes" value={newClient.notes} onChange={(event) => setNewClient((value) => ({ ...value, notes: event.target.value }))} placeholder="Anything worth remembering" /></div>
            </div>
          </details>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="button" className="h-11" onClick={() => createClient.mutate()} disabled={createClient.isPending || !newClient.firstName.trim() || !newClient.lastName.trim() || newClient.phone.replace(/\D/g, "").length < 10}>{createClient.isPending ? "Opening…" : "Create & open call sheet"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

/** The stage as a four-step bar and its word. The bar shows how far; the word says where. */
function StageMark({ stage, className }: { stage: ClientStage; className?: string }) {
  const filled = Math.max(0, Math.min(CLIENT_STEPS.length, stage.index ?? 0));
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span aria-hidden="true" className="inline-flex h-2 w-14 shrink-0 items-stretch gap-[3px]">
        {CLIENT_STEPS.map((step, i) => (
          <span key={step.key} className={cn("flex-1 rounded-full", i < filled ? TONE_CLASS[stage.tone].dot : "bg-muted-foreground/20")} />
        ))}
      </span>
      <span className={cn("whitespace-nowrap text-sm font-semibold leading-5", TONE_CLASS[stage.tone].text)}>
        {stage.index ? <span className="sr-only">{`Step ${stage.index} of ${CLIENT_STEPS.length}: `}</span> : null}
        {stage.label}
        {stage.detail ? <span className="font-normal text-muted-foreground">{` · ${stage.detail}`}</span> : null}
      </span>
    </span>
  );
}

/** Initials in the stage's tone; a person icon when no name is on file. */
function ClientBubble({ client, stage, size, className }: { client: PipelineClient; stage: ClientStage; size: "md" | "lg"; className?: string }) {
  const initials = initialsOf(client);
  return (
    <ToneBubble tone={stage.tone} size={size} className={cn("font-semibold", size === "lg" ? "text-base" : "text-[13px]", className)}>
      {initials || <UserRound />}
    </ToneBubble>
  );
}

/** The facts after the name: phone, state, whose client, and the two flags worth knowing before dialing. */
function Facts({ client, owner, soldCall, id }: { client: PipelineClient; owner: string | null; soldCall: boolean; id?: string }) {
  const parts: Array<{ key: string; text: string; className?: string }> = [];
  const phone = formatPhoneDisplay(client.phone);
  if (phone) parts.push({ key: "phone", text: phone, className: "whitespace-nowrap tabular-nums" });
  if (client.state?.trim()) parts.push({ key: "state", text: client.state.trim() });
  if (owner) parts.push({ key: "owner", text: owner });
  if (soldCall) parts.push({ key: "sold-call", text: "Sold on a call", className: cn("font-semibold", TONE_CLASS.good.text) });
  if (client.hostile_language_detected) parts.push({ key: "hostile", text: "Was hostile on a call", className: cn("font-semibold", TONE_CLASS.hot.text) });
  if (parts.length === 0) return null;
  return (
    <span id={id} className="block break-words text-sm leading-5 text-muted-foreground">
      {parts.map((part, i) => (
        <span key={part.key}>
          {i > 0 ? <span aria-hidden="true"> · </span> : null}
          <span className={part.className}>{part.text}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * The button that does the row's next step. Call dials (a phone's dialer, or Google Voice on a
 * computer) and opens the call sheet underneath, so saving what happened is one tap away when the
 * call ends; dialing records nothing. Email opens a new message. Anything else opens the call sheet.
 */
function StepAction({ client, step, name, gold, onOpen, className }: {
  client: PipelineClient;
  step: ClientNextStep;
  name: string;
  gold: boolean;
  onOpen: () => void;
  className?: string;
}) {
  const tel = step.channel === "call" ? phoneHref(client.phone) : null;
  const mail = step.channel === "email" && client.email ? `mailto:${client.email.trim()}` : null;
  const variant = gold ? "default" : "outline";
  if (tel) {
    return (
      <Button asChild variant={variant} className={className}>
        <a href={tel} {...contactLinkProps(tel)} aria-label={`${step.action}: call ${name}`} onClick={onOpen}>
          <Phone className="h-4 w-4" aria-hidden /> {step.action}
        </a>
      </Button>
    );
  }
  if (mail) {
    return (
      <Button asChild variant={variant} className={className}>
        <a href={mail} aria-label={`Email ${name}`} onClick={onOpen}>
          <Mail className="h-4 w-4" aria-hidden /> {step.action}
        </a>
      </Button>
    );
  }
  return (
    <Button type="button" variant={gold ? "default" : "ghost"} className={className} aria-label={`Open ${name}'s call sheet`} onClick={onOpen}>
      {gold ? "Open call sheet" : "Open"} <ChevronRight className="h-4 w-4" aria-hidden />
    </Button>
  );
}

/** The first person on the list: who, where they are, what to do and why, and the page's one gold button. */
function UpNextClient({ client, now, owner, soldCall, backState, onOpen, className }: {
  client: PipelineClient;
  now: Date;
  owner: string | null;
  soldCall: boolean;
  backState: PipelineBackState;
  onOpen: () => void;
  className?: string;
}) {
  const stage = clientStage(client.pipeline_stage);
  const step = clientNextStep(client, now);
  const name = clientName(client);
  const Icon = STEP_ICON[step.key];
  const href = `/dashboard/clients/${client.id}`;
  const actsOnPhone = step.channel !== "open";
  return (
    // From 1024px who sits on the left and what to do on the right, so the card is short and the
    // gold button sits beside the reason for it; below that they stack, who first.
    <section
      aria-labelledby={`up-next-${client.id}`}
      className={cn("apex-rise grid gap-4 rounded-xl border border-border bg-card p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start lg:gap-6", className)}
    >
      <div className="flex items-start gap-3">
        <ClientBubble client={client} stage={stage} size="lg" />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id={`up-next-${client.id}`} className="break-words text-xl font-semibold leading-7 text-foreground">
            <span className="font-medium text-muted-foreground">Up next: </span>
            <Link to={href} state={backState} className="rounded-sm focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] [@media(hover:hover)_and_(pointer:fine)]:hover:underline">{name}</Link>
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StageMark stage={stage} />
          </div>
          <Facts client={client} owner={owner} soldCall={soldCall} />
        </div>
      </div>
      <div className="min-w-0 space-y-4">
        <section aria-label="What to do next" className={cn("flex items-start gap-3 rounded-lg border px-4 py-3", TONE_CLASS[step.tone].border, WASH[step.tone])}>
          <ToneBubble tone={step.tone} size="sm" className="mt-0.5"><Icon /></ToneBubble>
          <div className="min-w-0">
            <p className="break-words text-base font-semibold leading-6 text-foreground">{step.title}</p>
            <p className="text-pretty break-words text-[15px] leading-[22px] text-muted-foreground">{step.detail}</p>
          </div>
        </section>
        <div className="flex flex-wrap gap-2">
          <StepAction client={client} step={step} name={name} gold onOpen={onOpen} className="h-12 min-w-0 flex-1 px-6 text-base sm:flex-none sm:px-8" />
          {actsOnPhone && (
            <Button asChild variant="outline" className="h-12 shrink-0 px-5 text-base">
              <Link to={href} state={backState}>Open call sheet</Link>
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * One client on one row: who (the name opens their call sheet; the whole row is its tap target), the
 * stage as a coloured bar and word, when the next step is due in the step's tone, and one button
 * that does it. From 1024px the stage and the due line sit in their own column so rows read like a
 * table.
 */
function ClientRow({ client, now, owner, soldCall, backState, onOpen }: {
  client: PipelineClient;
  now: Date;
  owner: string | null;
  soldCall: boolean;
  backState: PipelineBackState;
  onOpen: () => void;
}) {
  const stage = clientStage(client.pipeline_stage);
  const step = clientNextStep(client, now);
  const name = clientName(client);
  const ids = { name: `pipe-${client.id}-name`, status: `pipe-${client.id}-status`, facts: `pipe-${client.id}-facts` };
  const hasFacts = Boolean(formatPhoneDisplay(client.phone) || client.state?.trim() || owner || soldCall || client.hostile_language_detected);
  return (
    <li className={cn("relative flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 transition-colors sm:px-4", ROW_HOVER)}>
      {/* On a phone the bubble gives its width to the name; the bar and the word carry the colour. */}
      <ClientBubble client={client} stage={stage} size="md" className="hidden sm:inline-flex" />
      {/* The link is named by the client and described by where they are and when, so a screen reader
          hears "Nora New, link" and then the stage, without the whole row read as one long name. */}
      <Link
        to={`/dashboard/clients/${client.id}`}
        state={backState}
        aria-labelledby={ids.name}
        aria-describedby={hasFacts ? `${ids.status} ${ids.facts}` : ids.status}
        className="grid min-w-0 flex-1 grid-cols-1 gap-y-1 rounded-md after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-center lg:gap-x-6 lg:gap-y-0.5"
      >
        <span id={ids.name} className="break-words text-base font-semibold leading-6 text-foreground lg:col-start-1 lg:row-start-1">{name}</span>
        <span id={ids.status} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:flex-col lg:items-start">
          <StageMark stage={stage} />
          <span className={cn("text-sm leading-5", step.emphasis ? cn("font-semibold", TONE_CLASS[step.tone].text) : "text-muted-foreground")}>
            {step.when}
          </span>
        </span>
        {hasFacts && <span className="lg:col-start-1 lg:row-start-2"><Facts id={ids.facts} client={client} owner={owner} soldCall={soldCall} /></span>}
      </Link>
      <StepAction client={client} step={step} name={name} gold={false} onOpen={onOpen} className="relative z-10 h-11 shrink-0 px-3 lg:w-36" />
    </li>
  );
}

/** The order and the colours, in words, for anyone who wonders why this person is first. */
function HowItWorks() {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 text-[15px] leading-[22px] sm:p-5">
      <div className="space-y-2">
        <p className="font-semibold text-foreground">The order</p>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Late callbacks, the oldest promise first.</li>
          <li>Callbacks due today, by time.</li>
          <li>Clients nobody has called, the newest first.</li>
          <li>Clients you talked to with no next step, the longest wait first.</li>
        </ol>
        <p className="text-muted-foreground">Callbacks set for a later day wait under Scheduled. Sold, closed and do-not-call clients are under Everyone.</p>
      </div>
      <div className="space-y-2">
        <p className="font-semibold text-foreground">The colors</p>
        <ul className="space-y-2">
          {CLIENT_STEPS.map((step) => (
            <li key={step.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <StageMark stage={clientStage(stepStage(step.key))} />
              <span className="text-muted-foreground">{step.means}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-muted-foreground">
        Call dials and opens their call sheet. Dialing records nothing: after you talk, save what happened on the call sheet and their next step updates here.
      </p>
    </div>
  );
}

/** A stored stage for each step, so the explainer's colours come from the same mapping as the rows. */
function stepStage(key: string): string {
  switch (key) {
    case "callback": return "FOLLOW_UP";
    case "almost": return "ALMOST_THERE";
    case "sold": return "SOLD";
    default: return "NEW_INITIAL";
  }
}

/** Nothing in this list: say why in plain words and offer the way back. */
function EmptyList({ list, search, scheduled, onClearSearch, onPick, className }: {
  className?: string;
  list: PipelineListKey;
  search: string;
  scheduled: number;
  onClearSearch: () => void;
  onPick: (key: PipelineListKey) => void;
}) {
  if (search.trim()) {
    return (
      <EmptyState
        className={className}
        icon={<Search />}
        title={`Nobody here matches “${search.trim()}”`}
        description="Search by name, phone number, email or state."
        actions={<Button type="button" variant="outline" className="h-11" onClick={onClearSearch}>Clear search</Button>}
      />
    );
  }
  const copy: Record<PipelineListKey, { title: string; description: string; good: boolean }> = {
    todo: { title: "You're caught up", description: "Nobody is waiting on a call right now.", good: true },
    today: { title: "No callbacks late or due today", description: "Every promise is on time.", good: true },
    new: { title: "Everyone has been called", description: "Every client has a call logged or a callback set.", good: true },
    follow_up: { title: "Every conversation has a next step", description: "Everyone you talked to has a callback or next action set.", good: true },
    almost: { title: "Nobody is almost there yet", description: "When you set an appointment to finish a sale, the client shows up here.", good: false },
    scheduled: { title: "No callbacks set for later", description: "When you set a callback for another day, the client waits here until then.", good: false },
    sold: { title: "No sales yet", description: "When you mark a client sold, they show up here.", good: false },
    all: { title: "No clients yet", description: "Add a client to start.", good: false },
  };
  const c = copy[list];
  return (
    <EmptyState
      className={className}
      icon={c.good ? <BadgeCheck /> : <FolderKanban />}
      variant={c.good ? "success" : "default"}
      title={c.title}
      description={c.description}
      actions={
        list === "todo" && scheduled > 0 ? (
          <Button type="button" variant="outline" className="h-11" onClick={() => onPick("scheduled")}>See {plural(scheduled, "callback")} set for later</Button>
        ) : list !== "todo" ? (
          <Button type="button" variant="outline" className="h-11" onClick={() => onPick("todo")}>Show the To do list</Button>
        ) : undefined
      }
    />
  );
}
