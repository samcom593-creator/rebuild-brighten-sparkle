import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { TIER_STYLE, flagBadges } from "@/lib/leadBundles";
import { formatTimeAgo } from "@/lib/dateUtils";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Layers, Send, Download, Archive, DollarSign, AlertTriangle, UserRound, X,
  Trophy, Phone, RotateCcw, Boxes, ClipboardList, Users as UsersIcon, Check,
  ChevronsUpDown,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Lead Manager — the one console Sam + Aisha use to package leads and drop them
 * into an agent's portal. One switch picks the POOL; the filters and tiers adapt;
 * you open the agent drop-down, tap a name, and drop the pack. A resale ledger stops
 * a lead going out twice and Do-Not-Call numbers are held back (and counted, so
 * the number makes sense). Dropped leads land on the agent's My Leads page.
 *
 * Pools: marketing (owned client_leads), dialer (ReadyMode graded calls),
 * rewrite (booking calls where data was collected but never booked — the easy
 * re-writes), winback (lapsed/cancelled policies, re-approached by our OWN agents;
 * a Vantage filter, never a resale of anything in force). Backed by the
 * lead_pool_* / lead_bundle_* / lead_closers_leaderboard RPCs, all gated server
 * side by can_view_sold_calls().
 */

// Admin RPCs aren't in the drifted committed types.ts — shallow-cast (repo pattern).
// MUST stay .bind(supabase): a bare `supabase.rpc as ...` detaches the method, so `this`
// is undefined at call time and every query on this page throws before reaching the
// network ("Cannot read properties of undefined (reading 'rest')") — live 11-03→11-09.
type RpcResult = { data: unknown; error: { message: string } | null };
const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>;

type PoolKey = "marketing" | "dialer" | "rewrite" | "winback";

const POOLS: { key: PoolKey; label: string; icon: typeof Layers; blurb: string }[] = [
  { key: "marketing", label: "Marketing", icon: Layers, blurb: "Owned aged leads" },
  { key: "dialer", label: "Dialer", icon: Phone, blurb: "Called & graded" },
  { key: "rewrite", label: "Re-write pile", icon: RotateCcw, blurb: "Collected, never booked" },
  { key: "winback", label: "Win-back", icon: Boxes, blurb: "Lapsed policies" },
];

// Which tier chips + which controls each pool shows.
const POOL_TIERS: Record<PoolKey, { v: string; label: string }[]> = {
  marketing: [{ v: "A", label: "A" }, { v: "B", label: "B" }, { v: "C", label: "C" }, { v: "D", label: "D" }],
  dialer: [{ v: "A", label: "A" }, { v: "B", label: "B" }, { v: "C", label: "C" }, { v: "D", label: "D" }, { v: "pos", label: "POS" }],
  rewrite: [{ v: "S", label: "S" }, { v: "A", label: "A" }, { v: "B", label: "B" }],
  winback: [{ v: "A", label: "Lapsed" }, { v: "B", label: "Other out-of-force" }],
};

const POOL_FLAGS: Record<PoolKey, { key: string; label: string }[]> = {
  marketing: [
    { key: "mortgage", label: "Mortgage" }, { key: "veteran", label: "Veteran" },
    { key: "homeowner", label: "Homeowner" }, { key: "policyholder", label: "Has a policy" },
  ],
  dialer: [],
  rewrite: [
    { key: "cc", label: "Card on file" }, { key: "no_bank", label: "No bank" },
    { key: "ssn_collected", label: "SSN collected" }, { key: "bank_collected", label: "Bank collected" },
    { key: "spouse", label: "Spouse opp" },
  ],
  winback: [],
};


type PoolCounts = {
  total: number;
  by_tier: Record<string, number>;
  under_9mo: number;
  dnc_excluded: number;
  resold_excluded: number;
  in_bundle_excluded: number;
  sample: Array<{
    first_name: string | null; last_name: string | null; phone_masked: string;
    state: string | null; age: number | null; tier: string; tags: string | null;
    flags: Record<string, unknown>; lead_age_days: number; under_9mo: boolean;
  }>;
};
type AssignableAgent = { user_id: string; agent_id: string; display_name: string; subagency: string | null; is_live?: boolean };
type RecentBundle = {
  bundle_id: string; name: string; note: string | null; created_at: string; archived_at: string | null;
  live_items: number; sold: number; under_9mo: number; resold: boolean;
  worked: number; dialed: number; last_worked_at: string | null;
  holders: Array<{ user_id: string; name: string | null; granted_at: string; worked: number; dialed: number }>;
};
type Closer = {
  user_id: string; display_name: string | null; dropped: number; worked: number;
  sold: number; appointments: number; recorded: number; sold_rate: number | null;
};
type ExportRow = {
  first_name: string | null; last_name: string | null; phone10: string | null; email: string | null;
  state: string | null; age: number | null; grade: string | null; tags: string | null; status: string | null;
};

function csvField(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const deFanged = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(deFanged) ? `"${deFanged.replace(/"/g, '""')}"` : deFanged;
}
function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const body = [headers.map(csvField).join(","), ...rows.map((r) => r.map(csvField).join(","))].join("\n");
  const blob = new Blob([`${body}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

const ROSTER_CACHE_KEY = "lead-agent-roster-v2"; // v2: rows carry is_live

function readRosterCache(): AssignableAgent[] | null {
  try {
    const raw = localStorage.getItem(ROSTER_CACHE_KEY);
    if (!raw) return null;
    const rows = JSON.parse(raw) as AssignableAgent[];
    const sound = Array.isArray(rows) && rows.length > 0
      && rows.every((r) => typeof r?.user_id === "string" && typeof r?.display_name === "string");
    return sound ? rows : null;
  } catch {
    return null;
  }
}

function writeRosterCache(rows: AssignableAgent[]) {
  try {
    localStorage.setItem(ROSTER_CACHE_KEY, JSON.stringify(rows));
  } catch {
    return; // storage unavailable (private window) — the roster just won't survive reloads
  }
}

// The roster both pickers tap from. Design rule after two field failures: the list is
// NEVER allowed to render dead.
// (1) An expired tab token THROWS from the rpc, and the old self-heal ran only on the
//     EMPTY branch — so the one failure Sam actually hits (401 after the tab sat open
//     overnight) skipped the session refresh entirely and went straight to a red wall.
//     Both branches heal now: error → refresh → retry; empty-with-session → refresh → retry.
// (2) The last good roster is cached in localStorage and rendered whenever the live read
//     has nothing, so mid-flap or mid-heal Sam still sees tappable agents with a quiet
//     "refreshing" note instead of an error wall. The wall remains only for a cold cache
//     plus a hard failure, and while in that state the query retries itself every 20s.
function useAgentRoster() {
  const q = useQuery<AssignableAgent[]>({
    queryKey: ["assignable-agents-all"],
    queryFn: async () => {
      const fetchAgents = async () => {
        const { data, error } = await rpc("lead_assignable_agents", { p_search: null });
        if (error) throw error;
        return (data as AssignableAgent[]) ?? [];
      };
      let rows: AssignableAgent[];
      try {
        rows = await fetchAgents();
      } catch (firstErr) {
        // A 401/expired token lands HERE, not in the empty branch. refreshSession
        // resolves {data,error} (no throw); the retried fetch is the real verdict.
        await supabase.auth.refreshSession();
        try {
          rows = await fetchAgents();
        } catch {
          throw firstErr instanceof Error ? firstErr : new Error("Could not load agents");
        }
      }
      if (rows.length === 0) {
        // The gate returns an empty list WITH NO ERROR when the caller resolves
        // unauthenticated (documented session-wipe history) — heal that path too.
        const { data: s } = await supabase.auth.getSession();
        if (s.session) {
          await supabase.auth.refreshSession();
          rows = await fetchAgents();
        }
      }
      if (rows.length > 0) writeRosterCache(rows);
      return rows;
    },
    retry: 1,
    staleTime: 120_000,
    // Sam's network flaps (documented Wi-Fi / MagicDNS drops): the app default
    // networkMode:"offlineFirst" would serve a cached-empty roster and refuse the
    // network while the browser momentarily looks offline.
    networkMode: "always",
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.status === "error" ? 20_000 : false),
  });
  const fallback = useMemo(() => readRosterCache() ?? [], []);
  const roster = q.data && q.data.length > 0 ? q.data : fallback;
  // True when what's on screen is the cached list, not a confirmed live read.
  const degraded = roster.length > 0 && (q.isError || !q.data || q.data.length === 0);
  return {
    roster,
    degraded,
    isLoading: q.isPending && roster.length === 0,
    isError: q.isError,
    isFetching: q.isFetching,
    refetch: q.refetch,
  };
}

// One clean drop-down for every "pick an agent" moment on this page (Sam,
// 2026-11-09: the always-visible 66-chip wall was "bulky and ugly" — he asked
// for a drop-down he taps open, taps a name, done). Search inside the panel is
// optional; the list itself is the primary surface, sized for thumbs.
function AgentDropdown({
  agents, degraded, isLoading, selectedId, onPick, placeholder, disabled, widthClass,
}: {
  agents: AssignableAgent[];
  degraded: boolean;
  isLoading: boolean;
  selectedId?: string | null;
  onPick: (a: AssignableAgent) => void;
  placeholder: string;
  disabled?: boolean;
  widthClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const selected = selectedId ? agents.find((a) => a.user_id === selectedId) ?? null : null;
  // Sam (2026-11-09): "the only people who I'm gonna possibly get leads will be
  // agents who are marked as live, in the field." Default list = is_live agents
  // (field stage OR pack history — see lead_assignable_agents). Typing a search
  // or tapping "Show all" spans everyone, and granting to someone new creates
  // the grant row that marks them live, so the short list maintains itself.
  // is_live !== false (not === true) so pre-v2 cached rows without the field
  // still render instead of blanking the list.
  const live = agents.filter((a) => a.is_live !== false);
  const expanded = showAll || query.trim().length > 0 || live.length === 0;
  const shown = expanded
    ? agents
    : selected && !live.some((a) => a.user_id === selected.user_id)
      ? [...live, selected]
      : live;
  const hiddenCount = agents.length - live.length;
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setShowAll(false); setQuery(""); } }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("h-11 justify-between px-3 font-normal", widthClass ?? "w-full sm:w-80")}
        >
          <span className="flex min-w-0 items-center gap-2">
            <UserRound className={cn("h-4 w-4 shrink-0", selected ? "text-primary" : "opacity-50")} />
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected ? selected.display_name : isLoading ? "Loading agents…" : placeholder}
            </span>
            {selected?.subagency && (
              <Badge variant="outline" className="shrink-0 text-[10px]">{selected.subagency}</Badge>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search all agents…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-72">
            {degraded && (
              <div className="flex items-center gap-1.5 border-b border-border/50 px-3 py-1.5 text-[11px] text-amber-400">
                <AlertTriangle className="h-3 w-3 shrink-0" /> Refreshing — showing the last known list. Tapping works.
              </div>
            )}
            <CommandEmpty>{isLoading ? "Loading agents…" : "No agents match."}</CommandEmpty>
            {shown.map((a) => (
              <CommandItem
                key={a.user_id}
                value={`${a.display_name} ${a.subagency ?? ""}`}
                onSelect={() => { onPick(a); setOpen(false); }}
                className="gap-2 py-2.5"
              >
                <Check className={cn("h-4 w-4 shrink-0", selectedId === a.user_id ? "text-primary opacity-100" : "opacity-0")} />
                <span className="flex-1 truncate">{a.display_name}</span>
                {a.subagency && <span className="shrink-0 text-xs text-muted-foreground">{a.subagency}</span>}
              </CommandItem>
            ))}
          </CommandList>
          {!expanded && hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="flex w-full items-center justify-center gap-1 border-t border-border/50 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Show all {agents.length} agents
            </button>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function LeadManager() {
  const queryClient = useQueryClient();
  const [pool, setPool] = useState<PoolKey>("marketing");

  // filter state (shared object; controls shown depend on pool)
  const [tiers, setTiers] = useState<Set<string>>(new Set());
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [states, setStates] = useState("");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [vantageOnly, setVantageOnly] = useState(false);
  const [excludeDnc, setExcludeDnc] = useState(true);
  const [excludeResold, setExcludeResold] = useState(true);
  const [sort, setSort] = useState("tier");
  const [limit, setLimit] = useState(100);
  const [note, setNote] = useState("");

  // reset tier/flag selections when switching pools (they differ per pool)
  useEffect(() => {
    setTiers(new Set()); setFlags(new Set()); setVantageOnly(false);
    setStates(""); setMinAge(""); setMaxAge("");
  }, [pool]);

  const [agent, setAgent] = useState<AssignableAgent | null>(null);

  const filters = useMemo(() => {
    const f: Record<string, unknown> = { exclude_dnc: excludeDnc, exclude_resold: excludeResold, sort };
    if (tiers.size) f.tiers = Array.from(tiers);
    if (flags.size) f.require_flags = Array.from(flags);
    // state/age inputs only exist for the marketing pool — never leak them into
    // dialer/rewrite/winback (which emit null state/age) and silently zero them.
    if (pool === "marketing") {
      const st = states.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (st.length) f.states = st;
      if (minAge) f.min_age = Number(minAge);
      if (maxAge) f.max_age = Number(maxAge);
    }
    if (vantageOnly) f.vantage_only = true;
    return f;
  }, [pool, tiers, flags, states, minAge, maxAge, vantageOnly, excludeDnc, excludeResold, sort]);

  const debouncedFilters = useDebounced(filters, 350);

  // per-pool switch totals + tier mix (unfiltered). One RPC for all four pools
  // (lead_pool_tiles, ~2.8s server-side) cached for 10 minutes — this is what
  // made the page FEEL slow: it used to fire four counts calls (~5.7s of DB
  // work, marketing scanned twice) on every single visit.
  const { data: totals = {} } = useQuery<Record<string, { total: number; by_tier: Record<string, number> }>>({
    queryKey: ["lead-pool-tiles"],
    queryFn: async () => {
      const { data, error } = await rpc("lead_pool_tiles");
      if (error) throw error;
      return (data ?? {}) as Record<string, { total: number; by_tier: Record<string, number> }>;
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });

  const { data: counts, isFetching } = useQuery<PoolCounts>({
    queryKey: ["lead-pool", pool, debouncedFilters],
    queryFn: async () => {
      const { data, error } = await rpc("lead_pool_counts", { p_source: pool, p_filters: debouncedFilters });
      if (error) throw error;
      return (data as PoolCounts) ?? { total: 0, by_tier: {}, under_9mo: 0, dnc_excluded: 0, resold_excluded: 0, in_bundle_excluded: 0, sample: [] };
    },
    staleTime: 60_000,
    // A marketing count is a ~3s scan: keep the previous numbers on screen with
    // the spinner while a filter tweak recomputes, instead of blanking to "—".
    placeholderData: (prev) => prev,
  });

  // Shared tap-roster (see useAgentRoster above) — the same list BundleManage taps from.
  const agentsRoster = useAgentRoster();
  const agents = agentsRoster.roster;
  const refreshAgents = async () => {
    // Always refetch, even if the session refresh itself errors — the refetch
    // is what repopulates the list once the token is good again.
    try { await supabase.auth.refreshSession(); } finally { agentsRoster.refetch(); }
  };
  // Keep the tab's token alive so the rpcs never fire with a dead one: on every
  // return to the tab (and on mount) refresh when expiry is inside two minutes.
  // This is the failure Sam kept hitting — a tab left open overnight, then
  // "login to this tab may have expired" on the first tap of the day.
  useEffect(() => {
    const nudge = async () => {
      if (document.visibilityState !== "visible") return;
      const { data } = await supabase.auth.getSession();
      const expMs = (data.session?.expires_at ?? 0) * 1000;
      if (!data.session || expMs - Date.now() < 120_000) {
        await supabase.auth.refreshSession();
      }
    };
    void nudge();
    document.addEventListener("visibilitychange", nudge);
    window.addEventListener("focus", nudge);
    return () => {
      document.removeEventListener("visibilitychange", nudge);
      window.removeEventListener("focus", nudge);
    };
  }, []);
  // internal-nav-href-allow:auth-recovery — a dead/stale session needs a full app reboot, not an in-SPA nav that keeps the broken client in memory.
  const goLogin = () => window.location.assign("/login");

  const { data: recent = [] } = useQuery<RecentBundle[]>({
    queryKey: ["lead-bundles-recent"],
    queryFn: async () => {
      const { data, error } = await rpc("lead_bundle_recent", { p_limit: 50 });
      if (error) throw error;
      return (data as RecentBundle[]) ?? [];
    },
    staleTime: 15_000,
  });

  const { data: closers = [] } = useQuery<Closer[]>({
    queryKey: ["lead-closers"],
    queryFn: async () => {
      const { data, error } = await rpc("lead_closers_leaderboard");
      if (error) throw error;
      return (data as Closer[]) ?? [];
    },
    staleTime: 30_000,
  });

  const dropCount = Math.min(limit, counts?.total ?? 0);

  const assign = useMutation({
    mutationFn: async () => {
      if (!agent) throw new Error("Pick a live agent first.");
      const { data, error } = await rpc("lead_pool_assign", {
        p_source: pool, p_filters: filters, p_limit: limit,
        p_agent_user_id: agent.user_id, p_name: null, p_note: note.trim() || null,
      });
      if (error) throw error;
      return data as { items: number; agent: string };
    },
    onSuccess: (res) => {
      toast.success(`${res.items} lead${res.items === 1 ? "" : "s"} dropped into ${res.agent}'s portal`);
      setAgent(null); setNote("");
      queryClient.invalidateQueries({ queryKey: ["lead-bundles-recent"] });
      queryClient.invalidateQueries({ queryKey: ["lead-pool"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not assign"),
  });

  const archive = useMutation({
    mutationFn: async (bundleId: string) => {
      const { error } = await rpc("lead_bundle_archive", { p_bundle: bundleId });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Archived"); queryClient.invalidateQueries({ queryKey: ["lead-bundles-recent"] }); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not archive"),
  });

  async function exportPack(b: RecentBundle) {
    const { data, error } = await rpc("lead_bundle_export", { p_bundle: b.bundle_id });
    if (error) { toast.error("Could not export pack"); return; }
    const rows = ((data as ExportRow[]) ?? []).map((r) => [
      r.first_name, r.last_name, r.phone10, r.email, r.state, r.age, r.grade, r.tags, r.status,
    ]);
    downloadCsv(`${b.name.replace(/[^\w.-]+/g, "_")}.csv`,
      ["First", "Last", "Phone", "Email", "State", "Age", "Tier", "Tags", "Status"], rows);
    toast.success(`Exported ${rows.length} leads`);
  }

  const tierOpts = POOL_TIERS[pool];
  const flagOpts = POOL_FLAGS[pool];

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <PageHeader
        eyebrowIcon={<Layers className="h-5 w-5" />}
        title="Lead Manager"
        subtitle="Pick a pool, filter it, tap an agent in the drop-down, drop the pack into their portal."
      />

      {/* POOL SWITCH */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {POOLS.map((p) => {
          const on = pool === p.key;
          const Icon = p.icon;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setPool(p.key)}
              aria-pressed={on}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition-colors",
                on ? "border-primary bg-primary/10" : "border-border/60 bg-card hover:bg-muted/40",
              )}
            >
              <div className="flex w-full items-center justify-between">
                <Icon className={cn("h-4 w-4", on ? "text-primary" : "text-muted-foreground")} />
                <span className="text-lg font-bold tabular-nums">
                  {totals[p.key]?.total.toLocaleString() ?? "—"}
                </span>
              </div>
              <span className="text-sm font-medium">{p.label}</span>
              <span className="text-xs text-muted-foreground">{p.blurb}</span>
              {totals[p.key] && Object.keys(totals[p.key].by_tier).length > 0 && (
                <span className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] tabular-nums text-muted-foreground">
                  {["S", "A", "B", "C", "D"].filter((t) => (totals[p.key].by_tier[t] ?? 0) > 0).map((t) => (
                    <span key={t}>
                      <span className="font-semibold text-foreground/80">{t}</span> {totals[p.key].by_tier[t].toLocaleString()}
                    </span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* FILTER + PREVIEW */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filter the {POOLS.find((p) => p.key === pool)?.label} pool</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Tier</Label>
            <div className="flex flex-wrap gap-2">
              {tierOpts.map((t) => {
                const on = tiers.has(t.v);
                return (
                  <Button key={t.v} type="button" size="sm" variant={on ? "default" : "outline"} className="rounded-full"
                    onClick={() => setTiers((prev) => { const n = new Set(prev); n.has(t.v) ? n.delete(t.v) : n.add(t.v); return n; })}>
                    {t.label}
                    {counts?.by_tier?.[t.v] != null && <span className="ml-1.5 text-xs opacity-70">{counts.by_tier[t.v]}</span>}
                  </Button>
                );
              })}
            </div>
          </div>

          {flagOpts.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Must have</Label>
              <div className="flex flex-wrap gap-2">
                {flagOpts.map((f) => {
                  const on = flags.has(f.key);
                  return (
                    <Button key={f.key} type="button" size="sm" variant={on ? "default" : "outline"} className="rounded-full"
                      onClick={() => setFlags((prev) => { const n = new Set(prev); n.has(f.key) ? n.delete(f.key) : n.add(f.key); return n; })}>
                      {f.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {pool === "marketing" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">States (TX, FL)</Label>
                  <Input value={states} onChange={(e) => setStates(e.target.value)} placeholder="All states" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Min age</Label>
                  <Input type="number" inputMode="numeric" value={minAge} onChange={(e) => setMinAge(e.target.value)} placeholder="—" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Max age</Label>
                  <Input type="number" inputMode="numeric" value={maxAge} onChange={(e) => setMaxAge(e.target.value)} placeholder="—" />
                </div>
              </>
            )}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Sort</Label>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger aria-label="Sort order"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tier">Best tier first</SelectItem>
                  <SelectItem value="chargeback">Chargeback window first</SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {pool === "winback" && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={vantageOnly} onCheckedChange={(v) => setVantageOnly(Boolean(v))} />
                Vantage only
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={excludeDnc} onCheckedChange={(v) => setExcludeDnc(Boolean(v))} />
              Hold back Do-Not-Call
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={excludeResold} onCheckedChange={(v) => setExcludeResold(Boolean(v))} />
              Hold back already-sold
            </label>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Pack size</span>
              <Input type="number" inputMode="numeric" value={limit}
                onChange={(e) => setLimit(Math.max(1, Math.min(5000, Number(e.target.value) || 1)))}
                className="h-9 w-24" aria-label="Pack size" />
            </div>
          </div>

          {/* STAT TILES */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label="Ready to drop" value={isFetching ? "…" : (counts?.total ?? 0).toLocaleString()} accent />
            <StatTile label="Under 9 months" value={(counts?.under_9mo ?? 0).toLocaleString()} warn={!!counts?.under_9mo} />
            <StatTile label="Held: Do-Not-Call" value={(counts?.dnc_excluded ?? 0).toLocaleString()} />
            <StatTile label="Held: already sold" value={(counts?.resold_excluded ?? 0).toLocaleString()} />
          </div>

          {(counts?.sample?.length ?? 0) > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Phone</th>
                    <th className="px-3 py-2 text-left">Tier</th>
                    <th className="px-3 py-2 text-left">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {(counts?.sample ?? []).slice(0, 12).map((s, i) => (
                    <tr key={`${s.phone_masked}-${i}`} className="border-t border-border/40">
                      <td className="px-3 py-1.5">
                        {[s.first_name, s.last_name].filter(Boolean).join(" ") || "—"}
                        {(s.state || s.age) && <span className="ml-1 text-xs text-muted-foreground">{[s.state, s.age].filter(Boolean).join(" · ")}</span>}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">{s.phone_masked}</td>
                      <td className="px-3 py-1.5">
                        <Badge variant="outline" className={TIER_STYLE[s.tier] ?? TIER_STYLE.C}>{s.tier}</Badge>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {flagBadges(s.flags, s.under_9mo).slice(0, 4).map((b) => (
                            <Badge key={b.key} variant="outline" className={cn("text-[10px]", b.cls)}>{b.label}</Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-1.5 text-xs text-muted-foreground">Preview of the first matches. Phones are masked until dropped.</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* DROP TO AGENT */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Drop into an agent's portal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <AgentDropdown
              agents={agents}
              degraded={agentsRoster.degraded}
              isLoading={agentsRoster.isLoading}
              selectedId={agent?.user_id ?? null}
              onPick={(a) => setAgent(agent?.user_id === a.user_id ? null : a)}
              placeholder="Pick an agent…"
            />
            {agent && (
              <Button type="button" size="icon" variant="ghost" className="h-11 w-9 shrink-0"
                onClick={() => setAgent(null)} aria-label="Clear picked agent">
                <X className="h-4 w-4" />
              </Button>
            )}
            <Button type="button" size="icon" variant="ghost" className="h-11 w-9 shrink-0" onClick={refreshAgents}
              disabled={agentsRoster.isFetching} aria-label="Refresh agent list" title="Refresh agent list">
              <RotateCcw className={cn("h-4 w-4", agentsRoster.isFetching && "animate-spin")} />
            </Button>
          </div>

          {agents.length === 0 && !agentsRoster.isLoading && (
            // Only reachable on a cold cache + hard failure; the roster query
            // keeps retrying itself every 20s while this shows.
            <div className="flex flex-wrap items-center gap-2 text-sm text-red-400">
              <AlertTriangle className="h-4 w-4 shrink-0" /> Couldn't load agents — retrying automatically.
              <Button type="button" size="sm" variant="outline" onClick={refreshAgents}>Refresh now</Button>
              <Button type="button" size="sm" variant="ghost" onClick={goLogin}>Log in again</Button>
              <Button type="button" size="sm" variant="ghost" onClick={hardReset}>Reload fresh</Button>
            </div>
          )}

          <Input placeholder="Optional note (shown with the pack)" value={note}
            onChange={(e) => setNote(e.target.value)} className="max-w-md" aria-label="Pack note" />

          <Button type="button" data-primary-action size="lg"
            disabled={!agent || dropCount < 1 || assign.isPending}
            onClick={() => assign.mutate()}>
            <Send className="mr-1.5 h-4 w-4" />
            {assign.isPending ? "Dropping…"
              : agent ? `Drop ${dropCount.toLocaleString()} into ${agent.display_name}'s portal`
                : "Tap an agent above"}
          </Button>
        </CardContent>
      </Card>

      {/* CLOSERS LEADERBOARD */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="h-4 w-4 text-primary" /> Top closers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {closers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No closes yet. Drop some packs and the leaderboard lights up as agents sell.</p>
          ) : (
            <div className="space-y-1.5">
              {closers.slice(0, 10).map((c, i) => (
                <div key={c.user_id} className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2">
                  <span className={cn("w-6 text-center text-sm font-bold tabular-nums",
                    i === 0 ? "text-primary" : "text-muted-foreground")}>{i + 1}</span>
                  <span className="flex-1 truncate text-sm font-medium">{c.display_name ?? "Agent"}</span>
                  <span className="text-xs text-muted-foreground">{c.worked}/{c.dropped} worked</span>
                  {c.recorded > 0 && <Badge variant="outline" className="text-[10px]"><Phone className="mr-1 h-3 w-3" />{c.recorded}</Badge>}
                  <Badge variant="outline" className="bg-green-600/15 border-green-600/40 text-green-300">{c.sold} sold</Badge>
                  {c.sold_rate != null && <span className="w-12 text-right text-xs font-semibold text-primary">{c.sold_rate}%</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* RECENT DROPS */}
      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold"><ClipboardList className="h-4 w-4" /> Recent drops</h2>
        {recent.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Nothing dropped yet. Build a pack above and it shows up here.</CardContent></Card>
        ) : (
          recent.map((b) => (
            <Card key={b.bundle_id} className={cn(b.archived_at && "opacity-60")}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{b.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{b.live_items} live</span>
                      {/* The question this line answers: is the pack being worked? */}
                      {b.live_items > 0 && (
                        b.worked > 0 ? (
                          <span className="text-green-400">{b.worked}/{b.live_items} worked</span>
                        ) : b.archived_at ? null : (
                          <span className="text-amber-400">untouched</span>
                        )
                      )}
                      {b.last_worked_at && <span>last touch {formatTimeAgo(b.last_worked_at)}</span>}
                      {b.sold > 0 && <span className="text-green-400">{b.sold} sold</span>}
                      {b.under_9mo > 0 && <span className="text-amber-400">{b.under_9mo} under-9mo</span>}
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <UsersIcon className="h-3 w-3" />
                        {b.holders.length === 0 ? "unassigned"
                          : b.holders.map((h) => `${h.name ?? "agent"} ${h.worked}/${b.live_items}`).join(", ")}
                      </span>
                      <span>·</span>
                      <span>{new Date(b.created_at).toLocaleDateString()}</span>
                      {b.resold && <Badge variant="outline" className="bg-green-600/15 border-green-600/40 text-green-300">sold</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button type="button" size="sm" variant="outline" onClick={() => exportPack(b)}><Download className="mr-1 h-4 w-4" /> Pack</Button>
                    <MarkSoldDialog bundle={b} onDone={() => {
                      queryClient.invalidateQueries({ queryKey: ["lead-bundles-recent"] });
                      queryClient.invalidateQueries({ queryKey: ["lead-pool"] });
                      queryClient.invalidateQueries({ queryKey: ["lead-closers"] });
                    }} />
                    {!b.archived_at && (
                      <Button type="button" size="sm" variant="ghost" aria-label="Archive pack" onClick={() => archive.mutate(b.bundle_id)}><Archive className="h-4 w-4" /></Button>
                    )}
                  </div>
                </div>
                <BundleManage bundle={b} onChange={() => {
                  queryClient.invalidateQueries({ queryKey: ["lead-bundles-recent"] });
                  queryClient.invalidateQueries({ queryKey: ["lead-pool"] });
                }} />
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function StatTile({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-3", accent ? "border-primary/40 bg-primary/5" : "border-border/60 bg-muted/20")}>
      <div className={cn("text-xl font-bold tabular-nums", warn && "text-amber-400", accent && "text-primary")}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function MarkSoldDialog({ bundle, onDone }: { bundle: RecentBundle; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [buyer, setBuyer] = useState("");
  const [price, setPrice] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    try {
      const { data, error } = await rpc("lead_bundle_mark_sold", {
        p_bundle: bundle.bundle_id, p_sold_to: buyer.trim() || null,
        p_price_cents: price ? Math.round(Number(price) * 100) : null, p_note: null,
      });
      if (error) throw error;
      const res = data as { newly_ledgered: number };
      toast.success(`Marked sold — ${res.newly_ledgered} leads locked from resale`);
      setOpen(false); setBuyer(""); setPrice(""); onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mark sold");
    } finally { setPending(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline"><DollarSign className="mr-1 h-4 w-4" /> Sold</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Mark "{bundle.name}" sold</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Every lead in this pack gets locked in the resale ledger so it can never go out again.</p>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Sold to (optional)</Label>
            <Input value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="Buyer name" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Price (optional)</Label>
            <Input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" data-primary-action disabled={pending} onClick={submit}>{pending ? "Saving…" : "Lock as sold"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ManageItem = {
  item_id: string; name: string | null; phone_masked: string;
  tier: string | null; status: string; tags: string | null; has_recording: boolean;
};

// A wedged client (stale service worker, or a network flap that left React Query
// serving a cached-empty roster) is cured by a clean reboot: drop every service
// worker and cache, then reload. Offered in the picker's empty/error states so an
// operator is never stuck staring at zero agents with no way out but a manual
// hard-refresh they shouldn't have to know to perform.
async function hardReset() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.allSettled(keys.map((k) => caches.delete(k)));
    }
  } finally {
    window.location.reload();
  }
}

function BundleManage({ bundle, onChange }: { bundle: RecentBundle; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ManageItem[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadItems() {
    const { data, error } = await rpc("lead_bundle_items_manage", { p_bundle: bundle.bundle_id });
    if (!error) setItems((data as ManageItem[]) ?? []);
  }
  function toggle() { const n = !open; setOpen(n); if (n && items === null) void loadItems(); }

  // Same shared always-alive roster as the main picker (one query key, one cache,
  // one self-heal) — rendered through the same AgentDropdown; picking a name
  // grants immediately.
  const { roster, degraded } = useAgentRoster();
  const holderIds = new Set(bundle.holders.map((h) => h.user_id));
  const candidates = roster.filter((a) => !holderIds.has(a.user_id));

  async function grant(a: AssignableAgent) {
    setBusy(true);
    try {
      const { error } = await rpc("lead_bundle_grant", { p_bundle: bundle.bundle_id, p_user: a.user_id, p_note: null });
      if (error) throw error;
      toast.success(`Also dropped to ${a.display_name}`); onChange();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not grant"); } finally { setBusy(false); }
  }
  async function revoke(userId: string, name: string | null) {
    setBusy(true);
    try {
      const { error } = await rpc("lead_bundle_revoke", { p_bundle: bundle.bundle_id, p_user: userId });
      if (error) throw error;
      toast.success(`Took back from ${name ?? "agent"}`); onChange();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not take back"); } finally { setBusy(false); }
  }
  async function removeItem(itemId: string) {
    setBusy(true);
    try {
      const { error } = await rpc("lead_bundle_remove_item", { p_item: itemId });
      if (error) throw error;
      await loadItems(); onChange();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not remove"); } finally { setBusy(false); }
  }

  return (
    <div>
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={toggle}>
        {open ? "Hide manage" : "Manage access & leads"}
      </Button>
      {open && (
        <div className="mt-2 space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Who has this pack</Label>
            <div className="flex flex-wrap gap-1.5">
              {bundle.holders.length === 0 && <span className="text-xs text-muted-foreground">No one yet.</span>}
              {bundle.holders.map((h) => (
                <Badge key={h.user_id} variant="outline" className="gap-1 py-1">
                  {h.name ?? "agent"}
                  <button type="button" disabled={busy} onClick={() => revoke(h.user_id, h.name)}
                    aria-label={`Take back from ${h.name ?? "agent"}`} className="ml-0.5 text-muted-foreground hover:text-rose-400">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Give to another agent</Label>
              {candidates.length === 0 && roster.length > 0 ? (
                <p className="text-xs text-muted-foreground">Everyone already has this pack.</p>
              ) : (
                <AgentDropdown
                  agents={candidates}
                  degraded={degraded}
                  isLoading={roster.length === 0}
                  selectedId={null}
                  onPick={(a) => void grant(a)}
                  placeholder="Add an agent to this pack…"
                  disabled={busy}
                  widthClass="w-full sm:w-72"
                />
              )}
              {roster.length === 0 && (
                <span className="flex items-center gap-1.5 text-xs text-amber-400">
                  <AlertTriangle className="h-3 w-3" /> Loading agents — retrying automatically.
                  <button type="button" className="underline hover:text-amber-300" onClick={hardReset}>Reload fresh</button>
                </span>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Leads in this pack</Label>
            {items === null ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-xs text-muted-foreground">Empty.</p>
            ) : (
              <div className="max-h-60 overflow-y-auto rounded border border-border/50">
                {items.map((it) => (
                  <div key={it.item_id} className="flex items-center gap-2 border-b border-border/40 px-2 py-1 text-xs last:border-0">
                    <span className="flex-1 truncate">{it.name ?? "—"} <span className="font-mono text-muted-foreground">{it.phone_masked}</span></span>
                    <Badge variant="outline" className={cn("text-[10px]", TIER_STYLE[it.tier ?? "C"] ?? TIER_STYLE.C)}>{it.tier}</Badge>
                    <span className="text-muted-foreground">{it.status}</span>
                    {it.has_recording && <Phone className="h-3 w-3 text-green-400" />}
                    <button type="button" disabled={busy} onClick={() => removeItem(it.item_id)} aria-label="Remove lead from pack" className="text-muted-foreground hover:text-rose-400"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
