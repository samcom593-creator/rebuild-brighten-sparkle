// MP-264 — Book of Business rebuild (2026-07-09)
// Sam brief verbatim: Every policy record across the agency. Synced from AgentLink.
// - Preserves v_agentlink_book_truth as source of truth for authoritative KPIs
// - Preserves agentlink_deals_snapshot as row source (1,286+ real policies, 30-min sync)
// - Preserves deals-table chargeback join for Chargeback Watch drawer
// - Consumes existing foundation: apexTokens (tone), AgentNameLink, Sheet, KebabMenu
// - Never touches Apply.tsx / /apply route
import { useCallback, useEffect, useMemo, useState } from "react";
import { format, formatDistanceToNowStrict, subDays } from "date-fns";
import {
  Book,
  Search,
  RefreshCw,
  AlertTriangle,
  Eye,
  TrendingDown,
  TrendingUp,
  Award,
  DollarSign,
  Shield,
  MoreVertical,
  ExternalLink,
  Filter,
  Download,
  X,
  CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/shared/lib/logger";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { AgentLinkConnectionPrompt } from "@/components/dashboard/AgentLinkConnectionPrompt";
import { AgentNameLink } from "@/components/dashboard/AgentNameLink";
import { toast } from "@/hooks/use-toast";

// ─── Types ──────────────────────────────────────────────────────────────────

interface DealRow {
  id: string;
  agent_id: string | null;
  agentlink_user_id?: number | null;
  application_id?: string | null;
  client_first_name: string | null;
  client_last_name: string | null;
  policy_number: string | null;
  product_sold: string | null;
  monthly_premium: number | null;
  annual_premium: number | null;
  effective_date: string | null;
  posted_at: string | null;
  pipeline_stage: string | null;
  policy_status_standard: string | null;
  status_updated_at: string | null;
  synced_to_insuracloud_at: string | null;
  external_deal_id: string | null;
  insuracloud_sync_error: string | null;
  source: string | null;
  status: string | null;
  carrier_id: string | null;
  pipeline_client_id?: number | null;
  created_at: string;
  agent_name?: string;
  carrier_name?: string;
}

// Full client profile loaded on demand from agentlink_clients via
// pipeline_client_id. Shows the banking / financial / health fields the
// agent needs to actually service the policy.
type ClientFullRow = Record<string, unknown> & {
  insuracloud_pipeline_client_id?: number;
};

interface ContactLogRow {
  id: string;
  channel: string | null;
  outcome: string | null;
  notes: string | null;
  logged_at: string | null;
  logged_by: string | null;
}

interface BookPersistencyRow {
  carrier: string;
  in_force: number | string | null;
  lapsed: number | string | null;
  in_force_alp: number | string | null;
  persistency_pct: number | string | null;
}

interface BookConcentrationRow {
  dimension: string;
  name: string;
  in_force_policies: number | string | null;
  in_force_alp: number | string | null;
  pct_of_in_force_alp: number | string | null;
}

interface BookSegmentRow {
  segment: string;
  policies: number | null;
  annual_premium: number | null;
  policies_30d: number | null;
  producers: number | null;
}

interface BookTruthRow {
  total_deals: number | null;
  total_annual_premium: number | null;
  deals_today: number | null;
  premium_today: number | null;
  deals_this_week: number | null;
  premium_this_week: number | null;
  deals_this_month: number | null;
  premium_this_month: number | null;
  last_synced_at: string | null;
}

interface ChargebackRow {
  id: string;
  client_first_name: string | null;
  client_last_name: string | null;
  agent_id: string | null;
  agent_name?: string;
  carrier_name?: string;
  policy_number: string | null;
  monthly_premium: number | null;
  annual_premium: number | null;
  status_updated_at: string | null;
  posted_at: string | null;
}

type SortMode =
  | "newest_posted"
  | "highest_premium"
  | "chargeback_risk"
  | "by_agent"
  | "by_carrier";

// ─── Constants ──────────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  submitted: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  active: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  approved: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  in_force: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  paid: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  lapsed: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  cancelled: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  charged_back: "bg-red-500/20 text-red-300 border-red-500/40",
  pending: "bg-sky-500/20 text-sky-300 border-sky-500/40",
};

// User-facing label for a stage key. Keeps the badges/dropdown consistent
// regardless of whether the upstream row shipped "Active" / "active" / "IN FORCE".
const STAGE_LABEL: Record<string, string> = {
  submitted: "Submitted",
  active: "Active",
  approved: "Approved",
  in_force: "In Force",
  paid: "Paid",
  lapsed: "Lapsed",
  cancelled: "Cancelled",
  charged_back: "Chargeback",
  pending: "Pending",
};

function titleCaseStageKey(key: string): string {
  if (!key) return "";
  return key
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .join(" ");
}

const CHARGEBACK_WINDOW_DAYS = 30;
const PREMIUM_SLIDER_MAX = 5000;
// Client-side cap on rows pulled from agentlink_deals_snapshot per fetch.
// The DB count is fetched separately via {count:"exact"} so the footer can
// tell the user when the returned slice is smaller than the real book.
const AGENTLINK_SNAPSHOT_ROW_CAP = 5_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt$(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function formatCurrency(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function sourceKey(source?: string | null): "apex" | "agent_link" {
  return source === "agent_link" ||
    source === "agentlink" ||
    source === "insuracloud"
    ? "agent_link"
    : "apex";
}

function pipelineLabel(deal: DealRow): string {
  return (
    deal.policy_status_standard ||
    deal.pipeline_stage ||
    deal.status ||
    "submitted"
  );
}

// Normalized key used for filter compare + STAGE_COLORS lookup.
// AgentLink raw_status ships human-cased ("Active" / "In Force" / "Charged Back")
// so without normalization the Stage <Select> exact-match returned zero rows
// and status badges fell back to gray "muted" on the primary data source.
function pipelineStageKey(deal: DealRow): string {
  return pipelineLabel(deal).toLowerCase().trim().replace(/\s+/g, "_");
}

function stageDisplayLabel(deal: DealRow): string {
  const key = pipelineStageKey(deal);
  return STAGE_LABEL[key] ?? titleCaseStageKey(key) ?? pipelineLabel(deal);
}

// Chargeback-window heuristic: a policy is inside its live chargeback risk
// window when the effective_date is within the last CHARGEBACK_WINDOW_DAYS.
// Insurance chargeback cliffs are typically the first 30 days after issue.
function daysSinceEffective(deal: DealRow): number | null {
  if (!deal.effective_date) return null;
  const t = Date.parse(deal.effective_date);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
}

function isInChargebackWindow(deal: DealRow): boolean {
  const d = daysSinceEffective(deal);
  if (d == null) return false;
  return d >= 0 && d <= CHARGEBACK_WINDOW_DAYS;
}

function chargebackRisk(deal: DealRow): number {
  const d = daysSinceEffective(deal);
  if (d == null || d < 0 || d > CHARGEBACK_WINDOW_DAYS) return 0;
  // Higher risk closer to effective date.
  const proximity = 1 - d / CHARGEBACK_WINDOW_DAYS;
  const premium = Number(deal.annual_premium ?? 0);
  return proximity * premium;
}

function isActivePolicy(deal: DealRow): boolean {
  const stage = pipelineStageKey(deal);
  if (
    stage === "cancelled" ||
    stage === "lapsed" ||
    stage === "charged_back" ||
    stage === "draft" ||
    stage === "submitted"
  )
    return false;
  return true;
}

// AgentLink snapshot rows set posted_at = snapshot_at (sync clock), so every
// row would render the same "X ago" and the "Newest Posted" sort collapses to
// a near no-op. effective_date is the real business date on both sources; fall
// back to posted_at/created_at only when effective_date is missing, and mark
// that case so the UI can say "Synced" instead of pretending it's a post time.
function pickPostedTs(
  deal: Pick<DealRow, "effective_date" | "posted_at" | "created_at">,
): { ts: string | null; isFallback: boolean } {
  if (deal.effective_date) return { ts: deal.effective_date, isFallback: false };
  const fallback = deal.posted_at ?? deal.created_at ?? null;
  return { ts: fallback, isFallback: Boolean(fallback) };
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function BookOfBusiness() {
  const { user, isAdmin, isManager } = useAuth();
  const [deals, setDeals] = useState<DealRow[]>([]);
  // Real DB row count for the current scope (from .select count:"exact"),
  // NOT the length of the (potentially .limit-capped) returned rows.
  // Footer "Showing X of Y" reads from this so it stops lying when the cap
  // is hit — e.g. Total Deals 1,558 vs "Showing 1,000 of 1,000".
  const [dealsSourceCount, setDealsSourceCount] = useState<number | null>(null);
  const [truth, setTruth] = useState<BookTruthRow | null>(null);
  // MP-268: the headline ALP blends submitted + declined + withdrawn + lapsed
  // into one number. v_book_status_segments splits it so the in-force (actually
  // paying) book is never confused with business that has not adjudicated.
  const [segments, setSegments] = useState<BookSegmentRow[] | null>(null);
  const [persistency, setPersistency] = useState<BookPersistencyRow[] | null>(null);
  const [concentration, setConcentration] = useState<BookConcentrationRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentScopeIds, setAgentScopeIds] = useState<string[] | null>(null);
  const [agentLinkScopeUserIds, setAgentLinkScopeUserIds] = useState<
    number[] | null
  >(null);
  const [selectedDeal, setSelectedDeal] = useState<DealRow | null>(null);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());

  // Filters
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [policyFilter, setPolicyFilter] = useState("");
  const [carrierFilter, setCarrierFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [sourceFilter, setSource] = useState<"all" | "apex" | "agent_link">(
    "all",
  );
  const [stageFilter, setStage] = useState<string>("all");
  const [postedSince, setPostedSince] = useState<string>("");
  const [postedUntil, setPostedUntil] = useState<string>("");
  const [premiumRange, setPremiumRange] = useState<[number, number]>([
    0,
    PREMIUM_SLIDER_MAX,
  ]);

  // Sort
  const [sortMode, setSortMode] = useState<SortMode>("newest_posted");

  // Chargeback Watch drawer
  const [chargebackOpen, setChargebackOpen] = useState(false);
  const [cbSince, setCbSince] = useState<string>(() =>
    format(subDays(new Date(), 30), "yyyy-MM-dd"),
  );
  const [cbUntil, setCbUntil] = useState<string>(() =>
    format(new Date(), "yyyy-MM-dd"),
  );
  const [chargebacks, setChargebacks] = useState<ChargebackRow[]>([]);
  const [cbLoading, setCbLoading] = useState(false);

  // ─── Scope resolution ────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id) {
        setAgentScopeIds([]);
        setAgentLinkScopeUserIds([]);
        return;
      }
      if (isAdmin) {
        setAgentScopeIds(null);
        setAgentLinkScopeUserIds(null);
        return;
      }
      const { data: userAgents } = await supabase
        .from("agents")
        .select("id, al_user_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (!userAgents?.length) {
        setAgentScopeIds([]);
        setAgentLinkScopeUserIds([]);
        return;
      }
      const ids = new Set<string>(
        userAgents.map((agent) => agent.id).filter(Boolean),
      );
      if (isManager) {
        const { data: downline } = await supabase.rpc(
          "my_downline_agent_ids" as any,
        );
        for (const row of (downline as any[]) ?? []) {
          if (row.agent_id) ids.add(row.agent_id);
        }
      }

      const scopedAgentIds = Array.from(ids);
      const { data: scopedAgents } = scopedAgentIds.length
        ? await supabase
            .from("agents")
            .select("id, al_user_id")
            .in("id", scopedAgentIds)
        : { data: [] as Array<{ id: string; al_user_id: number | null }> };
      const alUserIds = [
        ...new Set(
          ((scopedAgents ?? []) as any[])
            .map((agent) => agent.al_user_id)
            .filter((id): id is number => typeof id === "number"),
        ),
      ];

      setAgentScopeIds(scopedAgentIds);
      setAgentLinkScopeUserIds(alUserIds);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, isAdmin, isManager]);

  // ─── Load deals + book truth ─────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Preserve v_agentlink_book_truth as authoritative KPI source.
      const { data: truthRows, error: truthErr } = await supabase
        .from("v_agentlink_book_truth" as any)
        .select(
          "total_deals, total_annual_premium, deals_today, premium_today, deals_this_week, premium_this_week, deals_this_month, premium_this_month, last_synced_at",
        )
        .maybeSingle();
      if (truthErr) {
        logger.warn("[BookOfBusiness] v_agentlink_book_truth read failed", {
          error: truthErr.message,
        });
      }
      setTruth((truthRows as unknown as BookTruthRow) ?? null);

      const { data: segRows, error: segErr } = await supabase
        .from("v_book_status_segments" as any)
        .select("segment, policies, annual_premium, policies_30d, producers");
      if (segErr) {
        logger.warn("[BookOfBusiness] v_book_status_segments read failed", {
          error: segErr.message,
        });
        setSegments(null);
      } else {
        setSegments((segRows as unknown as BookSegmentRow[]) ?? null);
      }

      const { data: persRows, error: persErr } = await supabase
        .from("v_book_persistency" as any)
        .select("carrier, in_force, lapsed, in_force_alp, persistency_pct");
      if (persErr) {
        logger.warn("[BookOfBusiness] v_book_persistency read failed", {
          error: persErr.message,
        });
        setPersistency(null);
      } else {
        setPersistency((persRows as unknown as BookPersistencyRow[]) ?? null);
      }

      const { data: concRows, error: concErr } = await supabase
        .from("v_book_concentration" as any)
        .select("dimension, name, in_force_policies, in_force_alp, pct_of_in_force_alp")
        .eq("dimension", "carrier");
      if (concErr) {
        logger.warn("[BookOfBusiness] v_book_concentration read failed", {
          error: concErr.message,
        });
        setConcentration(null);
      } else {
        setConcentration((concRows as unknown as BookConcentrationRow[]) ?? null);
      }

      if (
        !isAdmin &&
        agentScopeIds !== null &&
        agentScopeIds.length === 0 &&
        agentLinkScopeUserIds !== null &&
        agentLinkScopeUserIds.length === 0
      ) {
        setDeals([]);
        setDealsSourceCount(0);
        return;
      }

      let alQuery = supabase
        .from("agentlink_deals_snapshot" as any)
        .select(
          "id, user_id, pipeline_client_id, client_first_name, client_last_name, policy_number, product_sold, monthly_premium, annual_premium, effective_date, raw_status, carrier_id, snapshot_at",
          { count: "exact" },
        )
        .order("effective_date", { ascending: false, nullsFirst: false })
        .limit(AGENTLINK_SNAPSHOT_ROW_CAP);


      if (!isAdmin && agentLinkScopeUserIds !== null) {
        if (agentLinkScopeUserIds.length === 0) {
          alQuery = alQuery.in("user_id", [-1]);
        } else {
          alQuery = alQuery.in("user_id", agentLinkScopeUserIds);
        }
      }

      const { data: alSnapshot, count: alCount, error: alError } = await alQuery;
      if (alError)
        console.error(
          "[BookOfBusiness] AgentLink snapshot fetch failed:",
          alError,
        );
      // Persist DB truth (survives .limit cap) so the footer stops lying.
      setDealsSourceCount(typeof alCount === "number" ? alCount : null);

      const alRawRows = ((alSnapshot ?? []) as Array<Record<string, unknown>>)
        .filter((r) => r.policy_number);

      const alUserIds = [
        ...new Set(
          alRawRows
            .map((r) => Number(r.user_id))
            .filter((id) => Number.isFinite(id)),
        ),
      ];
      const alCarrierIds = [
        ...new Set(
          alRawRows
            .map((r) => (r.carrier_id != null ? String(r.carrier_id) : null))
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      const [{ data: agentsByAl }, { data: alCarriers }] = await Promise.all([
        alUserIds.length
          ? supabase
              .from("agents")
              .select(
                "id, display_name, al_user_id, profile:profiles(full_name)",
              )
              .in("al_user_id", alUserIds)
          : Promise.resolve({ data: [] } as any),
        alCarrierIds.length
          ? supabase
              .from("carriers")
              .select("id, name")
              .in("id", alCarrierIds)
          : Promise.resolve({ data: [] } as any),
      ]);

      const agentByAlUserId = new Map<number, any>();
      for (const agent of ((agentsByAl ?? []) as any[])) {
        if (typeof agent.al_user_id === "number")
          agentByAlUserId.set(agent.al_user_id, agent);
      }
      const alCarrierMap: Record<string, string> = {};
      for (const carrier of ((alCarriers ?? []) as any[]))
        alCarrierMap[String(carrier.id)] = carrier.name;

      const alRows: DealRow[] = alRawRows.map((r) => {
        const agentlinkUserId = Number(r.user_id);
        const mappedAgent = Number.isFinite(agentlinkUserId)
          ? agentByAlUserId.get(agentlinkUserId)
          : null;
        const carrierId =
          r.carrier_id != null ? String(r.carrier_id) : null;
        return {
          id: `al-${String(r.id ?? "")}`,
          agent_id: mappedAgent?.id ?? null,
          agentlink_user_id: Number.isFinite(agentlinkUserId)
            ? agentlinkUserId
            : null,
          application_id: null,
          client_first_name: String(r.client_first_name ?? ""),
          client_last_name: String(r.client_last_name ?? ""),
          policy_number: String(r.policy_number ?? ""),
          product_sold: r.product_sold ? String(r.product_sold) : null,
          monthly_premium:
            r.monthly_premium != null ? Number(r.monthly_premium) : null,
          annual_premium:
            r.annual_premium != null ? Number(r.annual_premium) : null,
          effective_date: r.effective_date ? String(r.effective_date) : null,
          posted_at: r.snapshot_at ? String(r.snapshot_at) : null,
          pipeline_stage: null,
          policy_status_standard: r.raw_status ? String(r.raw_status) : null,
          status_updated_at: null,
          synced_to_insuracloud_at: null,
          external_deal_id: null,
          insuracloud_sync_error: null,
          source: "agentlink",
          status: "active",
          carrier_id: carrierId,
          pipeline_client_id:
            r.pipeline_client_id != null ? Number(r.pipeline_client_id) : null,
          created_at: r.snapshot_at
            ? String(r.snapshot_at)
            : new Date().toISOString(),
          agent_name:
            mappedAgent?.profile?.full_name ??
            mappedAgent?.display_name ??
            (Number.isFinite(agentlinkUserId)
              ? `AgentLink user #${agentlinkUserId}`
              : "Unmatched AgentLink agent"),
          carrier_name: carrierId ? (alCarrierMap[carrierId] ?? "") : "",
        } as DealRow;
      });

      const rows = alRows;
      logger.info("[BookOfBusiness] loaded deals", {
        agentLinkRows: alRows.length,
        agentLinkSnapshotCount: alCount,
        totalRows: rows.length,
        scope: isAdmin ? "admin" : "scoped",
      });

      // Resolve agent + carrier names in one batch
      const agentIds = [
        ...new Set(rows.map((r) => r.agent_id).filter(Boolean)),
      ];
      const carrierIds = [
        ...new Set(
          rows
            .map((r) => r.carrier_id)
            .filter((v): v is string => Boolean(v)),
        ),
      ];

      const [{ data: agents }, { data: carriers }] = await Promise.all([
        agentIds.length
          ? supabase
              .from("agents")
              .select("id, display_name, profile:profiles(full_name)")
              .in("id", agentIds)
          : Promise.resolve({ data: [] } as any),
        carrierIds.length
          ? supabase.from("carriers").select("id, name").in("id", carrierIds)
          : Promise.resolve({ data: [] } as any),
      ]);

      const agentMap: Record<string, string> = {};
      for (const a of (agents ?? []) as any[])
        agentMap[a.id] =
          a.profile?.full_name ?? a.display_name ?? "Unmatched agent";
      const carrierMap: Record<string, string> = {};
      for (const c of (carriers ?? []) as any[]) carrierMap[c.id] = c.name;

      setDeals(
        rows.map((r) => ({
          ...r,
          agent_name:
            r.agent_name ??
            (r.agent_id
              ? (agentMap[r.agent_id] ?? "Agent")
              : r.agentlink_user_id
                ? `AgentLink user #${r.agentlink_user_id}`
                : "Agent"),
          carrier_name:
            r.carrier_name ??
            (r.carrier_id ? (carrierMap[r.carrier_id] ?? "") : ""),
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [agentScopeIds, agentLinkScopeUserIds, isAdmin]);

  useEffect(() => {
    if (isAdmin || (agentScopeIds !== null && agentLinkScopeUserIds !== null))
      load();
  }, [agentScopeIds, agentLinkScopeUserIds, isAdmin, load]);

  // Realtime subscription
  useEffect(() => {
    if (!isAdmin && (agentScopeIds === null || agentLinkScopeUserIds === null))
      return;
    const scopeKey = isAdmin
      ? "admin"
      : (agentScopeIds ?? []).slice().sort().join(",");
    const ch = supabase
      .channel(`bob-${scopeKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agentlink_deals_snapshot",
        },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [agentScopeIds, agentLinkScopeUserIds, isAdmin, load]);

  // ─── Chargeback (historical, deals-table) ────────────────────────────────

  const loadChargebacks = useCallback(async () => {
    if (!isAdmin && agentScopeIds !== null && agentScopeIds.length === 0) {
      setChargebacks([]);
      return;
    }
    setCbLoading(true);
    try {
      const startIso = `${cbSince}T00:00:00.000Z`;
      const endIso = `${cbUntil}T23:59:59.999Z`;
      let query = supabase
        .from("deals")
        .select(
          `
          id, agent_id, client_first_name, client_last_name, policy_number,
          monthly_premium, annual_premium, status_updated_at, posted_at,
          carrier_id, policy_status_standard, pipeline_stage, status
        `,
        )
        .or(
          "policy_status_standard.eq.charged_back,pipeline_stage.eq.charged_back,status.eq.charged_back",
        )
        .gte("status_updated_at", startIso)
        .lte("status_updated_at", endIso)
        .neq("status", "draft")
        .order("status_updated_at", { ascending: false })
        .limit(500);
      if (!isAdmin && agentScopeIds !== null) {
        query = query.in("agent_id", agentScopeIds);
      }
      const { data } = await query;
      const rows = (data ?? []) as any[];

      const agentIds = [
        ...new Set(rows.map((r) => r.agent_id).filter(Boolean)),
      ];
      const carrierIds = [
        ...new Set(
          rows
            .map((r) => r.carrier_id)
            .filter((v: any): v is string => Boolean(v)),
        ),
      ];
      const [{ data: agents }, { data: carriers }] = await Promise.all([
        agentIds.length
          ? supabase
              .from("agents")
              .select("id, display_name, profile:profiles(full_name)")
              .in("id", agentIds)
          : Promise.resolve({ data: [] } as any),
        carrierIds.length
          ? supabase.from("carriers").select("id, name").in("id", carrierIds)
          : Promise.resolve({ data: [] } as any),
      ]);
      const agentMap: Record<string, string> = {};
      for (const a of (agents ?? []) as any[])
        agentMap[a.id] =
          a.profile?.full_name ?? a.display_name ?? "Unmatched";
      const carrierMap: Record<string, string> = {};
      for (const c of (carriers ?? []) as any[]) carrierMap[c.id] = c.name;

      setChargebacks(
        rows.map((r) => ({
          id: r.id,
          client_first_name: r.client_first_name,
          client_last_name: r.client_last_name,
          agent_id: r.agent_id,
          agent_name: agentMap[r.agent_id] ?? "Agent",
          carrier_name: r.carrier_id ? (carrierMap[r.carrier_id] ?? "") : "",
          policy_number: r.policy_number,
          monthly_premium: r.monthly_premium,
          annual_premium: r.annual_premium,
          status_updated_at: r.status_updated_at,
          posted_at: r.posted_at,
        })),
      );
    } finally {
      setCbLoading(false);
    }
  }, [agentScopeIds, isAdmin, cbSince, cbUntil]);

  useEffect(() => {
    if (isAdmin || agentScopeIds !== null) loadChargebacks();
  }, [isAdmin, agentScopeIds, loadChargebacks]);

  const cbTotalALP = useMemo(
    () =>
      chargebacks.reduce((s, c) => s + Number(c.annual_premium ?? 0), 0),
    [chargebacks],
  );
  const cbTotalMonthly = useMemo(
    () =>
      chargebacks.reduce((s, c) => s + Number(c.monthly_premium ?? 0), 0),
    [chargebacks],
  );

  // Any status key actually present in `deals` that isn't already one of the
  // canonical hardcoded Stage <SelectItem>s. Keeps the dropdown from ever
  // offering values the data can't match, and stops it from hiding real
  // AgentLink statuses (e.g. "in_force") that don't fit the canonical 8.
  const stageOptionExtras = useMemo(() => {
    const canonical = new Set([
      "submitted",
      "pending",
      "active",
      "approved",
      "paid",
      "lapsed",
      "cancelled",
      "charged_back",
    ]);
    const seen = new Set<string>();
    for (const d of deals) {
      const k = pipelineStageKey(d);
      if (k && !canonical.has(k)) seen.add(k);
    }
    return Array.from(seen).sort();
  }, [deals]);

  // ─── Filter + sort ───────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const agentQ = agentFilter.trim().toLowerCase();
    const clientQ = clientFilter.trim().toLowerCase();
    const policyQ = policyFilter.trim().toLowerCase();
    const carrierQ = carrierFilter.trim().toLowerCase();
    const productQ = productFilter.trim().toLowerCase();
    const sinceTs = postedSince ? Date.parse(`${postedSince}T00:00:00Z`) : null;
    const untilTs = postedUntil ? Date.parse(`${postedUntil}T23:59:59Z`) : null;
    const [minP, maxP] = premiumRange;

    return deals
      .filter(
        (d) => sourceFilter === "all" || sourceKey(d.source) === sourceFilter,
      )
      .filter(
        (d) => stageFilter === "all" || pipelineStageKey(d) === stageFilter,
      )
      .filter((d) => {
        if (!agentQ) return true;
        return (d.agent_name ?? "").toLowerCase().includes(agentQ);
      })
      .filter((d) => {
        if (!clientQ) return true;
        const name =
          `${d.client_first_name ?? ""} ${d.client_last_name ?? ""}`.toLowerCase();
        return name.includes(clientQ);
      })
      .filter((d) => {
        if (!policyQ) return true;
        return (d.policy_number ?? "").toLowerCase().includes(policyQ);
      })
      .filter((d) => {
        if (!carrierQ) return true;
        return (d.carrier_name ?? "").toLowerCase().includes(carrierQ);
      })
      .filter((d) => {
        if (!productQ) return true;
        return (d.product_sold ?? "").toLowerCase().includes(productQ);
      })
      .filter((d) => {
        if (sinceTs == null && untilTs == null) return true;
        const { ts } = pickPostedTs(d);
        const t = ts ? Date.parse(ts) : NaN;
        if (!Number.isFinite(t)) return false;
        if (sinceTs != null && t < sinceTs) return false;
        if (untilTs != null && t > untilTs) return false;
        return true;
      })
      .filter((d) => {
        const p = Number(d.monthly_premium ?? 0);
        if (p < minP) return false;
        if (maxP < PREMIUM_SLIDER_MAX && p > maxP) return false;
        return true;
      })
      .filter((d) => {
        if (!q) return true;
        const hay = [
          d.agent_name,
          d.client_first_name,
          d.client_last_name,
          d.policy_number,
          d.product_sold,
          d.carrier_name,
          d.external_deal_id,
          d.policy_status_standard,
          d.pipeline_stage,
          d.status,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        switch (sortMode) {
          case "highest_premium":
            return (
              Number(b.annual_premium ?? 0) - Number(a.annual_premium ?? 0)
            );
          case "chargeback_risk":
            return chargebackRisk(b) - chargebackRisk(a);
          case "by_agent":
            return (a.agent_name ?? "").localeCompare(b.agent_name ?? "");
          case "by_carrier":
            return (a.carrier_name ?? "").localeCompare(b.carrier_name ?? "");
          case "newest_posted":
          default: {
            const bt = Date.parse(pickPostedTs(b).ts ?? "");
            const at = Date.parse(pickPostedTs(a).ts ?? "");
            return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
          }
        }
      });
  }, [
    deals,
    search,
    agentFilter,
    clientFilter,
    policyFilter,
    carrierFilter,
    productFilter,
    sourceFilter,
    stageFilter,
    postedSince,
    postedUntil,
    premiumRange,
    sortMode,
  ]);

  // ─── KPI calcs ───────────────────────────────────────────────────────────

  const kpi = useMemo(() => {
    // Non-admin viewers see a `deals` array scoped to their own agent_ids /
    // AgentLink user_ids (see the `.in("user_id", agentLinkScopeUserIds)`
    // branch above). v_agentlink_book_truth is agency-wide with NO viewer
    // scope, so trusting it here would show one agent's ~40 policies under an
    // agency-wide "Total Deals 1,558 / Annual Premium $X.XM" headline while
    // the table beneath renders only their own book. Gate the truth-view
    // fallback behind isAdmin; scoped viewers derive every KPI from `deals`.
    const totalDeals =
      isAdmin && truth?.total_deals != null
        ? Number(truth.total_deals)
        : deals.length;
    const totalALP =
      isAdmin && truth?.total_annual_premium != null
        ? Number(truth.total_annual_premium)
        : deals.reduce((s, d) => s + Number(d.annual_premium ?? 0), 0);
    const totalMonthly = deals.reduce(
      (s, d) => s + Number(d.monthly_premium ?? 0),
      0,
    );
    const avgPerDeal = totalDeals > 0 ? totalALP / totalDeals : 0;
    const activePolicies = deals.filter(isActivePolicy).length;
    const chargebackWatch = deals.filter(isInChargebackWindow).length;
    return {
      totalDeals,
      totalALP,
      totalMonthly,
      avgPerDeal,
      activePolicies,
      chargebackWatch,
    };
  }, [deals, truth, isAdmin]);

  // ─── Filter helpers ──────────────────────────────────────────────────────

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (agentFilter) n++;
    if (clientFilter) n++;
    if (policyFilter) n++;
    if (carrierFilter) n++;
    if (productFilter) n++;
    if (sourceFilter !== "all") n++;
    if (stageFilter !== "all") n++;
    if (postedSince || postedUntil) n++;
    if (premiumRange[0] > 0 || premiumRange[1] < PREMIUM_SLIDER_MAX) n++;
    return n;
  }, [
    agentFilter,
    clientFilter,
    policyFilter,
    carrierFilter,
    productFilter,
    sourceFilter,
    stageFilter,
    postedSince,
    postedUntil,
    premiumRange,
  ]);

  function resetFilters() {
    setSearch("");
    setAgentFilter("");
    setClientFilter("");
    setPolicyFilter("");
    setCarrierFilter("");
    setProductFilter("");
    setSource("all");
    setStage("all");
    setPostedSince("");
    setPostedUntil("");
    setPremiumRange([0, PREMIUM_SLIDER_MAX]);
  }

  function markReviewed(id: string) {
    setReviewedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    toast({
      title: "Marked reviewed",
      description: "Removed from your review queue.",
    });
  }

  function exportCsv() {
    const header = [
      "client",
      "agent",
      "policy",
      "product",
      "carrier",
      "monthly",
      "annual",
      "posted_at",
      "effective_date",
      "stage",
      "source",
    ];
    const escape = (v: string | number | null | undefined) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [
      header.join(","),
      ...filtered.map((d) =>
        [
          `${d.client_first_name ?? ""} ${d.client_last_name ?? ""}`.trim(),
          d.agent_name ?? "",
          d.policy_number ?? "",
          d.product_sold ?? "",
          d.carrier_name ?? "",
          d.monthly_premium ?? "",
          d.annual_premium ?? "",
          d.posted_at ?? d.created_at ?? "",
          d.effective_date ?? "",
          stageDisplayLabel(d),
          sourceKey(d.source) === "apex" ? "APEX" : "AgentLink",
        ]
          .map(escape)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `book-of-business-${format(new Date(), "yyyy-MM-dd")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const openAgentLink = (deal?: DealRow | null) => {
    if (deal?.policy_number) {
      window.open(
        `https://agentlink.insuracloud.ai/book-of-business?q=${encodeURIComponent(deal.policy_number)}`,
        "_blank",
        "noopener,noreferrer",
      );
    } else {
      window.open(
        "https://agentlink.insuracloud.ai/book-of-business",
        "_blank",
        "noopener,noreferrer",
      );
    }
  };

  const syncErrors = useMemo(
    () => filtered.filter((d) => Boolean(d.insuracloud_sync_error)).length,
    [filtered],
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-[1400px] mx-auto">
      <PageHeader
        eyebrow="Production · Book of Business"
        eyebrowIcon={<Book className="h-3 w-3" />}
        title="Book of Business"
        subtitle="Every policy record across the agency. Synced from AgentLink."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw
                className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")}
              />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
            >
              <a
                href="https://agentlink.insuracloud.ai/book-of-business"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Open AgentLink
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => setChargebackOpen(true)}
              className="bg-rose-600 hover:bg-rose-500"
            >
              <TrendingDown className="h-3.5 w-3.5 mr-1.5" />
              Chargeback Watch
              {kpi.chargebackWatch > 0 && (
                <Badge className="ml-2 bg-white/10 text-white border-white/30 tabular-nums">
                  {kpi.chargebackWatch}
                </Badge>
              )}
            </Button>
          </>
        }
      />

      <AgentLinkConnectionPrompt />

      {/* MP-268 — Book truth by status.
          "Annual Premium" above sums EVERY status together, so submitted-but-not-
          adjudicated business, declined/withdrawn policies that never issued, and
          lapsed policies all land in one headline. This strip splits them so the
          in-force (actually paying) book is never mistaken for the total. */}
      {isAdmin && segments && segments.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Book by status</h3>
            <span className="text-xs text-muted-foreground">
              in-force is what is actually paying
            </span>
          </div>
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            {segments.map((seg) => {
              const inForce = seg.segment === "in_force";
              const dead = seg.segment === "never_issued";
              const label =
                seg.segment === "in_force"
                  ? "In force"
                  : seg.segment === "submitted_pipeline"
                    ? "Submitted · pending"
                    : seg.segment === "lapsed"
                      ? "Lapsed"
                      : seg.segment === "never_issued"
                        ? "Never issued"
                        : seg.segment;
              const note =
                seg.segment === "in_force"
                  ? "Active + Issued"
                  : seg.segment === "submitted_pipeline"
                    ? "Not adjudicated yet"
                    : seg.segment === "lapsed"
                      ? "Reached policy, then stopped"
                      : seg.segment === "never_issued"
                        ? "Declined · Withdrawn · Not taken"
                        : "";
              return (
                <div
                  key={seg.segment}
                  className={
                    "rounded-md border p-3 " +
                    (inForce
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : dead
                        ? "border-border bg-muted/30 opacity-80"
                        : "border-border bg-background")
                  }
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {label}
                  </div>
                  <div
                    className={
                      "text-lg font-bold leading-tight " +
                      (inForce ? "text-emerald-500" : "text-foreground")
                    }
                  >
                    {fmt$(Number(seg.annual_premium ?? 0))}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {Number(seg.policies ?? 0).toLocaleString()} policies
                    {seg.producers != null ? ` · ${seg.producers} producers` : ""}
                  </div>
                  {note && (
                    <div className="text-[10px] text-muted-foreground mt-1 leading-snug">
                      {note}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MP-268 — Persistency + carrier concentration.
          Persistency answers "of the policies that actually reached a decision,
          how many are still paying" (in_force / (in_force + lapsed)) — pending
          and never-issued are excluded because they never had the chance to
          lapse. Concentration answers "how much of the paying book sits with one
          carrier", which is the risk that an appointment loss is existential. */}
      {isAdmin && (persistency?.length || concentration?.length) ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {persistency && persistency.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Persistency by carrier</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Still in force, of policies that reached a decision. Pending and
                never-issued excluded.
              </p>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {[...persistency]
                  .sort((a, b) => Number(a.persistency_pct ?? 0) - Number(b.persistency_pct ?? 0))
                  .map((row) => {
                    const pct = Number(row.persistency_pct ?? 0);
                    const overall = row.carrier === "__ALL__";
                    const bad = pct < 50;
                    return (
                      <div
                        key={row.carrier}
                        className={
                          "flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 " +
                          (overall ? "bg-muted/60 font-semibold" : "bg-background")
                        }
                      >
                        <span className="text-xs text-foreground truncate">
                          {overall ? "All carriers" : row.carrier}
                        </span>
                        <span className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[11px] text-muted-foreground">
                            {Number(row.in_force ?? 0)} in force · {Number(row.lapsed ?? 0)} lapsed
                          </span>
                          <span
                            className={
                              "text-xs font-bold tabular-nums " +
                              (bad ? "text-rose-500" : "text-emerald-500")
                            }
                          >
                            {pct.toFixed(1)}%
                          </span>
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {concentration && concentration.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-1">
                <Award className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Carrier concentration</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Share of the in-force book. A high share means losing one
                appointment takes that much of the paying book with it.
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {[...concentration]
                  .sort((a, b) => Number(b.in_force_alp ?? 0) - Number(a.in_force_alp ?? 0))
                  .map((row) => {
                    const pct = Number(row.pct_of_in_force_alp ?? 0);
                    return (
                      <div key={`${row.dimension}-${row.name}`}>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-foreground truncate">{row.name}</span>
                          <span className="text-muted-foreground flex-shrink-0 tabular-nums">
                            {fmt$(Number(row.in_force_alp ?? 0))} · {pct.toFixed(1)}%
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className={
                              "h-full rounded-full " +
                              (pct >= 35 ? "bg-amber-500" : "bg-emerald-500")
                            }
                            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* KPI cards — 6 metrics, per Sam brief */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          icon={<Award className="h-4 w-4" />}
          label="Total Deals"
          value={loading ? "…" : kpi.totalDeals.toLocaleString()}
          tone="teal"
          sub={
            truth?.deals_this_month != null
              ? `${Number(truth.deals_this_month).toLocaleString()} this month`
              : undefined
          }
        />
        <KpiCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Annual Premium"
          value={loading ? "…" : fmt$(kpi.totalALP)}
          tone="gold"
          sub={
            truth?.premium_this_month != null
              ? `${fmt$(Number(truth.premium_this_month))} this month`
              : undefined
          }
        />
        <KpiCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Monthly Premium"
          value={loading ? "…" : fmt$(kpi.totalMonthly)}
          tone="gold"
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Avg Per Deal"
          value={loading ? "…" : fmt$(kpi.avgPerDeal)}
          tone="blue"
        />
        <KpiCard
          icon={<Shield className="h-4 w-4" />}
          label="Active Policies"
          value={loading ? "…" : kpi.activePolicies.toLocaleString()}
          tone="green"
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Chargeback Watch"
          value={loading ? "…" : kpi.chargebackWatch.toLocaleString()}
          tone="rose"
          sub={`Within ${CHARGEBACK_WINDOW_DAYS}d window`}
          onClick={() => setChargebackOpen(true)}
        />
      </div>

      {syncErrors > 0 && (
        <GlassCard className="border-amber-500/30 bg-amber-500/10 p-3">
          <div className="flex items-center gap-2 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4" />
            {syncErrors} deal{syncErrors === 1 ? "" : "s"} have AgentLink sync
            errors. Filter/search by policy or external id before trusting
            totals.
          </div>
        </GlassCard>
      )}

      {/* Filters row + sort */}
      <GlassCard className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agent, client, policy, carrier…"
              className="pl-9 h-9"
            />
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <Filter className="h-3.5 w-3.5 mr-1.5" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge className="ml-2 bg-primary/20 text-primary border-primary/30 tabular-nums">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[360px] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Filters</h4>
                {activeFilterCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={resetFilters}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Clear all
                  </Button>
                )}
              </div>
              <FilterField label="Agent">
                <Input
                  value={agentFilter}
                  onChange={(e) => setAgentFilter(e.target.value)}
                  placeholder="Agent name"
                  className="h-8 text-xs"
                />
              </FilterField>
              <FilterField label="Client">
                <Input
                  value={clientFilter}
                  onChange={(e) => setClientFilter(e.target.value)}
                  placeholder="Client name"
                  className="h-8 text-xs"
                />
              </FilterField>
              <FilterField label="Policy #">
                <Input
                  value={policyFilter}
                  onChange={(e) => setPolicyFilter(e.target.value)}
                  placeholder="Policy number"
                  className="h-8 text-xs"
                />
              </FilterField>
              <FilterField label="Carrier">
                <Input
                  value={carrierFilter}
                  onChange={(e) => setCarrierFilter(e.target.value)}
                  placeholder="Carrier name"
                  className="h-8 text-xs"
                />
              </FilterField>
              <FilterField label="Product">
                <Input
                  value={productFilter}
                  onChange={(e) => setProductFilter(e.target.value)}
                  placeholder="Product"
                  className="h-8 text-xs"
                />
              </FilterField>
              <div className="grid grid-cols-2 gap-2">
                <FilterField label="Source">
                  <Select
                    value={sourceFilter}
                    onValueChange={(v) => setSource(v as any)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="apex">APEX</SelectItem>
                      <SelectItem value="agent_link">AgentLink</SelectItem>
                    </SelectContent>
                  </Select>
                </FilterField>
                <FilterField label="Stage">
                  <Select
                    value={stageFilter}
                    onValueChange={(v) => setStage(v as any)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="submitted">Submitted</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="lapsed">Lapsed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                      <SelectItem value="charged_back">Chargeback</SelectItem>
                      {stageOptionExtras.map((k) => (
                        <SelectItem key={k} value={k}>
                          {STAGE_LABEL[k] ?? titleCaseStageKey(k)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>
              </div>
              <FilterField label="Effective date">
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={postedSince}
                    onChange={(e) => setPostedSince(e.target.value)}
                    className="h-8 text-xs"
                    max={postedUntil || undefined}
                  />
                  <span className="text-xs text-muted-foreground">→</span>
                  <Input
                    type="date"
                    value={postedUntil}
                    onChange={(e) => setPostedUntil(e.target.value)}
                    className="h-8 text-xs"
                    min={postedSince || undefined}
                  />
                </div>
              </FilterField>
              <FilterField
                label={`Monthly premium · $${premiumRange[0]} – $${premiumRange[1] === PREMIUM_SLIDER_MAX ? `${PREMIUM_SLIDER_MAX}+` : premiumRange[1]}`}
              >
                <Slider
                  min={0}
                  max={PREMIUM_SLIDER_MAX}
                  step={50}
                  value={premiumRange}
                  onValueChange={(v) =>
                    setPremiumRange([v[0] ?? 0, v[1] ?? PREMIUM_SLIDER_MAX])
                  }
                />
              </FilterField>
            </PopoverContent>
          </Popover>

          <Select
            value={sortMode}
            onValueChange={(v) => setSortMode(v as SortMode)}
          >
            <SelectTrigger className="h-9 w-full sm:w-[190px]">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest_posted">Newest Effective</SelectItem>
              <SelectItem value="highest_premium">Highest Premium</SelectItem>
              <SelectItem value="chargeback_risk">Chargeback Risk</SelectItem>
              <SelectItem value="by_agent">By Agent</SelectItem>
              <SelectItem value="by_carrier">By Carrier</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="mt-3 pt-3 border-t border-border/40 flex items-center justify-between text-xs">
          <div className="tabular-nums">
            {loading ? (
              <span className="text-muted-foreground">
                Loading full book of business…
              </span>
            ) : (
              <>
                Showing{" "}
                <span className="font-semibold text-amber-500">
                  {filtered.length.toLocaleString()}
                </span>
                <span className="text-muted-foreground"> of </span>
                <span className="font-semibold text-emerald-500">
                  {(dealsSourceCount ?? deals.length).toLocaleString()}
                </span>
                <span className="text-muted-foreground"> deals</span>
                {dealsSourceCount != null &&
                  dealsSourceCount > deals.length && (
                    <span
                      className="ml-2 text-[10px] uppercase tracking-wide text-amber-500/80"
                      title={`Client fetch is capped at ${AGENTLINK_SNAPSHOT_ROW_CAP.toLocaleString()} rows per load. ${(dealsSourceCount - deals.length).toLocaleString()} rows exist in the database but are not in the table below. Narrow filters to see the rest.`}
                    >
                      · capped ({(dealsSourceCount - deals.length).toLocaleString()} more in DB)
                    </span>
                  )}
              </>
            )}
          </div>
          {truth?.last_synced_at && (
            <span className="text-muted-foreground">
              Synced{" "}
              {formatDistanceToNowStrict(new Date(truth.last_synced_at), {
                addSuffix: true,
              })}
            </span>
          )}
        </div>
      </GlassCard>

      {/* Table */}
      <GlassCard className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Client</th>
                <th className="text-left px-3 py-2">Agent</th>
                <th className="text-left px-3 py-2">Policy #</th>
                <th className="text-left px-3 py-2">Product</th>
                <th className="text-left px-3 py-2">Carrier</th>
                <th className="text-right px-3 py-2">Monthly</th>
                <th className="text-right px-3 py-2">ALP</th>
                <th className="text-left px-3 py-2">Effective Date</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  // stable-key-allow:skeleton-loader-static-length-array
                  <tr key={i} className="border-t border-border/30">
                    {Array.from({ length: 10 }).map((__, j) => (
                      <td key={j} className="px-3 py-3">
                        <div className="h-3 bg-muted/30 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center">
                    <Book className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                    <h3 className="text-15 font-bold mb-2">
                      {deals.length === 0
                        ? "No deals fetched"
                        : "Filters are hiding the book"}
                    </h3>
                    <div className="max-w-md mx-auto space-y-3">
                      <p className="text-13 text-muted-foreground">
                        Fetched{" "}
                        <span className="font-bold text-foreground tabular-nums">
                          {deals.length.toLocaleString()}
                        </span>{" "}
                        deals from the database.
                      </p>
                      {deals.length === 0 ? (
                        <div className="text-12 text-rose-600 dark:text-rose-400 text-left">
                          Zero rows came back. Likely causes:
                          <ul className="list-disc list-inside mt-2">
                            <li>
                              Agent has no AgentLink user mapping (al_user_id
                              NULL)
                            </li>
                            <li>Your session expired (log out + back in)</li>
                            <li>
                              AgentLink sync is dark — check
                              /dashboard/finances · CFO bot
                            </li>
                          </ul>
                        </div>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={resetFilters}
                          className="bg-amber-500 hover:bg-amber-400 text-slate-950"
                        >
                          Clear all filters · show{" "}
                          {deals.length.toLocaleString()} deals
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((d) => {
                  const inCbWindow = isInChargebackWindow(d);
                  const daysEff = daysSinceEffective(d);
                  const isReviewed = reviewedIds.has(d.id);
                  const { ts: posted, isFallback: postedIsFallback } =
                    pickPostedTs(d);
                  return (
                    <tr
                      key={d.id}
                      className={cn(
                        "border-t border-border/30 hover:bg-muted/20 transition-colors",
                        isReviewed && "opacity-60",
                      )}
                    >
                      <td className="px-3 py-2 font-medium">
                        <button
                          type="button"
                          onClick={() => setSelectedDeal(d)}
                          className="inline-flex items-center gap-1.5 text-left text-primary hover:underline"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          {d.client_first_name} {d.client_last_name}
                        </button>
                        {inCbWindow && (
                          <Badge className="ml-2 bg-rose-500/15 text-rose-300 border-rose-500/40 text-[10px]">
                            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                            {daysEff}d
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {d.agent_id ? (
                          <AgentNameLink
                            agentId={d.agent_id}
                            variant="bare"
                            className="text-sm"
                          >
                            <span className="hover:text-primary hover:underline decoration-dotted underline-offset-2">
                              {d.agent_name}
                            </span>
                          </AgentNameLink>
                        ) : (
                          d.agent_name
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-muted-foreground">
                        {d.policy_number}
                      </td>
                      <td className="px-3 py-2">{d.product_sold}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {d.carrier_name}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-400">
                        {d.monthly_premium
                          ? fmt$(Number(d.monthly_premium))
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-400">
                        {d.annual_premium
                          ? fmt$(Number(d.annual_premium))
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {posted ? (
                          <div>
                            <div>
                              {formatDistanceToNowStrict(new Date(posted), {
                                addSuffix: true,
                              })}
                            </div>
                            <div className="text-[10px] opacity-70">
                              {postedIsFallback ? "Synced " : ""}
                              {format(new Date(posted), "MMM d, yyyy")}
                            </div>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          className={cn(
                            "text-[10px] border",
                            STAGE_COLORS[pipelineStageKey(d)] ??
                              "bg-muted text-muted-foreground border-border",
                          )}
                        >
                          {stageDisplayLabel(d)}
                        </Badge>
                        {d.insuracloud_sync_error && (
                          <div className="mt-1 text-[10px] text-amber-300">
                            sync issue
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label="Row actions"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide">
                              Actions
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                              onClick={() => setSelectedDeal(d)}
                            >
                              <Eye className="h-3.5 w-3.5 mr-2" />
                              View policy
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => openAgentLink(d)}
                            >
                              <ExternalLink className="h-3.5 w-3.5 mr-2" />
                              Open AgentLink
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => markReviewed(d.id)}
                              disabled={isReviewed}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-2" />
                              {isReviewed ? "Reviewed" : "Mark reviewed"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* Right-side PolicyDetailDrawer */}
      <PolicyDetailDrawer
        deal={selectedDeal}
        onClose={() => setSelectedDeal(null)}
        onOpenAgentLink={openAgentLink}
      />

      {/* Chargeback Watch drawer */}
      <ChargebackWatchDrawer
        open={chargebackOpen}
        onClose={() => setChargebackOpen(false)}
        cbSince={cbSince}
        cbUntil={cbUntil}
        setCbSince={setCbSince}
        setCbUntil={setCbUntil}
        chargebacks={chargebacks}
        cbLoading={cbLoading}
        cbTotalMonthly={cbTotalMonthly}
        cbTotalALP={cbTotalALP}
        activeWatch={kpi.chargebackWatch}
        deals={deals}
      />
    </div>
  );
}

// ─── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone: "teal" | "gold" | "blue" | "green" | "rose";
  onClick?: () => void;
}) {
  const toneMap = {
    teal: {
      text: "text-teal-300",
      icon: "text-teal-400",
      border: "border-teal-500/20",
    },
    gold: {
      text: "text-amber-300",
      icon: "text-amber-400",
      border: "border-amber-500/20",
    },
    blue: {
      text: "text-sky-300",
      icon: "text-sky-400",
      border: "border-sky-500/20",
    },
    green: {
      text: "text-emerald-300",
      icon: "text-emerald-400",
      border: "border-emerald-500/20",
    },
    rose: {
      text: "text-rose-300",
      icon: "text-rose-400",
      border: "border-rose-500/30",
    },
  }[tone];
  const inner = (
    <>
      <div className="flex items-center gap-2 mb-1">
        <span className={cn(toneMap.icon)}>{icon}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </span>
      </div>
      <div className={cn("text-2xl font-bold tabular-nums", toneMap.text)}>
        {value}
      </div>
      {sub && (
        <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
      )}
    </>
  );
  const baseClass = cn(
    "text-left rounded-xl border bg-card/60 backdrop-blur-sm p-3 transition-all",
    toneMap.border,
    onClick && "hover:shadow-lg hover:-translate-y-0.5 cursor-pointer",
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={baseClass}>
        {inner}
      </button>
    );
  }
  return <div className={baseClass}>{inner}</div>;
}

// ─── Filter field wrapper ────────────────────────────────────────────────────

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
        {label}
      </p>
      {children}
    </div>
  );
}

// ─── Policy detail drawer (right Sheet) ──────────────────────────────────────

function PolicyDetailDrawer({
  deal,
  onClose,
  onOpenAgentLink,
}: {
  deal: DealRow | null;
  onClose: () => void;
  onOpenAgentLink: (deal: DealRow | null) => void;
}) {
  const { isAdmin } = useAuth();
  const [client, setClient] = useState<ClientFullRow | null>(null);
  const [clientLoading, setClientLoading] = useState(false);
  const [timeline, setTimeline] = useState<ContactLogRow[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  useEffect(() => {
    if (!deal?.pipeline_client_id) {
      setClient(null);
      return;
    }
    setClientLoading(true);
    (async () => {
      const { data } = await supabase
        .from("agentlink_clients" as any)
        .select("*")
        .eq("insuracloud_pipeline_client_id", deal.pipeline_client_id)
        .maybeSingle();
      setClient((data as ClientFullRow | null) ?? null);
      setClientLoading(false);
    })();
  }, [deal?.pipeline_client_id]);

  useEffect(() => {
    if (!deal?.application_id) {
      setTimeline([]);
      return;
    }
    setTimelineLoading(true);
    (async () => {
      const { data } = await supabase
        .from("application_contact_log" as any)
        .select("id, channel, outcome, notes, logged_at, logged_by")
        .eq("application_id", deal.application_id)
        .order("logged_at", { ascending: false })
        .limit(50);
      setTimeline(((data as unknown) as ContactLogRow[] | null) ?? []);
      setTimelineLoading(false);
    })();
  }, [deal?.application_id]);

  if (!deal) return null;

  const daysEff = daysSinceEffective(deal);
  const inCbWindow = isInChargebackWindow(deal);
  const cbDaysRemaining = inCbWindow
    ? CHARGEBACK_WINDOW_DAYS - (daysEff ?? 0)
    : null;

  return (
    <Sheet
      open={Boolean(deal)}
      onOpenChange={(open) => !open && onClose()}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-[560px] overflow-y-auto"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-xl">
            {deal.client_first_name} {deal.client_last_name}
          </SheetTitle>
          <div className="flex items-center gap-2 mt-1 text-xs flex-wrap">
            <Badge
              className={cn(
                "border",
                STAGE_COLORS[pipelineStageKey(deal)] ??
                  "bg-muted text-muted-foreground border-border",
              )}
            >
              {stageDisplayLabel(deal)}
            </Badge>
            {deal.policy_number && (
              <span className="font-mono text-muted-foreground">
                #{deal.policy_number}
              </span>
            )}
            {deal.carrier_name && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  {deal.carrier_name}
                </span>
              </>
            )}
          </div>
        </SheetHeader>

        <div className="space-y-5 mt-4">
          {/* 1. Client info */}
          <DrawerSection title="Client">
            <DrawerRow
              label="Name"
              value={`${deal.client_first_name ?? ""} ${deal.client_last_name ?? ""}`.trim()}
            />
            <DrawerRow label="Pipeline Client ID" value={deal.pipeline_client_id} />
          </DrawerSection>

          {/* 2. Agent */}
          <DrawerSection title="Agent" accent="text-blue-400">
            {deal.agent_id ? (
              <div className="col-span-2">
                <AgentNameLink
                  agentId={deal.agent_id}
                  variant="default"
                  className="text-sm font-medium text-primary"
                >
                  {deal.agent_name ?? "Agent"}
                </AgentNameLink>
              </div>
            ) : (
              <DrawerRow label="Agent" value={deal.agent_name ?? "Unmatched"} />
            )}
            {deal.agentlink_user_id != null && (
              <DrawerRow
                label="AgentLink user"
                value={`#${deal.agentlink_user_id}`}
              />
            )}
          </DrawerSection>

          {/* 3-8 Policy detail */}
          <DrawerSection title="Policy" accent="text-emerald-400">
            <DrawerRow label="Policy Number" value={deal.policy_number} />
            <DrawerRow label="Product" value={deal.product_sold} />
            <DrawerRow label="Carrier" value={deal.carrier_name} />
            <DrawerRow
              label="Monthly Premium"
              value={
                deal.monthly_premium
                  ? formatCurrency(Number(deal.monthly_premium))
                  : null
              }
            />
            <DrawerRow
              label="Annual Premium"
              value={
                deal.annual_premium
                  ? formatCurrency(Number(deal.annual_premium))
                  : null
              }
            />
            <DrawerRow
              label="Face Amount"
              value={formatCurrency((client as any)?.face_amount)}
            />
            <DrawerRow
              label="Effective Date"
              value={
                deal.effective_date
                  ? format(new Date(deal.effective_date), "MMM d, yyyy")
                  : null
              }
            />
            <DrawerRow
              label="Posted Date"
              value={
                deal.posted_at
                  ? format(new Date(deal.posted_at), "MMM d, yyyy")
                  : null
              }
            />
            <DrawerRow
              label="Source"
              value={sourceKey(deal.source) === "apex" ? "APEX" : "AgentLink"}
            />
          </DrawerSection>

          {/* 8. Chargeback window */}
          <DrawerSection title="Chargeback Window" accent="text-rose-300">
            {daysEff == null ? (
              <p className="text-xs text-muted-foreground col-span-2">
                No effective date — cannot compute chargeback window.
              </p>
            ) : inCbWindow ? (
              <>
                <DrawerRow
                  label="Days in-force"
                  value={`${daysEff}d`}
                />
                <DrawerRow
                  label="Days until safe"
                  value={
                    <span className="text-rose-300 font-semibold">
                      {cbDaysRemaining}d remaining
                    </span>
                  }
                />
                <div className="col-span-2 text-[11px] text-rose-300/80">
                  Inside the {CHARGEBACK_WINDOW_DAYS}-day chargeback risk
                  window. Confirm payment posted at carrier.
                </div>
              </>
            ) : (
              <p className="text-xs text-emerald-300 col-span-2">
                {daysEff}d in-force — cleared the {CHARGEBACK_WINDOW_DAYS}-day
                cliff.
              </p>
            )}
          </DrawerSection>

          {/* 9. Timeline */}
          <DrawerSection title="Timeline" accent="text-purple-300">
            {timelineLoading ? (
              <p className="text-xs text-muted-foreground col-span-2">
                Loading contact log…
              </p>
            ) : timeline.length === 0 ? (
              <p className="text-xs text-muted-foreground col-span-2">
                No contact log entries for this policy.
              </p>
            ) : (
              <div className="col-span-2 space-y-1">
                {timeline.map((t) => (
                  <div
                    key={t.id}
                    className="text-xs px-2 py-1.5 rounded bg-background/40 border border-border/30"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {t.channel ?? "log"}
                      </span>
                      <span className="text-muted-foreground text-[10px]">
                        {t.logged_at
                          ? format(new Date(t.logged_at), "MMM d, yyyy HH:mm")
                          : "—"}
                      </span>
                    </div>
                    {t.outcome && (
                      <div className="text-[10px] text-muted-foreground">
                        {t.outcome}
                      </div>
                    )}
                    {t.notes && (
                      <div className="text-[11px] mt-1">{t.notes}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </DrawerSection>

          {/* 10. Notes */}
          {(client?.communication_notes ||
            client?.reminder_notes ||
            client?.medical_notes ||
            client?.objectives) && (
            <DrawerSection title="Notes" accent="text-amber-300">
              <DrawerRow
                label="Objectives"
                value={client?.objectives as string | null | undefined}
              />
              <DrawerRow
                label="Communication"
                value={client?.communication_notes as string | null | undefined}
              />
              <DrawerRow
                label="Reminders"
                value={client?.reminder_notes as string | null | undefined}
              />
              <DrawerRow
                label="Medical"
                value={client?.medical_notes as string | null | undefined}
              />
            </DrawerSection>
          )}

          {clientLoading && (
            <p className="text-xs text-muted-foreground italic">
              Loading full client profile…
            </p>
          )}

          {isAdmin &&
            (client?.bank_name || client?.bank_account_number) && (
              <DrawerSection title="Banking · Admin only" accent="text-amber-400">
                <DrawerRow label="Bank Name" value={client?.bank_name as any} />
                <DrawerRow
                  label="Account Type"
                  value={client?.bank_account_type as any}
                />
                <DrawerRow
                  label="Account Number"
                  value={client?.bank_account_number as any}
                />
                <DrawerRow
                  label="Routing Number"
                  value={client?.bank_routing_number as any}
                />
              </DrawerSection>
            )}

          {client && (
            <DrawerSection title="Financial Profile" accent="text-emerald-400">
              <DrawerRow
                label="Monthly Income"
                value={formatCurrency(client.total_monthly_income as any)}
              />
              <DrawerRow
                label="Monthly Expenses"
                value={formatCurrency(client.total_monthly_expenses as any)}
              />
              <DrawerRow
                label="Monthly Surplus"
                value={formatCurrency(client.monthly_surplus as any)}
              />
              <DrawerRow
                label="Total Investable"
                value={formatCurrency(client.total_investable as any)}
              />
            </DrawerSection>
          )}

          {/* 11. Open AgentLink CTA */}
          <div className="pt-2 flex gap-2">
            <Button
              className="flex-1"
              onClick={() => onOpenAgentLink(deal)}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              Open AgentLink
            </Button>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DrawerSection({
  title,
  children,
  accent,
}: {
  title: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="space-y-2">
      <h3
        className={cn(
          "text-[11px] font-semibold uppercase tracking-wider",
          accent ?? "text-muted-foreground",
        )}
      >
        {title}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

function DrawerRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    value === false
  )
    return null;
  return (
    <div className="rounded-md border border-border/50 p-2.5 bg-card/30">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 break-words text-xs font-medium">
        {typeof value === "string" || typeof value === "number"
          ? String(value)
          : value}
      </p>
    </div>
  );
}

// ─── Chargeback Watch drawer ────────────────────────────────────────────────

function ChargebackWatchDrawer({
  open,
  onClose,
  cbSince,
  cbUntil,
  setCbSince,
  setCbUntil,
  chargebacks,
  cbLoading,
  cbTotalMonthly,
  cbTotalALP,
  activeWatch,
  deals,
}: {
  open: boolean;
  onClose: () => void;
  cbSince: string;
  cbUntil: string;
  setCbSince: (v: string) => void;
  setCbUntil: (v: string) => void;
  chargebacks: ChargebackRow[];
  cbLoading: boolean;
  cbTotalMonthly: number;
  cbTotalALP: number;
  activeWatch: number;
  deals: DealRow[];
}) {
  const inWindow = useMemo(
    () =>
      deals
        .filter(isInChargebackWindow)
        .sort((a, b) => chargebackRisk(b) - chargebackRisk(a)),
    [deals],
  );

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[560px] overflow-y-auto"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-rose-400" />
            Chargeback Watch
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Two lenses: active {CHARGEBACK_WINDOW_DAYS}-day cliff window (right
            now) and historical chargebacks (period picker).
          </p>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* Active risk window */}
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-rose-300">
              Active {CHARGEBACK_WINDOW_DAYS}-day window
            </h3>
            <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3">
              <div className="text-2xl font-bold tabular-nums text-rose-300">
                {activeWatch.toLocaleString()}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Policies still in cliff window
              </div>
            </div>
            <div className="max-h-[240px] overflow-y-auto space-y-1">
              {inWindow.slice(0, 50).map((d) => {
                const daysEff = daysSinceEffective(d);
                return (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded bg-background/40 border border-border/30"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {d.client_first_name} {d.client_last_name}
                        {d.policy_number && (
                          <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                            #{d.policy_number}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {d.agent_name} · {d.carrier_name || "—"} · Eff{" "}
                        {d.effective_date
                          ? format(new Date(d.effective_date), "MMM d")
                          : "—"}
                      </div>
                    </div>
                    <div className="text-right tabular-nums shrink-0">
                      <div className="text-rose-300 font-semibold">
                        {daysEff}d in
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {d.annual_premium
                          ? fmt$(Number(d.annual_premium))
                          : "—"}{" "}
                        ALP
                      </div>
                    </div>
                  </div>
                );
              })}
              {inWindow.length === 0 && (
                <p className="text-xs text-emerald-300">
                  No policies in the active chargeback window. Book is clean.
                </p>
              )}
            </div>
          </div>

          {/* Historical chargebacks */}
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Historical chargebacks
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={cbSince}
                onChange={(e) => setCbSince(e.target.value)}
                className="h-8 w-full sm:w-[140px] text-xs"
                max={cbUntil}
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={cbUntil}
                onChange={(e) => setCbUntil(e.target.value)}
                className="h-8 w-full sm:w-[140px] text-xs"
                min={cbSince}
                max={format(new Date(), "yyyy-MM-dd")}
              />
              <div className="flex gap-1 ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    setCbSince(format(subDays(new Date(), 30), "yyyy-MM-dd"));
                    setCbUntil(format(new Date(), "yyyy-MM-dd"));
                  }}
                >
                  30d
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    setCbSince(format(subDays(new Date(), 90), "yyyy-MM-dd"));
                    setCbUntil(format(new Date(), "yyyy-MM-dd"));
                  }}
                >
                  90d
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    setCbSince(format(subDays(new Date(), 365), "yyyy-MM-dd"));
                    setCbUntil(format(new Date(), "yyyy-MM-dd"));
                  }}
                >
                  YTD
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Count
                </div>
                <div className="text-lg font-bold tabular-nums text-rose-300">
                  {cbLoading ? "…" : chargebacks.length}
                </div>
              </div>
              <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Monthly
                </div>
                <div className="text-lg font-bold tabular-nums text-rose-300">
                  {cbLoading ? "…" : fmt$(cbTotalMonthly)}
                </div>
              </div>
              <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  ALP
                </div>
                <div className="text-lg font-bold tabular-nums text-rose-300">
                  {cbLoading ? "…" : fmt$(cbTotalALP)}
                </div>
              </div>
            </div>

            <div className="max-h-[280px] overflow-y-auto space-y-1">
              {!cbLoading && chargebacks.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No chargebacks in this range. Widen the window if you expect
                  older ones.
                </p>
              )}
              {chargebacks.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded bg-background/40 border border-border/30"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {c.client_first_name} {c.client_last_name}
                      {c.policy_number && (
                        <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                          #{c.policy_number}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {c.agent_name} · {c.carrier_name || "—"} ·{" "}
                      {c.status_updated_at
                        ? format(new Date(c.status_updated_at), "MMM d, yyyy")
                        : "—"}
                    </div>
                  </div>
                  <div className="text-right tabular-nums shrink-0">
                    <div className="text-rose-300 font-semibold">
                      {c.monthly_premium
                        ? fmt$(Number(c.monthly_premium))
                        : "—"}
                      /mo
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {c.annual_premium
                        ? fmt$(Number(c.annual_premium))
                        : "—"}{" "}
                      ALP
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
