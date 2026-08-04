// ClientPipeline v5 — book-of-business cockpit, premium-polish edition.
//
// Source: agentlink_clients (the 1.6k-row AgentLink mirror, 109 cols).
// RLS handles visibility: admin sees all, manager sees downline, agent sees own.
//
// Sam directive (voice 2026-06-15): "Bring back my CRM. Make sure it looks
// absolutely excellent. Track tenants fluently, track homeowners fluently,
// track who hasn't bought a policy yet, track who's missing." This file is
// the surgical rewrite that ladders to that ask:
//   1. Premium hero — 4 huge numbers (Total · Sold · In flight · Stale/missing),
//      text-5xl font-black tabular-nums leading-none. The dense 4-tile slate
//      strip is gone.
//   2. Amber bottleneck callout pinned ABOVE the funnel naming the worst
//      stage-to-stage conv% (reuses the recruiting BottleneckCallout pattern).
//   3. Vertical FunnelStageCard funnel with FunnelConnector "▼ X of every 100"
//      between cards (reuses src/components/recruiting/ shared components —
//      single source of truth for the visual contract; no crm/ dupes).
//   4. Client-type segmentation tabs (Renters / Homeowners / Unknown). Housing
//      data is NOT synced from AgentLink yet — the tabs render honestly as
//      "Housing data pending" with a disclosure explaining the gap. (Truth-first
//      per Operating Contract — no fabricated tenant/homeowner split.)
//   5. "Hasn't bought a policy yet" card → opens the 844 not-sold clients,
//      tap-to-call + tap-to-email.
//   6. "Missing / cold" card → 1,620 never-contacted + 12 contact >30d cold,
//      one-tap re-engage.
//   7. All dense panels (chargebacks watchlist, recent additions, freshness
//      ladder, full directory) moved behind <details> so first paint = punch-
//      line first.
//
// Data reality (2026-06-15 audit via bot-sql):
//   • All 1,632 rows created_at = 2026-05-16 (single backfill). created_at-
//     based 60d filter ⇒ 0, so "hasn't bought" filter doesn't gate on age.
//   • policy_number IS NULL for 100% of rows (even the 788 SOLD ones —
//     AgentLink doesn't sync policy numbers yet). "Bought" signal =
//     pipeline_stage='SOLD'.
//   • product_sold / face_amount NULL across the board.
//   • last_contact_date populated for 12 rows (rest never touched in pipeline).
//   • housing columns (mortgage_payment / rent_payment) NULL or 0 for 100% —
//     no homeowner/renter split is currently possible from data alone.
//
// Counts (2026-06-15):
//   Total clients ........ 1,632
//   Sold ................. 788
//   In pipeline (active) . 35  (NEW_INITIAL=34, ALMOST_THERE=1)
//   Hasn't bought ........ 844 (pipeline_stage != 'SOLD')
//   Missing / cold ....... 1,620 (no last_contact_date)
//   Cold-after-touch ..... 12  (last_contact_date > 30d ago)
//
// Polish contract per /dashboard/recruiting (commit 4e5c515e):
//   - rounded-3xl bg-card/40 border border-border/40 px-6 py-7 for the cards
//   - text-5xl font-black tabular-nums leading-none for big numbers
//   - "—" not "Unknown" or bare "0" for missing data
//   - <details> for dense panels — lazy-mount on open

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Users, Search, Phone, Mail, CalendarClock, AlertTriangle,
  ChevronRight, TrendingUp, BookMarked, Clock, Home, Building2, HelpCircle,
  Filter, ArrowUpDown, UserPlus, ShieldOff, MailX, RefreshCw,
} from "lucide-react";
import { format, formatDistanceToNow, isBefore } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { AgentLinkConnectionPrompt } from "@/components/dashboard/AgentLinkConnectionPrompt";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FunnelStageCard } from "@/components/recruiting/FunnelStageCard";
import { FunnelConnector } from "@/components/recruiting/FunnelConnector";
import { BottleneckCallout } from "@/components/recruiting/BottleneckCallout";

interface Client {
  id: string;
  insuracloud_pipeline_client_id: string | null;
  agent_id: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  state: string | null;
  city: string | null;
  date_of_birth: string | null;
  pipeline_stage: string | null;
  created_at: string;
  updated_at: string | null;
  stage_changed_at: string | null;
  last_contact_date: string | null;
  next_action_date: string | null;
  callback_date: string | null;
  callback_time: string | null;
  do_not_call: boolean | null;
  hostile_language_detected: boolean | null;
  client_health_score: number | null;
  pitch_carrier: string | null;
  pitch_price: number | string | null;
  product_sold: string | null;
  face_amount: number | string | null;
  policy_number: string | null;
  policy_start_date: string | null;
  // Housing signal columns. NULL/0 for 100% of rows today; surfaced so the
  // moment AgentLink starts syncing real values, the segmentation tabs
  // light up automatically without another deploy.
  mortgage_payment: number | string | null;
  rent_payment: number | string | null;
}

// v24 palette restraint: 4 colors total — slate (inactive/working) +
// amber (in-flight/needs-attention) + emerald (sold) + rose (risk/follow-up).
const TINT = {
  slate:       "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700",
  slateMuted:  "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-800",
  amber:       "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  emerald:     "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  rose:        "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300 border-rose-200 dark:border-rose-800",
} as const;

const STAGE_META: Record<string, { label: string; color: string; tint: string }> = {
  NEW_INITIAL:   { label: "New",        color: "bg-slate-400",   tint: TINT.slate },
  WORKING:       { label: "Working",    color: "bg-slate-500",   tint: TINT.slate },
  PITCHED:       { label: "Pitched",    color: "bg-amber-500",   tint: TINT.amber },
  ALMOST_THERE:  { label: "Almost",     color: "bg-amber-600",   tint: TINT.amber },
  SOLD:          { label: "Sold",       color: "bg-emerald-500", tint: TINT.emerald },
  FOLLOW_UP:     { label: "Follow-up",  color: "bg-rose-500",    tint: TINT.rose },
  INACTIVE:      { label: "Inactive",   color: "bg-slate-400",   tint: TINT.slateMuted },
  UNSORTED:      { label: "Unsorted",   color: "bg-slate-300",   tint: TINT.slateMuted },
};

// Funnel stage definitions — funnels stack new → working → almost → sold so
// FunnelConnector can compute "▼ X of every 100 made it to <next>".
const FUNNEL_STAGES: Array<{
  key: "NEW_INITIAL" | "WORKING_TOTAL" | "ALMOST_THERE" | "SOLD";
  label: string;
  verbToNext: string;
}> = [
  { key: "NEW_INITIAL",   label: "New",        verbToNext: "got worked" },
  { key: "WORKING_TOTAL", label: "Working",    verbToNext: "got to almost-there" },
  { key: "ALMOST_THERE",  label: "Almost there", verbToNext: "closed" },
  { key: "SOLD",          label: "Sold",       verbToNext: "" },
];

// 3-way segment for the (eventual) housing split. Today every client lands in
// "Unknown" because AgentLink doesn't sync rent_payment / mortgage_payment.
// The classifier is wired so the moment those columns light up, the tabs
// segment automatically — no further code change required.
type HousingSegment = "homeowner" | "renter" | "unknown";

function classifyHousing(c: Pick<Client, "mortgage_payment" | "rent_payment">): HousingSegment {
  const mortgage = Number(c.mortgage_payment ?? 0);
  const rent = Number(c.rent_payment ?? 0);
  if (mortgage > 0) return "homeowner";
  if (rent > 0) return "renter";
  return "unknown";
}

function fmtPhone(p: string | null): string {
  if (!p) return "—";
  const d = p.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return p;
}

function fullName(c: Pick<Client, "first_name" | "last_name">): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "(no name)";
}

export default function ClientPipeline() {
  usePageTitle("Client Pipeline · APEX");
  const navigate = useNavigate();
  const { user, isAdmin, isManager } = useAuth();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("__all__");
  const [housingFilter, setHousingFilter] = useState<HousingSegment | "__all__">("__all__");
  const [bookFilter, setBookFilter] = useState<"all" | "hasnt_bought" | "missing">("all");
  const [sortKey, setSortKey] = useState<"recent" | "name" | "stage_changed" | "callback">("recent");

  const { data: rows = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["client-pipeline", isAdmin],
    enabled: !!user?.id,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agentlink_clients")
        .select(
          "id, insuracloud_pipeline_client_id, agent_id, first_name, last_name, phone, email, state, city, date_of_birth, pipeline_stage, created_at, updated_at, stage_changed_at, last_contact_date, next_action_date, callback_date, callback_time, do_not_call, hostile_language_detected, client_health_score, pitch_carrier, pitch_price, product_sold, face_amount, policy_number, policy_start_date, mortgage_payment, rent_payment"
        )
        .order("created_at", { ascending: false })
        .limit(2_000);
      if (error) throw error;
      return (data ?? []) as unknown as Client[];
    },
  });

  // ── Derived totals ─────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = rows.length;
    const sold = rows.filter((c) => c.pipeline_stage === "SOLD").length;
    const inFlight = rows.filter((c) =>
      c.pipeline_stage && c.pipeline_stage !== "SOLD" && c.pipeline_stage !== "INACTIVE"
    ).length;
    const unsorted = rows.filter((c) => !c.pipeline_stage).length;
    const now = Date.now();
    const new7d = rows.filter((c) => now - new Date(c.created_at).getTime() < 7 * 86_400_000).length;
    const callbacksDue = rows.filter((c) => {
      if (!c.callback_date) return false;
      const cb = new Date(c.callback_date);
      return cb.getTime() <= now + 86_400_000 && cb.getTime() > now - 7 * 86_400_000;
    }).length;
    const dnc = rows.filter((c) => c.do_not_call).length;
    const hostile = rows.filter((c) => c.hostile_language_detected).length;

    // Hasn't bought = anyone not at SOLD. policy_number is upstream-NULL so
    // we lean on pipeline_stage only — confirmed via bot-sql 2026-06-15.
    const hasntBought = rows.filter((c) => c.pipeline_stage !== "SOLD").length;
    const hasntBoughtActive = rows.filter(
      (c) => c.pipeline_stage && c.pipeline_stage !== "SOLD" && c.pipeline_stage !== "INACTIVE" && c.pipeline_stage !== "LOST"
    ).length;

    // Missing / cold = (no last_contact_date OR contacted >30d ago) AND not sold/lost.
    // Sub-split for the punchline: never-contacted vs cold-after-touch.
    const neverContacted = rows.filter(
      (c) => !c.last_contact_date && c.pipeline_stage !== "SOLD" && c.pipeline_stage !== "LOST"
    ).length;
    const coldAfterTouch = rows.filter((c) => {
      if (!c.last_contact_date) return false;
      if (c.pipeline_stage === "SOLD" || c.pipeline_stage === "LOST") return false;
      return now - new Date(c.last_contact_date).getTime() > 30 * 86_400_000;
    }).length;
    const missing = neverContacted + coldAfterTouch;

    return {
      total, sold, inFlight, unsorted, new7d, callbacksDue, dnc, hostile,
      hasntBought, hasntBoughtActive, missing, neverContacted, coldAfterTouch,
    };
  }, [rows]);

  // Housing segmentation — counts per bucket. Will be all-unknown today;
  // surfaces real numbers automatically once AgentLink starts syncing
  // mortgage_payment / rent_payment.
  const housingCounts = useMemo(() => {
    let homeowner = 0; let renter = 0; let unknown = 0;
    for (const c of rows) {
      const seg = classifyHousing(c);
      if (seg === "homeowner") homeowner++;
      else if (seg === "renter") renter++;
      else unknown++;
    }
    return { homeowner, renter, unknown };
  }, [rows]);
  const housingDataAvailable = housingCounts.homeowner + housingCounts.renter > 0;

  // Funnel: roll up the 4 stages. WORKING_TOTAL collapses WORKING+PITCHED
  // (PITCHED is a slice of working today; treating as one cohort for the
  // 4-card funnel keeps the conv math readable). SOLD = 788 today.
  const funnelCounts = useMemo(() => {
    const newCount = rows.filter((c) => c.pipeline_stage === "NEW_INITIAL").length;
    const workingTotal = rows.filter((c) =>
      c.pipeline_stage === "WORKING" || c.pipeline_stage === "PITCHED"
    ).length;
    const almost = rows.filter((c) => c.pipeline_stage === "ALMOST_THERE").length;
    const sold = rows.filter((c) => c.pipeline_stage === "SOLD").length;
    return { NEW_INITIAL: newCount, WORKING_TOTAL: workingTotal, ALMOST_THERE: almost, SOLD: sold };
  }, [rows]);

  // Bottleneck: pick the worst stage-to-stage conv% across the 4 cards.
  // Returns null when any prev is 0 (no funnel to score yet) or all
  // transitions tie at 100/0.
  const bottleneck = useMemo(() => {
    const transitions = [
      { from: "New",     to: "Working",       prev: funnelCounts.NEW_INITIAL,   next: funnelCounts.WORKING_TOTAL },
      { from: "Working", to: "Almost there",  prev: funnelCounts.WORKING_TOTAL, next: funnelCounts.ALMOST_THERE },
      { from: "Almost",  to: "Sold",          prev: funnelCounts.ALMOST_THERE,  next: funnelCounts.SOLD },
    ].filter((t) => t.prev > 0);
    if (transitions.length === 0) return null;
    const scored = transitions.map((t) => ({ ...t, convPct: Math.round((t.next / t.prev) * 100) }));
    scored.sort((a, b) => a.convPct - b.convPct);
    const worst = scored[0];
    let coachingLine = "Fix this first.";
    if (worst.from === "New") coachingLine = "Work the new ones today — most never get touched.";
    else if (worst.from === "Working") coachingLine = "Push the working pile to almost-there.";
    else if (worst.from === "Almost") coachingLine = "Close the almost-theres. They're one call away.";
    return {
      headline: `${worst.from} → ${worst.to} (only ${worst.convPct}%)`,
      coachingLine,
    };
  }, [funnelCounts]);

  // Chargebacks watch — next 7 days (PL-044).
  const callbacks = useMemo(() => {
    const now = Date.now();
    const horizon = now + 7 * 86_400_000;
    return rows
      .filter((c) => c.callback_date && !c.do_not_call)
      .map((c) => ({ c, t: new Date(c.callback_date!).getTime() }))
      .filter(({ t }) => t > now - 86_400_000 && t < horizon)
      .sort((a, b) => a.t - b.t)
      .slice(0, 8)
      .map(({ c }) => c);
  }, [rows]);

  // Recent additions.
  const recent = useMemo(() => rows.slice(0, 8), [rows]);

  // Oldest missing — the worst silence in the book (sorted by silence days).
  const missingTop = useMemo(() => {
    const now = Date.now();
    const items = rows
      .filter((c) => c.pipeline_stage !== "SOLD" && c.pipeline_stage !== "LOST")
      .map((c) => {
        const lastContactMs = c.last_contact_date ? new Date(c.last_contact_date).getTime() : null;
        const ageMs = lastContactMs ? now - lastContactMs : now - new Date(c.created_at).getTime();
        const everContacted = lastContactMs != null;
        return { c, ageDays: Math.floor(ageMs / 86_400_000), everContacted };
      })
      // Only "missing" cohort — never-touched OR cold > 30d.
      .filter((x) => !x.everContacted || x.ageDays > 30);
    items.sort((a, b) => b.ageDays - a.ageDays);
    return items.slice(0, 6);
  }, [rows]);

  // Hasn't-bought-yet preview — sorted by recent stage change so working
  // pipeline surfaces first, dormant rows behind.
  const hasntBoughtTop = useMemo(() => {
    const items = rows
      .filter((c) => c.pipeline_stage !== "SOLD" && c.pipeline_stage !== "LOST" && c.pipeline_stage !== "INACTIVE");
    items.sort((a, b) => {
      const ax = a.stage_changed_at ? new Date(a.stage_changed_at).getTime() : 0;
      const bx = b.stage_changed_at ? new Date(b.stage_changed_at).getTime() : 0;
      return bx - ax;
    });
    return items.slice(0, 6);
  }, [rows]);

  // Filtered + sorted main list (inside the Full directory disclosure).
  const list = useMemo(() => {
    const now = Date.now();
    let r = rows;
    if (stageFilter !== "__all__") {
      r = r.filter((c) => (c.pipeline_stage ?? "UNSORTED") === stageFilter);
    }
    if (housingFilter !== "__all__") {
      r = r.filter((c) => classifyHousing(c) === housingFilter);
    }
    if (bookFilter === "hasnt_bought") {
      r = r.filter((c) => c.pipeline_stage !== "SOLD" && c.pipeline_stage !== "LOST");
    } else if (bookFilter === "missing") {
      r = r.filter((c) => {
        if (c.pipeline_stage === "SOLD" || c.pipeline_stage === "LOST") return false;
        if (!c.last_contact_date) return true;
        return now - new Date(c.last_contact_date).getTime() > 30 * 86_400_000;
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(
        (c) =>
          (c.first_name ?? "").toLowerCase().includes(q) ||
          (c.last_name ?? "").toLowerCase().includes(q) ||
          (c.email ?? "").toLowerCase().includes(q) ||
          (c.phone ?? "").toLowerCase().includes(q) ||
          (c.city ?? "").toLowerCase().includes(q) ||
          (c.policy_number ?? "").toLowerCase().includes(q),
      );
    }
    switch (sortKey) {
      case "name":
        r = [...r].sort((a, b) =>
          (a.last_name ?? "").localeCompare(b.last_name ?? ""),
        );
        break;
      case "stage_changed":
        r = [...r].sort((a, b) => {
          const ax = a.stage_changed_at ? new Date(a.stage_changed_at).getTime() : 0;
          const bx = b.stage_changed_at ? new Date(b.stage_changed_at).getTime() : 0;
          return bx - ax;
        });
        break;
      case "callback":
        r = [...r].sort((a, b) => {
          const ax = a.callback_date ? new Date(a.callback_date).getTime() : Number.MAX_SAFE_INTEGER;
          const bx = b.callback_date ? new Date(b.callback_date).getTime() : Number.MAX_SAFE_INTEGER;
          return ax - bx;
        });
        break;
    }
    return r.slice(0, 250); // cap for render perf
  }, [rows, stageFilter, housingFilter, bookFilter, search, sortKey]);

  const scopeLabel = isAdmin ? "agency-wide" : isManager ? "your team" : "your book";

  // Disclosure open state — keeps Recharts / 250-row lists out of first paint.
  const [openFunnel,     setOpenFunnel]     = useState(false);
  const [openHasntBought,setOpenHasntBought]= useState(false);
  const [openMissing,    setOpenMissing]    = useState(false);
  const [openCallbacks,  setOpenCallbacks]  = useState(false);
  const [openRecent,     setOpenRecent]     = useState(false);
  const [openDirectory,  setOpenDirectory]  = useState(false);

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      {/* HERO */}
      <PageHeader
        eyebrow="Book of Business"
        eyebrowIcon={<BookMarked className="h-3 w-3" />}
        title="Client Pipeline"
        subtitle={
          <>
            Every client in <span className="text-foreground font-medium">{scopeLabel}</span> —
            who's bought, who hasn't, and who's gone quiet.
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {(() => {
              // Bind to real freshness — this badge used to hardcode "sync live"
              // while the agentlink_clients mirror was 48 days stale.
              const maxTs = rows.reduce((m, r) => { const t = r.updated_at ? Date.parse(r.updated_at) : 0; return t > m ? t : m; }, 0);
              // relative-time-guard-allow: staleness badge, days since last mirror update
              const days = maxTs ? Math.floor((Date.now() - maxTs) / 86_400_000) : null;
              const fresh = days !== null && days <= 2;
              return (
                <Badge variant="outline" className={fresh
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/40"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/40"}>
                  <span className={`h-1.5 w-1.5 rounded-full mr-1.5 ${fresh ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
                  {fresh ? "AgentLink sync live" : days === null ? "AgentLink · no data" : `AgentLink ${days}d stale`}
                </Badge>
              );
            })()}
          </div>
        }
      />

      <AgentLinkConnectionPrompt />

      {/* PUNCHLINE HERO — 4 huge numbers, phone-first. Matches the recruiting
          /dashboard/recruiting redesign (4e5c515e). text-5xl font-black
          tabular-nums leading-none — readable on a phone at arm's length. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <PunchTile
          label="Total clients"
          value={isLoading ? null : stats.total}
          sub={isLoading ? "—" : `+${stats.new7d} new this week`}
          tone="default"
        />
        <PunchTile
          label="Sold this book"
          value={isLoading ? null : stats.sold}
          sub={isLoading ? "—" : `${stats.total ? Math.round((stats.sold / stats.total) * 100) : 0}% of book`}
          tone="emerald"
        />
        <PunchTile
          label="In flight"
          value={isLoading ? null : stats.inFlight}
          sub={isLoading ? "—" : `working pile + pitched + almost`}
          tone="amber"
        />
        <PunchTile
          label="Stale / missing"
          value={isLoading ? null : stats.missing}
          sub={isLoading ? "—" : `${stats.neverContacted} never touched · ${stats.coldAfterTouch} cold 30d+`}
          tone="rose"
        />
      </div>

      {/* CLIENT-TYPE SEGMENTATION — honest about the data gap. AgentLink
          doesn't sync rent_payment/mortgage_payment today (100% NULL/0 in
          the mirror as of 2026-06-15), so the segmentation tabs render but
          surface "Housing data pending" until the upstream column lights up. */}
      <div className="rounded-3xl bg-card/40 border border-border/40 px-6 py-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <div className="text-sm text-muted-foreground">Client type</div>
            <h3 className="text-lg font-bold">Renters vs homeowners</h3>
          </div>
          {!housingDataAvailable && (
            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/40">
              <HelpCircle className="h-3 w-3 mr-1" /> Housing data pending
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <HousingPill
            icon={Home}
            label="Homeowners"
            count={housingCounts.homeowner}
            active={housingFilter === "homeowner"}
            disabled={!housingDataAvailable}
            onClick={() => setHousingFilter(housingFilter === "homeowner" ? "__all__" : "homeowner")}
          />
          <HousingPill
            icon={Building2}
            label="Renters"
            count={housingCounts.renter}
            active={housingFilter === "renter"}
            disabled={!housingDataAvailable}
            onClick={() => setHousingFilter(housingFilter === "renter" ? "__all__" : "renter")}
          />
          <HousingPill
            icon={HelpCircle}
            label="Housing —"
            count={housingCounts.unknown}
            active={housingFilter === "unknown"}
            disabled={false}
            onClick={() => setHousingFilter(housingFilter === "unknown" ? "__all__" : "unknown")}
          />
        </div>
        {!housingDataAvailable && (
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            Housing type isn't currently synced from AgentLink. The mortgage / rent fields land NULL or 0 for every client in the mirror.
            Request the field in the next AgentLink sync to enable a real renter vs homeowner split.
          </p>
        )}
      </div>

      {/* BOOK-FALLOUT TRACKERS — the two cards Sam asked for. Hasn't-bought
          and Missing each open a preview list inline; full list lives in the
          Full directory disclosure. */}
      <div className="grid gap-3 lg:grid-cols-2">
        <FalloutCard
          icon={MailX}
          title="Hasn't bought a policy yet"
          punch={stats.hasntBought}
          sub={`${stats.hasntBoughtActive} active in pipeline · ${stats.hasntBought - stats.hasntBoughtActive} dormant`}
          tone="amber"
          loading={isLoading}
          onSurface={() => {
            setBookFilter("hasnt_bought");
            setOpenDirectory(true);
          }}
          open={openHasntBought}
          setOpen={setOpenHasntBought}
        >
          {hasntBoughtTop.length === 0 ? (
            <EmptyState icon={<MailX className="h-5 w-5" />} title="Every client has bought" variant="success" />
          ) : (
            <ul className="divide-y divide-border/30">
              {hasntBoughtTop.map((c) => (
                <ClientRow
                  key={c.id}
                  client={c}
                  meta={
                    c.pipeline_stage
                      ? STAGE_META[c.pipeline_stage]?.label ?? c.pipeline_stage
                      : "Unsorted"
                  }
                  onOpen={() => navigate(`/dashboard/clients/${c.id}`)}
                />
              ))}
            </ul>
          )}
        </FalloutCard>

        <FalloutCard
          icon={ShieldOff}
          title="Missing / gone quiet"
          punch={stats.missing}
          sub={`${stats.neverContacted} never touched · ${stats.coldAfterTouch} cold 30d+`}
          tone="rose"
          loading={isLoading}
          onSurface={() => {
            setBookFilter("missing");
            setOpenDirectory(true);
          }}
          open={openMissing}
          setOpen={setOpenMissing}
        >
          {missingTop.length === 0 ? (
            <EmptyState icon={<ShieldOff className="h-5 w-5" />} title="Everyone has been touched in 30d" variant="success" />
          ) : (
            <ul className="divide-y divide-border/30">
              {missingTop.map(({ c, ageDays, everContacted }) => (
                <ClientRow
                  key={c.id}
                  client={c}
                  meta={`${everContacted ? "Cold" : "Never touched"} · ${ageDays}d`}
                  tone="rose"
                  onOpen={() => navigate(`/dashboard/clients/${c.id}`)}
                />
              ))}
            </ul>
          )}
        </FalloutCard>
      </div>

      {/* BOTTLENECK CALLOUT — pinned above the funnel. Reuses recruiting
          shared component (single source of truth for the visual contract). */}
      {bottleneck ? (
        <BottleneckCallout
          headline={bottleneck.headline}
          coachingLine={bottleneck.coachingLine}
        />
      ) : null}

      {/* PIPELINE FUNNEL — vertical, phone-first. Reuses FunnelStageCard +
          FunnelConnector from src/components/recruiting/. No duplicates. */}
      <details
        className="rounded-3xl bg-card/30 border border-border/30 px-5 py-4"
        open={openFunnel}
        onToggle={(e) => setOpenFunnel((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none flex items-center justify-between">
          <span className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> See where they sit in the funnel
          </span>
          <span className="tabular-nums text-xs text-muted-foreground/70">
            {funnelCounts.NEW_INITIAL} · {funnelCounts.WORKING_TOTAL} · {funnelCounts.ALMOST_THERE} · {funnelCounts.SOLD}
          </span>
        </summary>
        {openFunnel && (
          <div className="space-y-2 max-w-md mx-auto w-full mt-4">
            {FUNNEL_STAGES.map((stage, i) => {
              const count = funnelCounts[stage.key];
              const next = i < FUNNEL_STAGES.length - 1
                ? funnelCounts[FUNNEL_STAGES[i + 1].key]
                : null;
              return (
                <div key={stage.key}>
                  <FunnelStageCard
                    stageNumber={i + 1}
                    stageLabel={stage.label}
                    count={isLoading ? null : count}
                    delta={null}
                    subline={count === 0 ? "no clients here yet" : `${count.toLocaleString()} in cohort`}
                  />
                  {i < FUNNEL_STAGES.length - 1 ? (
                    <FunnelConnector
                      prev={isLoading ? null : count}
                      next={isLoading ? null : next}
                      verb={stage.verbToNext}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </details>

      {/* CHARGEBACKS WATCHLIST — disclosure (priority queue inside). */}
      <details
        className="rounded-2xl bg-card/30 border border-border/30 px-5 py-4"
        open={openCallbacks}
        onToggle={(e) => setOpenCallbacks((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-rose-500" /> Chargebacks watchlist (next 7 days)
          </span>
          <span className="tabular-nums text-xs text-muted-foreground/70">{stats.callbacksDue}</span>
        </summary>
        {openCallbacks && (
          <div className="mt-4">
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={/* stable-key-allow:skeleton-static-array */ i} className="h-14 w-full" />)}</div>
            ) : callbacks.length === 0 ? (
              <EmptyState
                icon={<CalendarClock className="h-6 w-6" />}
                title="No callbacks scheduled"
                description="When a client requests a callback, set the date and they'll surface here."
                variant="success"
              />
            ) : (
              <ul className="divide-y divide-border/40">
                {callbacks.map((c) => {
                  const isPast = c.callback_date && isBefore(new Date(c.callback_date), new Date());
                  return (
                    <li key={c.id} className="py-2.5 flex items-center justify-between gap-3 hover:bg-primary/[0.04] rounded px-2 -mx-2 transition-colors">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{fullName(c)}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {fmtPhone(c.phone)} · {c.state ?? "—"}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-semibold ${isPast ? "text-rose-500 dark:text-rose-400" : "text-foreground"}`}>
                          {c.callback_date ? format(new Date(c.callback_date), "MMM d") : "—"}
                          {c.callback_time ? ` · ${c.callback_time}` : ""}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {c.callback_date ? formatDistanceToNow(new Date(c.callback_date), { addSuffix: true }) : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </details>

      {/* RECENT ADDITIONS — disclosure. */}
      <details
        className="rounded-2xl bg-card/30 border border-border/30 px-5 py-4"
        open={openRecent}
        onToggle={(e) => setOpenRecent((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none flex items-center justify-between">
          <span className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" /> Recent additions
          </span>
          <span className="tabular-nums text-xs text-muted-foreground/70">+{stats.new7d} this week</span>
        </summary>
        {openRecent && (
          <div className="mt-4">
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={/* stable-key-allow:skeleton-static-array */ i} className="h-14 w-full" />)}</div>
            ) : recent.length === 0 ? (
              <EmptyState icon={<UserPlus className="h-6 w-6" />} title="No clients on file" />
            ) : (
              <ul className="divide-y divide-border/40">
                {recent.map((c) => {
                  const stage = STAGE_META[c.pipeline_stage ?? "UNSORTED"] ?? STAGE_META.UNSORTED;
                  return (
                    <li key={c.id} className="py-2.5 flex items-center justify-between gap-3 hover:bg-primary/[0.04] rounded px-2 -mx-2 transition-colors">
                      <div className="min-w-0 flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                          {(c.first_name?.[0] ?? "?") + (c.last_name?.[0] ?? "")}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{fullName(c)}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {c.city ? `${c.city}, ${c.state}` : c.state ?? "—"}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge variant="outline" className={`text-[10px]  ${stage.tint}`}>{stage.label}</Badge>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </details>

      {/* FULL DIRECTORY — disclosure with search + 3 filter axes. */}
      <details
        className="rounded-2xl bg-card/30 border border-border/30 px-5 py-4"
        open={openDirectory}
        onToggle={(e) => setOpenDirectory((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Users className="h-4 w-4" /> Full client directory
          </span>
          <span className="tabular-nums text-xs text-muted-foreground/70">{stats.total.toLocaleString()}</span>
        </summary>
        {openDirectory && (
          <div className="mt-4">
            <GlassCard className="p-4">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Full directory</p>
                  <h3 className="text-lg font-bold">All clients</h3>
                </div>
                <Badge variant="outline" className="text-xs">
                  {list.length.toLocaleString()} of {stats.total.toLocaleString()}
                </Badge>
              </div>

              {/* Filter bar */}
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center mb-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, email, phone, city, policy #"
                    className="pl-9"
                  />
                </div>
                <Select value={bookFilter} onValueChange={(v) => setBookFilter(v as typeof bookFilter)}>
                  <SelectTrigger className="lg:w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All clients</SelectItem>
                    <SelectItem value="hasnt_bought">Hasn't bought</SelectItem>
                    <SelectItem value="missing">Missing / cold</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={housingFilter} onValueChange={(v) => setHousingFilter(v as typeof housingFilter)}>
                  <SelectTrigger className="lg:w-[160px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Any housing</SelectItem>
                    <SelectItem value="homeowner" disabled={!housingDataAvailable && housingCounts.homeowner === 0}>
                      Homeowner{!housingDataAvailable ? " (pending)" : ""}
                    </SelectItem>
                    <SelectItem value="renter" disabled={!housingDataAvailable && housingCounts.renter === 0}>
                      Renter{!housingDataAvailable ? " (pending)" : ""}
                    </SelectItem>
                    <SelectItem value="unknown">Unknown housing</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={stageFilter} onValueChange={setStageFilter}>
                  <SelectTrigger className="lg:w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All stages</SelectItem>
                    {Object.entries(STAGE_META).map(([k, m]) => (
                      <SelectItem key={k} value={k}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={sortKey} onValueChange={(v) => setSortKey(v as typeof sortKey)}>
                  <SelectTrigger className="lg:w-[160px]"><ArrowUpDown className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recent">Newest first</SelectItem>
                    <SelectItem value="name">Name A→Z</SelectItem>
                    <SelectItem value="stage_changed">Stage changed</SelectItem>
                    <SelectItem value="callback">Callback due</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* List */}
              {isLoading ? (
                <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={/* stable-key-allow:skeleton-static-array */ i} className="h-14 w-full" />)}</div>
              ) : list.length === 0 ? (
                <EmptyState
                  icon={<Filter className="h-6 w-6" />}
                  title="No clients match these filters"
                  description="Try widening the stage, housing, or book filter, or clear the search."
                  actions={
                    <Button size="sm" variant="ghost" onClick={() => {
                      setSearch(""); setStageFilter("__all__"); setHousingFilter("__all__"); setBookFilter("all");
                    }}>Clear filters</Button>
                  }
                />
              ) : (
                <div className="space-y-1.5">
                  {list.map((c) => {
                    const stage = STAGE_META[c.pipeline_stage ?? "UNSORTED"] ?? STAGE_META.UNSORTED;
                    const hasCallback = !!c.callback_date;
                    const isOverdue = hasCallback && isBefore(new Date(c.callback_date!), new Date());
                    const lastContactDays = c.last_contact_date
                      ? Math.floor((Date.now() - new Date(c.last_contact_date).getTime()) / 86_400_000)
                      : null;
                    const isStale = lastContactDays != null && lastContactDays > 30;
                    const housing = classifyHousing(c);
                    return (
                      <div
                        key={c.id}
                        className="flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2.5 hover:border-primary/40 hover:bg-primary/[0.03] transition-base cursor-pointer"
                        onClick={() => navigate(`/dashboard/clients/${c.id}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter") navigate(`/dashboard/clients/${c.id}`); }}
                      >
                        <div className="h-9 w-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                          {(c.first_name?.[0] ?? "?") + (c.last_name?.[0] ?? "")}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold truncate">{fullName(c)}</p>
                            <Badge variant="outline" className={`text-[10px]  ${stage.tint}`}>{stage.label}</Badge>
                            {housing === "homeowner" && (
                              <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/40">
                                <Home className="h-2.5 w-2.5 mr-0.5" /> Owner
                              </Badge>
                            )}
                            {housing === "renter" && (
                              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/40">
                                <Building2 className="h-2.5 w-2.5 mr-0.5" /> Renter
                              </Badge>
                            )}
                            {c.do_not_call && (
                              <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/40">DNC</Badge>
                            )}
                            {c.hostile_language_detected && (
                              <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/40">
                                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Hostile
                              </Badge>
                            )}
                            {isStale && (
                              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/40">
                                <Clock className="h-2.5 w-2.5 mr-0.5" /> {lastContactDays}d cold
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {fmtPhone(c.phone)}
                            {c.email && <> · {c.email}</>}
                            {c.city && <> · {c.city}, {c.state}</>}
                          </p>
                        </div>
                        <div className="hidden md:flex flex-col items-end text-xs text-muted-foreground shrink-0 min-w-[110px]">
                          {hasCallback && (
                            <span className={`font-semibold ${isOverdue ? "text-rose-500 dark:text-rose-400" : "text-foreground"}`}>
                              Callback {format(new Date(c.callback_date!), "MMM d")}
                            </span>
                          )}
                          <span>
                            {c.stage_changed_at
                              ? formatDistanceToNow(new Date(c.stage_changed_at), { addSuffix: true })
                              : `Added ${formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {c.phone && !c.do_not_call && (
                            <Button asChild size="icon" variant="ghost" title="Call" onClick={(e) => e.stopPropagation()}>
                              <a href={`tel:${c.phone}`}><Phone className="h-4 w-4" /></a>
                            </Button>
                          )}
                          {c.email && (
                            <Button asChild size="icon" variant="ghost" title="Email" onClick={(e) => e.stopPropagation()}>
                              <a href={`mailto:${c.email}`}><Mail className="h-4 w-4" /></a>
                            </Button>
                          )}
                          <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                        </div>
                      </div>
                    );
                  })}
                  {rows.length > list.length && (
                    <p className="text-xs text-center text-muted-foreground pt-3">
                      Showing first 250 of {list.length.toLocaleString()} matches. Refine your filters to drill in.
                    </p>
                  )}
                </div>
              )}
            </GlassCard>
          </div>
        )}
      </details>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

interface PunchTileProps {
  label: string;
  value: number | null;
  sub: string;
  tone: "default" | "emerald" | "amber" | "rose";
}
function PunchTile({ label, value, sub, tone }: PunchTileProps) {
  const valueTint =
    tone === "emerald" ? "text-emerald-500 dark:text-emerald-400"
    : tone === "amber" ? "text-amber-500 dark:text-amber-400"
    : tone === "rose"  ? "text-rose-500 dark:text-rose-400"
    : "text-foreground";
  return (
    <div className="rounded-3xl bg-card/40 border border-border/40 px-6 py-7">
      <div className="text-sm text-muted-foreground mb-3">{label}</div>
      <div className={`text-5xl font-black tabular-nums leading-none ${valueTint}`}>
        {value == null ? "—" : value.toLocaleString()}
      </div>
      <div className="text-xs text-muted-foreground/70 mt-3">{sub}</div>
    </div>
  );
}

interface HousingPillProps {
  icon: React.ElementType;
  label: string;
  count: number;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}
function HousingPill({ icon: Icon, label, count, active, disabled, onClick }: HousingPillProps) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`text-left rounded-2xl border px-4 py-3 transition-colors ${
        disabled
          ? "border-border/30 bg-muted/20 cursor-not-allowed"
          : active
          ? "border-primary/50 bg-primary/10"
          : "border-border/40 bg-card/30 hover:border-primary/30 hover:bg-primary/[0.04]"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`h-4 w-4 ${disabled ? "text-muted-foreground/50" : "text-muted-foreground"}`} />
        <span className={`text-xs ${disabled ? "text-muted-foreground/50" : "text-muted-foreground"}`}>{label}</span>
      </div>
      <div className={`text-2xl font-black tabular-nums leading-none ${disabled ? "text-muted-foreground/50" : "text-foreground"}`}>
        {count === 0 && disabled ? "—" : count.toLocaleString()}
      </div>
    </button>
  );
}

interface FalloutCardProps {
  icon: React.ElementType;
  title: string;
  punch: number;
  sub: string;
  tone: "amber" | "rose";
  loading: boolean;
  onSurface: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  children: React.ReactNode;
}
function FalloutCard({
  icon: Icon, title, punch, sub, tone, loading, onSurface, open, setOpen, children,
}: FalloutCardProps) {
  const punchTint =
    tone === "amber" ? "text-amber-500 dark:text-amber-400"
    : "text-rose-500 dark:text-rose-400";
  const accentTint =
    tone === "amber" ? "text-amber-600 dark:text-amber-300"
    : "text-rose-600 dark:text-rose-300";
  return (
    <div className="rounded-3xl bg-card/40 border border-border/40 px-6 py-7">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className={`flex items-center gap-2 text-sm ${accentTint}`}>
            <Icon className="h-4 w-4" />
            <span className="font-semibold">{title}</span>
          </div>
          <div className={`text-5xl font-black tabular-nums leading-none ${punchTint} mt-3`}>
            {loading ? "—" : punch.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground/70 mt-2">{sub}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={onSurface}>
          See full list <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
      <details
        className="mt-2"
        open={open}
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none">
          {open ? "Hide preview" : "Show top 6"}
        </summary>
        <div className="mt-3">
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={/* stable-key-allow:skeleton-static-array */ i} className="h-12 w-full" />)}</div>
          ) : children}
        </div>
      </details>
    </div>
  );
}

interface ClientRowProps {
  client: Client;
  meta: string;
  tone?: "rose";
  onOpen: () => void;
}
function ClientRow({ client, meta, tone, onOpen }: ClientRowProps) {
  const metaTint = tone === "rose" ? "text-rose-500 dark:text-rose-400" : "text-muted-foreground";
  return (
    <li
      className="py-2.5 flex items-center justify-between gap-3 hover:bg-primary/[0.04] rounded px-2 -mx-2 transition-colors cursor-pointer"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
    >
      <div className="min-w-0 flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
          {(client.first_name?.[0] ?? "?") + (client.last_name?.[0] ?? "")}
        </div>
        <div className="min-w-0">
          <p className="font-semibold truncate">{fullName(client)}</p>
          <p className="text-xs text-muted-foreground truncate">
            {fmtPhone(client.phone)}
            {client.email && <> · {client.email}</>}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className={`text-xs font-semibold tabular-nums ${metaTint}`}>{meta}</span>
        {client.phone && !client.do_not_call && (
          <Button asChild size="icon" variant="ghost" title="Call" onClick={(e) => e.stopPropagation()}>
            <a href={`tel:${client.phone}`}><Phone className="h-4 w-4" /></a>
          </Button>
        )}
        {client.email && (
          <Button asChild size="icon" variant="ghost" title="Email" onClick={(e) => e.stopPropagation()}>
            <a href={`mailto:${client.email}`}><Mail className="h-4 w-4" /></a>
          </Button>
        )}
        <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
      </div>
    </li>
  );
}
