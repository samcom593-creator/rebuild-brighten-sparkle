// MP-264 — Book of Business rebuild (2026-07-09)
// Sam brief verbatim: Every policy record across the agency.
// - Combines AgentLink snapshots with separately imported Ethos carrier policies
// - Keeps source-specific actions and audit details honest in the UI
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
import { EmptyState } from "@/components/ui/empty-state";
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
  client_address?: string | null;
  client_phone?: string | null;
  client_dob?: string | null;
  face_amount?: number | null;
  source_agent_names?: string[];
  source_file_name?: string | null;
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

interface ChargebackWatchRow {
  deal_key: string | null;
  policy_number: string | null;
  client_name: string | null;
  carrier: string | null;
  agent_name: string | null;
  status: string | null;
  months_in_force: number | string | null;
  annual_premium: number | string | null;
  est_clawback_exposure: number | string | null;
  priority: number | string | null;
  what_this_means: string | null;
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

// Severity is the only colour channel: emerald = paying, amber = in flight,
// rose = money lost, muted = not adjudicated yet. Every value is the
// light/dark paired weight so the chip stays legible on the white card.
const STAGE_NEUTRAL = "border-border bg-muted text-muted-foreground";
const STAGE_GOOD =
  "border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
const STAGE_WARN =
  "border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-400";
const STAGE_BAD =
  "border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-400";

const STAGE_COLORS: Record<string, string> = {
  submitted: STAGE_NEUTRAL,
  active: STAGE_GOOD,
  approved: STAGE_GOOD,
  in_force: STAGE_GOOD,
  paid: STAGE_WARN,
  lapsed: STAGE_BAD,
  cancelled: STAGE_BAD,
  charged_back: STAGE_BAD,
  pending: STAGE_NEUTRAL,
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

type BookSourceKey = "apex" | "agent_link" | "ethos";

function sourceKey(source?: string | null): BookSourceKey {
  if (source === "ethos") return "ethos";
  return source === "agent_link" ||
    source === "agentlink" ||
    source === "insuracloud"
    ? "agent_link"
    : "apex";
}

function sourceLabel(source?: string | null): string {
  const key = sourceKey(source);
  if (key === "ethos") return "Ethos";
  return key === "agent_link" ? "AgentLink" : "APEX";
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
  const key = pipelineLabel(deal).toLowerCase().trim().replace(/\s+/g, "_");
  return key === "inforce" ? "in_force" : key;
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

// Whitelist, not blacklist. The old blacklist counted everything that wasn't
// explicitly dead as "active" — which swept in 1,235 Unknown-status manual-paste
// rows, 130 never-issued, and 62 Lapse Pending, inflating "Active Policies" to
// 3,062 while the strict "In force" tile on the same page read 131. Only stages
// that represent a real in-force/issued policy count now.
const ACTIVE_STAGES = new Set(["active", "approved", "in_force", "issued", "paid"]);
function isActivePolicy(deal: DealRow): boolean {
  return ACTIVE_STAGES.has(pipelineStageKey(deal));
}

// AgentLink snapshot rows set posted_at = snapshot_at (sync clock), so every
// row would render the same "X ago" and the "Newest Posted" sort collapses to
// a near no-op. effective_date is the real business date on both sources; fall
// back to posted_at/created_at only when effective_date is missing, and mark
// that case so the UI can say "Synced" instead of pretending it's a post time.
function pickPostedTs(
  deal: Pick<DealRow, "effective_date" | "posted_at" | "created_at">,
): { ts: string | null; isFallback: boolean } {
  if (deal.effective_date)
    return { ts: deal.effective_date, isFallback: false };
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
  // Real chargeback exposure. The old KPI counted any policy effective in the
  // last 30 days regardless of status — 243 of its 252 were HEALTHY active
  // business, and it missed the 62 policies actually signalling lapse.
  const [cbWatch, setCbWatch] = useState<ChargebackWatchRow[] | null>(null);
  const [persistency, setPersistency] = useState<BookPersistencyRow[] | null>(
    null,
  );
  const [concentration, setConcentration] = useState<
    BookConcentrationRow[] | null
  >(null);
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
  const [sourceFilter, setSource] = useState<"all" | BookSourceKey>("all");
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

      const { data: cbRows, error: cbErr } = await supabase
        .from("v_chargeback_watch" as any)
        .select(
          "deal_key, policy_number, client_name, carrier, agent_name, status, months_in_force, annual_premium, est_clawback_exposure, priority, what_this_means",
        )
        .order("priority", { ascending: true })
        .order("est_clawback_exposure", { ascending: false })
        .limit(200);
      if (cbErr) {
        logger.warn("[BookOfBusiness] v_chargeback_watch read failed", {
          error: cbErr.message,
        });
        setCbWatch(null);
      } else {
        setCbWatch((cbRows as unknown as ChargebackWatchRow[]) ?? null);
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
        .select(
          "dimension, name, in_force_policies, in_force_alp, pct_of_in_force_alp",
        )
        .eq("dimension", "carrier");
      if (concErr) {
        logger.warn("[BookOfBusiness] v_book_concentration read failed", {
          error: concErr.message,
        });
        setConcentration(null);
      } else {
        setConcentration(
          (concRows as unknown as BookConcentrationRow[]) ?? null,
        );
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

      const {
        data: alSnapshot,
        count: alCount,
        error: alError,
      } = await alQuery;
      if (alError)
        console.error(
          "[BookOfBusiness] AgentLink snapshot fetch failed:",
          alError,
        );
      const alRawRows = (
        (alSnapshot ?? []) as Array<Record<string, unknown>>
      ).filter((r) => r.policy_number);

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
          ? // 2026-07-29: this queried `carriers`, whose id is a UUID, using AgentLink
            // carrier ids, which are INTEGERS (agentlink_book.carrier_id is integer).
            // The two key spaces cannot intersect, so the lookup returned nothing and the
            // Carrier column, the Carrier filter and the "By Carrier" sort were blank across
            // all 1,629 book rows carrying a carrier_id. agentlink_carriers is the
            // integer-keyed table and holds the 16 real names.
            // NOTE: the `carriers` lookups further down are CORRECT and deliberately left
            // alone — they resolve deals.carrier_id, which really is a uuid.
            supabase
              .from("agentlink_carriers")
              .select("id, name")
              .in("id", alCarrierIds)
          : Promise.resolve({ data: [] } as any),
      ]);

      const agentByAlUserId = new Map<number, any>();
      for (const agent of (agentsByAl ?? []) as any[]) {
        if (typeof agent.al_user_id === "number")
          agentByAlUserId.set(agent.al_user_id, agent);
      }
      const alCarrierMap: Record<string, string> = {};
      for (const carrier of (alCarriers ?? []) as any[])
        alCarrierMap[String(carrier.id)] = carrier.name;

      const alRows: DealRow[] = alRawRows.map((r) => {
        const agentlinkUserId = Number(r.user_id);
        const mappedAgent = Number.isFinite(agentlinkUserId)
          ? agentByAlUserId.get(agentlinkUserId)
          : null;
        const carrierId = r.carrier_id != null ? String(r.carrier_id) : null;
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

      let ethosQuery = supabase
        .from("ethos_book_policies" as any)
        .select(
          "id, owner_agent_id, source_agent_names, client_first_name, client_last_name, client_address, client_phone, client_dob, face_amount, raw_status, effective_date, product_sold, policy_number, monthly_premium, annual_premium, carrier_name, source_file_name, imported_at",
          { count: "exact" },
        )
        .order("effective_date", { ascending: false, nullsFirst: false })
        .limit(AGENTLINK_SNAPSHOT_ROW_CAP);

      if (!isAdmin && agentScopeIds !== null) {
        if (agentScopeIds.length === 0) {
          ethosQuery = ethosQuery.in("owner_agent_id", [
            "00000000-0000-0000-0000-000000000000",
          ]);
        } else {
          ethosQuery = ethosQuery.in("owner_agent_id", agentScopeIds);
        }
      }

      const {
        data: ethosSnapshot,
        count: ethosCount,
        error: ethosError,
      } = await ethosQuery;
      if (ethosError) {
        logger.warn("[BookOfBusiness] Ethos snapshot fetch failed", {
          error: ethosError.message,
        });
      }

      const ethosRows: DealRow[] = (
        (ethosSnapshot ?? []) as unknown as Array<Record<string, unknown>>
      ).map((r) => {
        const sourceAgents = Array.isArray(r.source_agent_names)
          ? r.source_agent_names.map(String).filter(Boolean)
          : [];
        return {
          id: `ethos-${String(r.id ?? "")}`,
          agent_id: null,
          agentlink_user_id: null,
          application_id: null,
          client_first_name: String(r.client_first_name ?? ""),
          client_last_name: String(r.client_last_name ?? ""),
          client_address: r.client_address ? String(r.client_address) : null,
          client_phone: r.client_phone ? String(r.client_phone) : null,
          client_dob: r.client_dob ? String(r.client_dob) : null,
          face_amount: r.face_amount != null ? Number(r.face_amount) : null,
          policy_number: String(r.policy_number ?? ""),
          product_sold: r.product_sold ? String(r.product_sold) : null,
          monthly_premium:
            r.monthly_premium != null ? Number(r.monthly_premium) : null,
          annual_premium:
            r.annual_premium != null ? Number(r.annual_premium) : null,
          effective_date: r.effective_date ? String(r.effective_date) : null,
          posted_at: r.imported_at ? String(r.imported_at) : null,
          pipeline_stage: null,
          policy_status_standard: r.raw_status
            ? String(r.raw_status)
            : "Inforce",
          status_updated_at: null,
          synced_to_insuracloud_at: null,
          external_deal_id: null,
          insuracloud_sync_error: null,
          source: "ethos",
          status: "active",
          carrier_id: null,
          pipeline_client_id: null,
          created_at: r.imported_at
            ? String(r.imported_at)
            : new Date().toISOString(),
          agent_name:
            sourceAgents.length > 0
              ? sourceAgents.join(" · ")
              : "Unattributed Ethos agent",
          carrier_name: r.carrier_name ? String(r.carrier_name) : "Prosperity",
          source_agent_names: sourceAgents,
          source_file_name: r.source_file_name
            ? String(r.source_file_name)
            : null,
        } as DealRow;
      });

      const rows = [...alRows, ...ethosRows];
      setDealsSourceCount(
        (typeof alCount === "number" ? alCount : alRows.length) +
          (typeof ethosCount === "number" ? ethosCount : ethosRows.length),
      );
      logger.info("[BookOfBusiness] loaded deals", {
        agentLinkRows: alRows.length,
        agentLinkSnapshotCount: alCount,
        ethosRows: ethosRows.length,
        ethosSnapshotCount: ethosCount,
        totalRows: rows.length,
        scope: isAdmin ? "admin" : "scoped",
      });

      // Resolve agent + carrier names in one batch
      const agentIds = [
        ...new Set(rows.map((r) => r.agent_id).filter(Boolean)),
      ];
      const carrierIds = [
        ...new Set(
          rows.map((r) => r.carrier_id).filter((v): v is string => Boolean(v)),
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
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ethos_book_policies",
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
        agentMap[a.id] = a.profile?.full_name ?? a.display_name ?? "Unmatched";
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
    () => chargebacks.reduce((s, c) => s + Number(c.annual_premium ?? 0), 0),
    [chargebacks],
  );
  const cbTotalMonthly = useMemo(
    () => chargebacks.reduce((s, c) => s + Number(c.monthly_premium ?? 0), 0),
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
            return (
              (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0)
            );
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
    // Derive headline KPIs from the exact scoped rows in the table. This keeps
    // AgentLink + Ethos totals aligned for admins and individual agents.
    const totalDeals = deals.length;
    const totalALP = deals.reduce(
      (s, d) => s + Number(d.annual_premium ?? 0),
      0,
    );
    const totalMonthly = deals.reduce(
      (s, d) => s + Number(d.monthly_premium ?? 0),
      0,
    );
    const avgPerDeal = totalDeals > 0 ? totalALP / totalDeals : 0;
    const activePolicies = deals.filter(isActivePolicy).length;
    // Real exposure, not recency. The old heuristic counted every policy with an
    // effective_date inside 30 days regardless of status: 252 counted, 243 of them
    // healthy active business, while the 62 policies actually signalling lapse were
    // invisible because they were older than the window. Now sourced from
    // v_chargeback_watch priority 1 = Lapse Pending still inside the advance window.
    const chargebackWatch = cbWatch
      ? cbWatch.filter((c) => Number(c.priority ?? 9) === 1).length
      : deals.filter(isInChargebackWindow).length;
    const chargebackExposure = cbWatch
      ? cbWatch
          .filter((c) => Number(c.priority ?? 9) === 1)
          .reduce((sum, c) => sum + Number(c.est_clawback_exposure ?? 0), 0)
      : 0;
    return {
      totalDeals,
      totalALP,
      totalMonthly,
      avgPerDeal,
      activePolicies,
      chargebackWatch,
      chargebackExposure,
    };
  }, [deals, cbWatch]);

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
          sourceLabel(d.source),
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
    <div className="page-enter mx-auto w-full max-w-[1400px] space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Production · Book of Business"
        eyebrowIcon={<Book className="h-3 w-3" />}
        title="Book of Business"
        subtitle="Every policy record across the agency. Synced from AgentLink and Ethos."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              className="h-10 sm:h-9"
            >
              <RefreshCw
                className={cn("mr-1.5 h-4 w-4", loading && "animate-spin")}
              />
              Refresh
            </Button>
            <Button variant="outline" size="sm" asChild className="h-10 sm:h-9">
              <a
                href="https://agentlink.insuracloud.ai/book-of-business"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="mr-1.5 h-4 w-4" />
                Open AgentLink
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              className="h-10 sm:h-9"
            >
              <Download className="mr-1.5 h-4 w-4" />
              Export
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setChargebackOpen(true)}
              className="h-10 sm:h-9"
            >
              <TrendingDown className="mr-1.5 h-4 w-4" />
              Chargeback Watch
              {kpi.chargebackWatch > 0 && (
                <Badge
                  variant="outline"
                  className="ml-2 border-destructive-foreground/30 bg-destructive-foreground/15 text-[10px] font-bold tabular-nums text-destructive-foreground"
                >
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
        <GlassCard className="p-4">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
              <DollarSign className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">Book by status</span>
            </h3>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            In-force is what is actually paying; the headline premium above sums
            every status together, so pending and never-issued business inflates
            it.
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
                  className={cn(
                    "min-w-0 rounded-lg border bg-card p-3 sm:p-4",
                    inForce ? "border-emerald-500/35" : "border-border",
                  )}
                >
                  <div className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {label}
                  </div>
                  <div
                    className={cn(
                      "mt-1 text-2xl font-bold leading-none tabular-nums",
                      inForce
                        ? "text-emerald-600 dark:text-emerald-400"
                        : dead
                          ? "text-muted-foreground"
                          : "text-foreground",
                    )}
                  >
                    {fmt$(Number(seg.annual_premium ?? 0))}
                  </div>
                  <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                    {Number(seg.policies ?? 0).toLocaleString()} policies
                    {seg.producers != null
                      ? ` · ${Number(seg.producers).toLocaleString()} producers`
                      : ""}
                  </div>
                  {note && (
                    <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                      {note}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {/* MP-268 — Persistency + carrier concentration.
          Persistency answers "of the policies that actually reached a decision,
          how many are still paying" (in_force / (in_force + lapsed)) — pending
          and never-issued are excluded because they never had the chance to
          lapse. Concentration answers "how much of the paying book sits with one
          carrier", which is the risk that an appointment loss is existential. */}
      {isAdmin && (persistency?.length || concentration?.length) ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {persistency && persistency.length > 0 && (
            <GlassCard className="p-4">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                  <TrendingDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">Persistency by carrier</span>
                </h3>
                <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
                  {persistency.length}
                </span>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                Still in force, of policies that reached a decision — pending
                and never-issued are excluded because they never had a chance to
                lapse.
              </p>
              <ul className="max-h-64 space-y-2 overflow-y-auto">
                {[...persistency]
                  .sort(
                    (a, b) =>
                      Number(a.persistency_pct ?? 0) -
                      Number(b.persistency_pct ?? 0),
                  )
                  .map((row) => {
                    const pct = Number(row.persistency_pct ?? 0);
                    const overall = row.carrier === "__ALL__";
                    const bad = pct < 50;
                    return (
                      <li
                        key={row.carrier}
                        className={cn(
                          "rounded-lg border border-border/60 px-3 py-2.5",
                          overall ? "bg-muted/40" : "bg-card/60",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div
                              className={cn(
                                "truncate text-sm text-foreground",
                                overall ? "font-semibold" : "font-medium",
                              )}
                            >
                              {overall ? "All carriers" : row.carrier}
                            </div>
                            <div className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground">
                              {Number(row.in_force ?? 0).toLocaleString()} in
                              force · {Number(row.lapsed ?? 0).toLocaleString()}{" "}
                              lapsed
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div
                              className={cn(
                                "text-sm font-bold tabular-nums",
                                bad
                                  ? "text-rose-600 dark:text-rose-400"
                                  : "text-emerald-600 dark:text-emerald-400",
                              )}
                            >
                              {pct.toFixed(1)}%
                            </div>
                            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                              still paying
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </GlassCard>
          )}

          {concentration && concentration.length > 0 && (
            <GlassCard className="p-4">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                  <Award className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">Carrier concentration</span>
                </h3>
                <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
                  {concentration.length}
                </span>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                Share of the in-force book — a high share means losing one
                appointment takes that much of the paying book with it.
              </p>
              <ul className="max-h-64 space-y-2 overflow-y-auto">
                {[...concentration]
                  .sort(
                    (a, b) =>
                      Number(b.in_force_alp ?? 0) - Number(a.in_force_alp ?? 0),
                  )
                  .map((row) => {
                    const pct = Number(row.pct_of_in_force_alp ?? 0);
                    const heavy = pct >= 35;
                    return (
                      <li
                        key={`${row.dimension}-${row.name}`}
                        className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">
                              {row.name}
                            </div>
                            <div className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground">
                              {fmt$(Number(row.in_force_alp ?? 0))} in force
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div
                              className={cn(
                                "text-sm font-bold tabular-nums",
                                heavy
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-emerald-600 dark:text-emerald-400",
                              )}
                            >
                              {pct.toFixed(1)}%
                            </div>
                            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                              of book
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              heavy ? "bg-amber-500" : "bg-emerald-500",
                            )}
                            style={{
                              width: `${Math.min(100, Math.max(0, pct))}%`,
                            }}
                          />
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </GlassCard>
          )}
        </div>
      ) : null}

      {/* KPI cards — 6 metrics, per Sam brief */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          icon={<Award className="h-4 w-4" />}
          label="Total Deals"
          value={loading ? "…" : kpi.totalDeals.toLocaleString()}
          tone="neutral"
          sub={
            truth?.deals_this_month != null
              ? `${Number(truth.deals_this_month).toLocaleString()} AgentLink this month`
              : undefined
          }
        />
        <KpiCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Annual Premium"
          value={loading ? "…" : fmt$(kpi.totalALP)}
          tone="neutral"
          sub={
            truth?.premium_this_month != null
              ? `${fmt$(Number(truth.premium_this_month))} AgentLink this month`
              : undefined
          }
        />
        <KpiCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Monthly Premium"
          value={loading ? "…" : fmt$(kpi.totalMonthly)}
          tone="neutral"
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Avg Per Deal"
          value={loading ? "…" : fmt$(kpi.avgPerDeal)}
          tone="neutral"
        />
        <KpiCard
          icon={<Shield className="h-4 w-4" />}
          label="Active Policies"
          value={loading ? "…" : kpi.activePolicies.toLocaleString()}
          tone="emerald"
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Chargeback Watch"
          value={loading ? "…" : kpi.chargebackWatch.toLocaleString()}
          tone={kpi.chargebackWatch > 0 ? "rose" : "neutral"}
          sub={
            cbWatch
              ? `${fmt$(kpi.chargebackExposure)} est. clawback`
              : `Within ${CHARGEBACK_WINDOW_DAYS}d window`
          }
          onClick={() => setChargebackOpen(true)}
        />
      </div>

      {syncErrors > 0 && (
        <div className="rounded-lg border border-amber-500/35 bg-amber-500/5 p-3 sm:p-4">
          <div className="flex min-w-0 items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="min-w-0 text-sm text-foreground">
              <span className="font-semibold tabular-nums">{syncErrors}</span>{" "}
              deal{syncErrors === 1 ? "" : "s"} have AgentLink sync errors.
              Filter/search by policy or external id before trusting totals.
            </p>
          </div>
        </div>
      )}

      {/* Filters row + sort */}
      <GlassCard className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agent, client, policy, carrier…"
              className="h-10 pl-9 sm:h-9"
            />
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-10 sm:h-9">
                <Filter className="mr-1.5 h-4 w-4" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge
                    variant="outline"
                    className="ml-2 border-primary/30 bg-primary/10 text-[10px] font-bold tabular-nums text-primary"
                  >
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] space-y-3 overflow-y-auto p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-foreground">
                  Filters
                </h4>
                {activeFilterCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 shrink-0 text-xs sm:h-9"
                    onClick={resetFilters}
                  >
                    <X className="mr-1 h-4 w-4" />
                    Clear all
                  </Button>
                )}
              </div>
              <FilterField label="Agent">
                <Input
                  value={agentFilter}
                  onChange={(e) => setAgentFilter(e.target.value)}
                  placeholder="Agent name"
                  className="h-10 text-xs sm:h-9"
                />
              </FilterField>
              <FilterField label="Client">
                <Input
                  value={clientFilter}
                  onChange={(e) => setClientFilter(e.target.value)}
                  placeholder="Client name"
                  className="h-10 text-xs sm:h-9"
                />
              </FilterField>
              <FilterField label="Policy #">
                <Input
                  value={policyFilter}
                  onChange={(e) => setPolicyFilter(e.target.value)}
                  placeholder="Policy number"
                  className="h-10 text-xs sm:h-9"
                />
              </FilterField>
              <FilterField label="Carrier">
                <Input
                  value={carrierFilter}
                  onChange={(e) => setCarrierFilter(e.target.value)}
                  placeholder="Carrier name"
                  className="h-10 text-xs sm:h-9"
                />
              </FilterField>
              <FilterField label="Product">
                <Input
                  value={productFilter}
                  onChange={(e) => setProductFilter(e.target.value)}
                  placeholder="Product"
                  className="h-10 text-xs sm:h-9"
                />
              </FilterField>
              <div className="grid grid-cols-2 gap-2">
                <FilterField label="Source">
                  <Select
                    value={sourceFilter}
                    onValueChange={(v) => setSource(v as any)}
                  >
                    <SelectTrigger className="h-10 text-xs sm:h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="apex">APEX</SelectItem>
                      <SelectItem value="agent_link">AgentLink</SelectItem>
                      <SelectItem value="ethos">Ethos</SelectItem>
                    </SelectContent>
                  </Select>
                </FilterField>
                <FilterField label="Stage">
                  <Select
                    value={stageFilter}
                    onValueChange={(v) => setStage(v as any)}
                  >
                    <SelectTrigger className="h-10 text-xs sm:h-9">
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
                    className="h-10 text-xs sm:h-9"
                    max={postedUntil || undefined}
                  />
                  <span className="text-xs text-muted-foreground">→</span>
                  <Input
                    type="date"
                    value={postedUntil}
                    onChange={(e) => setPostedUntil(e.target.value)}
                    className="h-10 text-xs sm:h-9"
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
            <SelectTrigger className="h-10 w-full sm:h-9 sm:w-[190px]">
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

        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-border/60 pt-3 text-xs">
          <div className="min-w-0 tabular-nums text-muted-foreground">
            {loading ? (
              <span>Loading full book of business…</span>
            ) : (
              <>
                Showing{" "}
                <span className="font-bold tabular-nums text-foreground">
                  {filtered.length.toLocaleString()}
                </span>
                <span> of </span>
                <span className="font-bold tabular-nums text-foreground">
                  {(dealsSourceCount ?? deals.length).toLocaleString()}
                </span>
                <span> deals</span>
                {dealsSourceCount != null &&
                  dealsSourceCount > deals.length && (
                    <span
                      className="ml-2 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400"
                      title={`Client fetch is capped at ${AGENTLINK_SNAPSHOT_ROW_CAP.toLocaleString()} rows per load. ${(dealsSourceCount - deals.length).toLocaleString()} rows exist in the database but are not in the table below. Narrow filters to see the rest.`}
                    >
                      · capped (
                      {(dealsSourceCount - deals.length).toLocaleString()} more
                      in DB)
                    </span>
                  )}
              </>
            )}
          </div>
          {truth?.last_synced_at && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              Synced{" "}
              {formatDistanceToNowStrict(new Date(truth.last_synced_at), {
                addSuffix: true,
              })}
            </span>
          )}
        </div>
      </GlassCard>

      {/* Table */}
      <GlassCard className="overflow-hidden p-4">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2 text-left">Client</th>
                <th className="px-2 py-2 text-left">Agent</th>
                <th className="px-2 py-2 text-left">Policy #</th>
                <th className="px-2 py-2 text-left">Product</th>
                <th className="px-2 py-2 text-left">Carrier</th>
                <th className="px-2 py-2 text-right">Monthly</th>
                <th className="px-2 py-2 text-right">ALP</th>
                <th className="px-2 py-2 text-left">Effective Date</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  // stable-key-allow:skeleton-loader-static-length-array
                  <tr key={i} className="border-b border-border/60">
                    {Array.from({ length: 10 }).map((__, j) => (
                      <td key={j} className="px-2 py-2">
                        <div className="h-5 animate-pulse rounded bg-muted/30" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-2 py-4">
                    <EmptyState
                      icon={<Book className="h-7 w-7" />}
                      variant={deals.length === 0 ? "warning" : "default"}
                      title={
                        deals.length === 0
                          ? "No deals came back"
                          : "Filters are hiding the book"
                      }
                      description={
                        deals.length === 0
                          ? "Zero rows returned for your scope. The book is not empty until the sync and your AgentLink mapping both check out."
                          : `Fetched ${deals.length.toLocaleString()} deals from the database. Nothing in the book matches the current filter set.`
                      }
                      actions={
                        deals.length === 0 ? (
                          <ul className="max-w-md list-disc space-y-1 pl-5 text-left text-xs leading-relaxed text-muted-foreground">
                            <li>
                              Agent has no AgentLink user mapping (al_user_id
                              NULL)
                            </li>
                            <li>Your session expired (log out + back in)</li>
                            <li>
                              AgentLink sync is dark — check /dashboard/finances
                              · CFO bot
                            </li>
                          </ul>
                        ) : (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={resetFilters}
                            className="h-10 sm:h-9"
                          >
                            Clear all filters · show{" "}
                            {deals.length.toLocaleString()} deals
                          </Button>
                        )
                      }
                      className="border-0 bg-transparent px-4 py-8 dark:bg-transparent"
                    />
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
                        "border-b border-border/60 transition-colors hover:bg-muted/30",
                        isReviewed && "opacity-60",
                      )}
                    >
                      <td className="max-w-[240px] px-2 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedDeal(d)}
                            className="inline-flex min-w-0 items-center gap-1.5 rounded-sm text-left text-sm font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                          >
                            <Eye className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">
                              {d.client_first_name} {d.client_last_name}
                            </span>
                          </button>
                          {inCbWindow && (
                            <Badge
                              variant="outline"
                              className="shrink-0 gap-0.5 border-rose-500/35 bg-rose-500/10 px-1.5 py-0 text-[10px] font-bold tabular-nums text-rose-600 dark:text-rose-400"
                            >
                              <AlertTriangle className="h-2.5 w-2.5" />
                              {daysEff}d
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="max-w-[180px] px-2 py-2">
                        {d.agent_id ? (
                          <AgentNameLink
                            agentId={d.agent_id}
                            variant="bare"
                            className="text-sm"
                          >
                            <span className="block truncate text-sm text-muted-foreground decoration-dotted underline-offset-2 transition-colors hover:text-primary hover:underline">
                              {d.agent_name}
                            </span>
                          </AgentNameLink>
                        ) : (
                          <span className="block truncate text-sm text-muted-foreground">
                            {d.agent_name}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[140px] px-2 py-2">
                        <div className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                          {d.policy_number}
                        </div>
                      </td>
                      <td className="max-w-[160px] px-2 py-2">
                        <div className="truncate text-sm text-foreground">
                          {d.product_sold}
                        </div>
                      </td>
                      <td className="max-w-[160px] px-2 py-2">
                        <div className="truncate text-sm text-muted-foreground">
                          {d.carrier_name}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right text-sm font-semibold tabular-nums text-muted-foreground">
                        {d.monthly_premium
                          ? fmt$(Number(d.monthly_premium))
                          : "—"}
                      </td>
                      <td className="px-2 py-2 text-right text-sm font-bold tabular-nums text-foreground">
                        {d.annual_premium
                          ? fmt$(Number(d.annual_premium))
                          : "—"}
                      </td>
                      <td className="px-2 py-2 text-[11px] text-muted-foreground">
                        {posted ? (
                          <div className="min-w-0">
                            <div className="truncate tabular-nums">
                              {formatDistanceToNowStrict(new Date(posted), {
                                addSuffix: true,
                              })}
                            </div>
                            <div className="mt-0.5 truncate text-[10px] tabular-nums">
                              {postedIsFallback ? "Synced " : ""}
                              {format(new Date(posted), "MMM d, yyyy")}
                            </div>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "px-2 py-0 text-[10px] font-bold",
                            STAGE_COLORS[pipelineStageKey(d)] ?? STAGE_NEUTRAL,
                          )}
                        >
                          {stageDisplayLabel(d)}
                        </Badge>
                        {d.insuracloud_sync_error && (
                          <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                            sync issue
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-10 w-10 sm:h-9 sm:w-9"
                              aria-label="Row actions"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                              Actions
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                              onClick={() => setSelectedDeal(d)}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              View policy
                            </DropdownMenuItem>
                            {sourceKey(d.source) !== "ethos" && (
                              <DropdownMenuItem
                                onClick={() => openAgentLink(d)}
                              >
                                <ExternalLink className="mr-2 h-4 w-4" />
                                Open AgentLink
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => markReviewed(d.id)}
                              disabled={isReviewed}
                            >
                              <CheckCircle2 className="mr-2 h-4 w-4" />
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
        exposure={kpi.chargebackExposure}
        cbWatch={cbWatch}
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
  tone: "neutral" | "emerald" | "rose";
  onClick?: () => void;
}) {
  // Severity is the only reason a headline number is coloured. Everything
  // that is just "a number" stays foreground so the two that mean something
  // (book still paying / money at risk) are the ones the eye lands on.
  const valueTone =
    tone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "rose"
        ? "text-rose-600 dark:text-rose-400"
        : "text-foreground";
  const inner = (
    <>
      <div className="mb-2 flex items-center gap-2">
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <div
        className={cn(
          "text-2xl font-bold leading-none tabular-nums",
          valueTone,
        )}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-1 truncate text-[11px] tabular-nums text-muted-foreground">
          {sub}
        </div>
      )}
    </>
  );
  if (onClick) {
    return (
      <GlassCard className="min-w-0 p-0" hoverEffect>
        <button
          type="button"
          onClick={onClick}
          className="w-full rounded-md p-4 text-left focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
        >
          {inner}
        </button>
      </GlassCard>
    );
  }
  return <GlassCard className="min-w-0 p-4">{inner}</GlassCard>;
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
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
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
      setTimeline((data as unknown as ContactLogRow[] | null) ?? []);
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
    <Sheet open={Boolean(deal)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[560px] overflow-y-auto"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="min-w-0 break-words">
            {deal.client_first_name} {deal.client_last_name}
          </SheetTitle>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <Badge
              variant="outline"
              className={cn(
                "px-2 py-0 text-[10px] font-bold",
                STAGE_COLORS[pipelineStageKey(deal)] ?? STAGE_NEUTRAL,
              )}
            >
              {stageDisplayLabel(deal)}
            </Badge>
            {deal.policy_number && (
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                #{deal.policy_number}
              </span>
            )}
            {deal.carrier_name && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                  {deal.carrier_name}
                </span>
              </>
            )}
          </div>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* 1. Client info */}
          <DrawerSection title="Client">
            <DrawerRow
              label="Name"
              value={`${deal.client_first_name ?? ""} ${deal.client_last_name ?? ""}`.trim()}
            />
            <DrawerRow
              label="Pipeline Client ID"
              value={deal.pipeline_client_id}
            />
            {sourceKey(deal.source) === "ethos" && (
              <>
                <DrawerRow label="Address" value={deal.client_address} />
                <DrawerRow label="Phone" value={deal.client_phone} />
                <DrawerRow
                  label="Date of Birth"
                  value={
                    deal.client_dob
                      ? format(
                          new Date(`${deal.client_dob}T12:00:00`),
                          "MMM d, yyyy",
                        )
                      : null
                  }
                />
              </>
            )}
          </DrawerSection>

          {/* 2. Agent */}
          <DrawerSection title="Agent">
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
          <DrawerSection title="Policy">
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
              value={formatCurrency(
                deal.face_amount ??
                  ((client as any)?.face_amount as number | null),
              )}
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
            <DrawerRow label="Source" value={sourceLabel(deal.source)} />
            {sourceKey(deal.source) === "ethos" && deal.source_file_name && (
              <DrawerRow label="Import File" value={deal.source_file_name} />
            )}
          </DrawerSection>

          {/* 8. Chargeback window */}
          <DrawerSection title="Chargeback Window">
            {daysEff == null ? (
              <p className="col-span-full text-xs leading-relaxed text-muted-foreground">
                No effective date — cannot compute chargeback window.
              </p>
            ) : inCbWindow ? (
              <>
                <DrawerRow label="Days in-force" value={`${daysEff}d`} />
                <DrawerRow
                  label="Days until safe"
                  value={
                    <span className="font-bold tabular-nums text-rose-600 dark:text-rose-400">
                      {cbDaysRemaining}d remaining
                    </span>
                  }
                />
                <div className="col-span-full flex items-start gap-2 rounded-lg border border-rose-500/35 bg-rose-500/5 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                  <p className="min-w-0 text-xs leading-relaxed text-foreground">
                    Inside the {CHARGEBACK_WINDOW_DAYS}-day chargeback risk
                    window. Confirm payment posted at carrier.
                  </p>
                </div>
              </>
            ) : (
              <p className="col-span-full flex items-center gap-2 text-xs leading-relaxed text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="tabular-nums">{daysEff}d</span> in-force —
                  cleared the {CHARGEBACK_WINDOW_DAYS}-day cliff.
                </span>
              </p>
            )}
          </DrawerSection>

          {/* 9. Timeline */}
          <DrawerSection title="Timeline">
            {timelineLoading ? (
              <div className="col-span-full space-y-2">
                {[...Array(3)].map((_, i) => (
                  // stable-key-allow:skeleton — static Array(N) decorative loader, no reorder
                  <div key={i} className="h-[52px] animate-pulse rounded-lg bg-muted/30" />
                ))}
              </div>
            ) : timeline.length === 0 ? (
              <p className="col-span-full text-xs leading-relaxed text-muted-foreground">
                No contact log entries for this policy.
              </p>
            ) : (
              <ul className="col-span-full space-y-2">
                {timeline.map((t) => (
                  <li
                    key={t.id}
                    className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {t.channel ?? "log"}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                        {t.logged_at
                          ? format(new Date(t.logged_at), "MMM d, yyyy HH:mm")
                          : "—"}
                      </span>
                    </div>
                    {t.outcome && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {t.outcome}
                      </div>
                    )}
                    {t.notes && (
                      <div className="mt-1 break-words text-[11px] leading-relaxed text-foreground">
                        {t.notes}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </DrawerSection>

          {/* 10. Notes */}
          {(client?.communication_notes ||
            client?.reminder_notes ||
            client?.medical_notes ||
            client?.objectives) && (
            <DrawerSection title="Notes">
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
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Loading full client profile
              </p>
              <div className="h-[76px] animate-pulse rounded-lg bg-muted/30" />
            </div>
          )}

          {isAdmin && (client?.bank_name || client?.bank_account_number) && (
            <DrawerSection title="Banking · Admin only">
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
            <DrawerSection title="Financial Profile">
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

          {/* 11. Source action */}
          <div className="flex gap-2 pt-2">
            {sourceKey(deal.source) !== "ethos" && (
              <Button
                className="h-10 flex-1 sm:h-9"
                onClick={() => onOpenAgentLink(deal)}
              >
                <ExternalLink className="mr-1.5 h-4 w-4" />
                Open AgentLink
              </Button>
            )}
            <Button
              variant="outline"
              className={cn(
                "h-10 sm:h-9",
                sourceKey(deal.source) === "ethos" && "flex-1",
              )}
              onClick={onClose}
            >
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
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
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
  if (value === null || value === undefined || value === "" || value === false)
    return null;
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 break-words text-sm font-medium tabular-nums text-foreground">
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
  exposure,
  cbWatch,
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
  exposure: number;
  cbWatch: ChargebackWatchRow[] | null;
  deals: DealRow[];
}) {
  // The KPI was repointed to v_chargeback_watch in PR #20 but this list was not, so the
  // headline said 9 while the list underneath still showed all 252 policies inside a
  // 30-day effective-date window — 243 of them healthy active business. Tapping a
  // corrected number must not open the uncorrected list.
  //
  // Ranked by est_clawback_exposure (unearned advance), so the top of the list is the
  // money most at risk, not merely the most recent policy.
  const atRisk = useMemo(() => {
    if (!cbWatch) return null;
    return [...cbWatch]
      .filter((c) => Number(c.priority ?? 9) === 1)
      .sort(
        (a, b) =>
          Number(b.est_clawback_exposure ?? 0) -
          Number(a.est_clawback_exposure ?? 0),
      );
  }, [cbWatch]);

  // Only used if v_chargeback_watch is unavailable; clearly labelled when it happens.
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
          <SheetTitle className="flex min-w-0 items-center gap-2">
            <TrendingDown className="h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
            <span className="truncate">Chargeback Watch</span>
          </SheetTitle>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Two lenses: active {CHARGEBACK_WINDOW_DAYS}-day cliff window (right
            now) and historical chargebacks (period picker).
          </p>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* Active risk window */}
          <div className="space-y-2">
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {atRisk
                ? "Closest to chargeback"
                : `Active ${CHARGEBACK_WINDOW_DAYS}-day window`}
            </h3>
            <div className="rounded-lg border border-rose-500/35 bg-rose-500/5 p-3 sm:p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
                <div className="min-w-0">
                  <div className="text-2xl font-bold leading-none tabular-nums text-rose-600 dark:text-rose-400">
                    {activeWatch.toLocaleString()}
                  </div>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {atRisk
                      ? "Policies signalling lapse"
                      : "Policies still in cliff window"}
                  </div>
                  {atRisk && exposure > 0 && (
                    <div className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                      <span className="font-semibold text-rose-600 dark:text-rose-400">
                        {fmt$(exposure)}
                      </span>{" "}
                      estimated unearned advance at risk
                    </div>
                  )}
                </div>
              </div>
            </div>

            {atRisk ? (
              <ul className="max-h-[240px] space-y-2 overflow-y-auto">
                {atRisk.slice(0, 50).map((c) => (
                  <li
                    key={c.deal_key ?? `${c.policy_number}-${c.client_name}`}
                    className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {c.client_name || "—"}
                          {c.policy_number && (
                            <span className="ml-2 font-mono text-[10px] tabular-nums text-muted-foreground">
                              #{c.policy_number}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {c.agent_name || "—"} · {c.carrier || "—"} ·{" "}
                          {c.status || "—"}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400">
                          {fmt$(Number(c.est_clawback_exposure ?? 0))}
                        </div>
                        <div className="text-[10px] font-bold uppercase tracking-wide tabular-nums text-muted-foreground">
                          {Number(c.months_in_force ?? 0).toFixed(1)}mo in force
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
                {atRisk.length === 0 && (
                  <li className="flex items-center gap-2 text-xs leading-relaxed text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span className="min-w-0">
                      Nothing is signalling lapse inside the advance window
                      right now.
                    </span>
                  </li>
                )}
              </ul>
            ) : (
              <ul className="max-h-[240px] space-y-2 overflow-y-auto">
                {inWindow.slice(0, 50).map((d) => {
                  const daysEff = daysSinceEffective(d);
                  return (
                    <li
                      key={d.id}
                      className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {d.client_first_name} {d.client_last_name}
                            {d.policy_number && (
                              <span className="ml-2 font-mono text-[10px] tabular-nums text-muted-foreground">
                                #{d.policy_number}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {d.agent_name} · {d.carrier_name || "—"} · Eff{" "}
                            {d.effective_date
                              ? format(new Date(d.effective_date), "MMM d")
                              : "—"}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400">
                            {daysEff}d in
                          </div>
                          <div className="text-[10px] font-bold uppercase tracking-wide tabular-nums text-muted-foreground">
                            {d.annual_premium
                              ? fmt$(Number(d.annual_premium))
                              : "—"}{" "}
                            ALP
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
                {inWindow.length === 0 && (
                  <li className="flex items-center gap-2 text-xs leading-relaxed text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span className="min-w-0">
                      No policies in the active chargeback window. Book is
                      clean.
                    </span>
                  </li>
                )}
              </ul>
            )}
            {!atRisk && (
              <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                Showing the effective-date window because the chargeback-watch
                view did not load. That list counts healthy new business too —
                treat it as a rough proxy, not the real risk list.
              </p>
            )}
          </div>

          {/* Historical chargebacks */}
          <div className="space-y-2">
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Historical chargebacks
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={cbSince}
                onChange={(e) => setCbSince(e.target.value)}
                className="h-10 w-full text-xs sm:h-9 sm:w-[140px]"
                max={cbUntil}
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={cbUntil}
                onChange={(e) => setCbUntil(e.target.value)}
                className="h-10 w-full text-xs sm:h-9 sm:w-[140px]"
                min={cbSince}
                max={format(new Date(), "yyyy-MM-dd")}
              />
              <div className="flex gap-1 ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10 text-xs sm:h-9"
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
                  className="h-10 text-xs sm:h-9"
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
                  className="h-10 text-xs sm:h-9"
                  onClick={() => {
                    setCbSince(format(subDays(new Date(), 365), "yyyy-MM-dd"));
                    setCbUntil(format(new Date(), "yyyy-MM-dd"));
                  }}
                >
                  YTD
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="min-w-0 rounded-lg border border-border bg-card p-3">
                <div className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Count
                </div>
                <div className="mt-1 text-2xl font-bold leading-none tabular-nums text-rose-600 dark:text-rose-400">
                  {cbLoading ? "…" : chargebacks.length}
                </div>
              </div>
              <div className="min-w-0 rounded-lg border border-border bg-card p-3">
                <div className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Monthly
                </div>
                <div className="mt-1 text-2xl font-bold leading-none tabular-nums text-rose-600 dark:text-rose-400">
                  {cbLoading ? "…" : fmt$(cbTotalMonthly)}
                </div>
              </div>
              <div className="min-w-0 rounded-lg border border-border bg-card p-3">
                <div className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  ALP
                </div>
                <div className="mt-1 text-2xl font-bold leading-none tabular-nums text-rose-600 dark:text-rose-400">
                  {cbLoading ? "…" : fmt$(cbTotalALP)}
                </div>
              </div>
            </div>

            <ul className="max-h-[280px] space-y-2 overflow-y-auto">
              {!cbLoading && chargebacks.length === 0 && (
                <li className="text-xs leading-relaxed text-muted-foreground">
                  No chargebacks in this range. Widen the window if you expect
                  older ones.
                </li>
              )}
              {chargebacks.map((c) => (
                <li
                  key={c.id}
                  className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {c.client_first_name} {c.client_last_name}
                        {c.policy_number && (
                          <span className="ml-2 font-mono text-[10px] tabular-nums text-muted-foreground">
                            #{c.policy_number}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {c.agent_name} · {c.carrier_name || "—"} ·{" "}
                        {c.status_updated_at
                          ? format(new Date(c.status_updated_at), "MMM d, yyyy")
                          : "—"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400">
                        {c.monthly_premium
                          ? fmt$(Number(c.monthly_premium))
                          : "—"}
                        /mo
                      </div>
                      <div className="text-[10px] font-bold uppercase tracking-wide tabular-nums text-muted-foreground">
                        {c.annual_premium
                          ? fmt$(Number(c.annual_premium))
                          : "—"}{" "}
                        ALP
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
