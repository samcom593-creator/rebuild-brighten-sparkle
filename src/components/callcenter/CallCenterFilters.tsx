import { useMemo, useState } from "react";
import { applyFilterOps, combineQueuePreview, type FilterOp, type PreviewEdgeLead, type QueuePreview, type QueuePreviewPlans, type SourcePreview } from "@/lib/callCenterQueue";
import { errorMessage } from "@/lib/queryState";
import { motion } from "framer-motion";
import { Phone, Filter, Sparkles, Eye, PlayCircle, Users, Calendar as CalendarIcon, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export type SourceFilter = "all" | "aged_leads" | "applications";
export type LicenseFilter = "all" | "licensed" | "unlicensed";
export type StatusFilter = "new" | "no_pickup" | "contacted";
export type ProgressFilter = "all" | "course_purchased" | "passed_test" | "waiting_on_license";
export type SortOrder = "newest_first" | "oldest_first";
// 2026-05-04 (Sam): "filter whether I'm calling all applicants or applicants
// who applied and marked my name down". `mine` = referred-by-me;
// `no_referrer` = applied without naming anyone (default-routed so they
// can't be poached by other managers' boxes).
export type RefererFilter = "all" | "mine" | "no_referrer";
// MP-260 date range filter — bounds "created_at" to a sliding window.
export type DateRangeFilter = "all" | "last_7" | "last_30" | "last_90";
// MP-260 owner/manager filter — agent id; "all" = every manager;
// "unassigned" = leads with no assigned_manager_id / assigned_agent_id.
export type OwnerFilter = string; // "all" | "unassigned" | uuid
// MP-260 state filter — US 2-char code or "all".
export type StateFilter = string; // "all" | "TX" | "NY" | ...

interface CallCenterFiltersProps {
  sourceFilter: SourceFilter;
  licenseFilter: LicenseFilter;
  statusFilter: StatusFilter;
  progressFilter: ProgressFilter;
  sortOrder: SortOrder;
  refererFilter: RefererFilter;
  dateRangeFilter: DateRangeFilter;
  ownerFilter: OwnerFilter;
  stateFilter: StateFilter;
  onSourceChange: (value: SourceFilter) => void;
  onLicenseChange: (value: LicenseFilter) => void;
  onStatusChange: (value: StatusFilter) => void;
  onProgressChange: (value: ProgressFilter) => void;
  onSortOrderChange: (value: SortOrder) => void;
  onRefererChange: (value: RefererFilter) => void;
  onDateRangeChange: (value: DateRangeFilter) => void;
  onOwnerChange: (value: OwnerFilter) => void;
  onStateChange: (value: StateFilter) => void;
  onStart: () => void;
  disabled?: boolean;
  className?: string;
  /** The queue's own plans for the current filters; null until access is known. */
  previewPlans: QueuePreviewPlans | null;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.05,
    },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
  },
} as const;

const US_STATES: Array<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" }, { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" }, { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" }, { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" }, { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];


function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000)));
}

/**
 * The preview counts exactly what Start Calling will load: the page hands in the
 * queue's own filter plans (src/lib/callCenterQueue.ts), and every figure is an
 * exact head count. A failed count is an error with Retry, never a number.
 */
async function sourcePreview(table: "aged_leads" | "applications", plan: FilterOp[]): Promise<SourcePreview> {
  const head = async (ops: FilterOp[]) => {
    const { count, error } = await applyFilterOps(supabase.from(table).select("id", { count: "exact", head: true }), ops);
    if (error) throw error;
    if (typeof count !== "number") throw new Error(`The ${table === "aged_leads" ? "aged lead" : "application"} count did not come back.`);
    return count;
  };
  const edge = async (ascending: boolean): Promise<PreviewEdgeLead | null> => {
    const { data, error } = await applyFilterOps(supabase.from(table).select("first_name, last_name, created_at"), plan)
      .not("created_at", "is", null)
      .order("created_at", { ascending })
      .limit(1);
    if (error) throw error;
    const row = (data ?? [])[0] as { first_name: string | null; last_name: string | null; created_at: string | null } | undefined;
    if (!row?.created_at) return null;
    const name = `${(row.first_name ?? "").trim()} ${(row.last_name ?? "").trim()}`.trim() || "Unnamed";
    return { name, createdAt: row.created_at };
  };
  const [total, licensed, noContact, oldest, newest] = await Promise.all([
    head(plan),
    head([...plan, { op: "eq", column: "license_status", value: "licensed" }]),
    head([...plan, { op: "is", column: "contacted_at", value: null }]),
    edge(true),
    edge(false),
  ]);
  return { total, licensed, noContact, oldest, newest };
}

function usePreviewStats(plans: QueuePreviewPlans | null) {
  return useQuery<QueuePreview>({
    queryKey: ["mp260-callcenter-preview", plans],
    enabled: plans !== null,
    staleTime: 30_000,
    queryFn: async () => {
      const [aged, apps] = await Promise.all([
        plans?.aged ? sourcePreview("aged_leads", plans.aged) : Promise.resolve(null),
        plans?.apps ? sourcePreview("applications", plans.apps) : Promise.resolve(null),
      ]);
      return combineQueuePreview({ aged, apps });
    },
  });
}

function useManagerOptions() {
  return useQuery<Array<{ id: string; display_name: string }>>({
    queryKey: ["mp260-callcenter-managers"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const q: any = supabase;
      const { data } = await q
        .from("agents")
        .select("id, display_name, is_manager")
        .eq("is_manager", true)
        .order("display_name", { ascending: true });
      return ((data ?? []) as Array<{ id: string; display_name: string | null; is_manager: boolean }>)
        .filter((m) => m.id && m.display_name)
        .map((m) => ({ id: m.id, display_name: m.display_name as string }));
    },
  });
}

interface PreviewTileProps {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "teal" | "gold" | "rose" | "blue" | "slate" | "green";
}

function PreviewTile({ label, value, hint, tone = "slate" }: PreviewTileProps) {
  const toneMap: Record<string, string> = {
    teal: "border-teal-500/30 text-teal-300",
    gold: "border-amber-500/30 text-amber-300",
    rose: "border-rose-500/30 text-rose-300",
    blue: "border-info/30 text-info",
    slate: "border-white/10 text-slate-100",
    green: "border-emerald-500/30 text-emerald-300",
  };
  return (
    <div className={cn(
      "rounded-md border p-3 bg-background/60",
      toneMap[tone],
    )}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {hint && <div className="text-[12px] text-muted-foreground truncate" title={hint}>{hint}</div>}
    </div>
  );
}

export function CallCenterFilters({
  sourceFilter,
  licenseFilter,
  statusFilter,
  progressFilter,
  sortOrder,
  refererFilter,
  dateRangeFilter,
  ownerFilter,
  stateFilter,
  onSourceChange,
  onLicenseChange,
  onStatusChange,
  onProgressChange,
  onSortOrderChange,
  onRefererChange,
  onDateRangeChange,
  onOwnerChange,
  onStateChange,
  onStart,
  disabled,
  className,
  previewPlans,
}: CallCenterFiltersProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const managersQ = useManagerOptions();
  const previewQ = usePreviewStats(previewPlans);
  const stats = previewQ.data;
  const daysOld = (iso: string) => daysSince(iso);

  const filterDefs: Array<{
    label: string;
    icon?: React.ElementType;
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
  }> = [
    {
      label: "Lead Source",
      value: sourceFilter,
      onChange: onSourceChange as (v: string) => void,
      options: [
        { value: "all", label: "All Sources" },
        { value: "aged_leads", label: "Aged Leads" },
        { value: "applications", label: "New Drip-Ins" },
      ],
    },
    {
      label: "Referrer",
      value: refererFilter,
      onChange: onRefererChange as (v: string) => void,
      options: [
        { value: "all", label: "All Applicants" },
        { value: "mine", label: "Marked Me As Referrer" },
        { value: "no_referrer", label: "No Referrer (Unclaimed)" },
      ],
    },
    {
      label: "License Status",
      value: licenseFilter,
      onChange: onLicenseChange as (v: string) => void,
      options: [
        { value: "all", label: "All" },
        { value: "licensed", label: "Licensed" },
        { value: "unlicensed", label: "Unlicensed" },
      ],
    },
    {
      label: "Lead Status",
      value: statusFilter,
      onChange: onStatusChange as (v: string) => void,
      options: [
        { value: "new", label: "New / Uncontacted" },
        { value: "no_pickup", label: "No Pickup (Retry)" },
        { value: "contacted", label: "Contacted" },
      ],
    },
    {
      label: "License Progress",
      value: progressFilter,
      onChange: onProgressChange as (v: string) => void,
      options: [
        { value: "all", label: "All Progress" },
        { value: "course_purchased", label: "Course Purchased" },
        { value: "passed_test", label: "Passed Test" },
        { value: "waiting_on_license", label: "Waiting on License" },
      ],
    },
    {
      label: "Sort Order",
      value: sortOrder,
      onChange: onSortOrderChange as (v: string) => void,
      options: [
        { value: "oldest_first", label: "Late Opt-Ins First (Oldest)" },
        { value: "newest_first", label: "New Opt-Ins First (Newest)" },
      ],
    },
    {
      label: "Date Range",
      icon: CalendarIcon,
      value: dateRangeFilter,
      onChange: onDateRangeChange as (v: string) => void,
      options: [
        { value: "all", label: "All Time" },
        { value: "last_7", label: "Last 7 Days" },
        { value: "last_30", label: "Last 30 Days" },
        { value: "last_90", label: "Last 90 Days" },
      ],
    },
    {
      label: "Owner / Manager",
      icon: Users,
      value: ownerFilter,
      onChange: onOwnerChange as (v: string) => void,
      options: [
        { value: "all", label: "All Managers" },
        { value: "unassigned", label: "Unassigned" },
        ...((managersQ.data ?? []).map((m) => ({ value: m.id, label: m.display_name }))),
      ],
    },
    {
      label: "State",
      icon: MapPin,
      value: stateFilter,
      onChange: onStateChange as (v: string) => void,
      options: [
        { value: "all", label: "All States" },
        ...US_STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` })),
      ],
    },
  ];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className={cn("container max-w-4xl mx-auto py-6 px-4", className)}
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="text-center mb-6">
        <motion.div
          className="relative inline-flex items-center justify-center w-16 h-16 rounded-md bg-card border border-teal-500/30 mb-3"
          whileHover={{ scale: 1.05, rotate: 3 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
        >
          <Phone className="h-8 w-8 text-teal-300" />
          <div className="absolute -top-1 -right-1">
            <Sparkles className="h-4 w-4 text-amber-300" />
          </div>
        </motion.div>

        <motion.h1
          variants={itemVariants}
          className="text-2xl font-bold mb-1 text-foreground"
        >
          Call Center
        </motion.h1>
        <motion.p variants={itemVariants} className="text-sm text-muted-foreground">
          Process leads one at a time with AI-powered note taking
        </motion.p>
      </motion.div>

      {/* Filters Card */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-5 space-y-5 relative overflow-hidden">
          <motion.div
            variants={itemVariants}
            className="flex items-center gap-2 text-foreground font-semibold"
          >
            <Filter className="h-4 w-4 text-teal-300" />
            Configure Filters
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filterDefs.map((filter) => {
              const Icon = filter.icon;
              return (
                <motion.div key={filter.label} variants={itemVariants}>
                  <label className="text-xs font-medium mb-1.5 flex items-center gap-1.5 text-muted-foreground">
                    {Icon && <Icon className="h-3.5 w-3.5" />}
                    {filter.label}
                  </label>
                  <Select value={filter.value} onValueChange={filter.onChange}>
                    <SelectTrigger className="bg-background/50 border-border hover:border-teal-500/40 transition-colors">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {filter.options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </motion.div>
              );
            })}
          </div>

          {/* Queue Preview Panel */}
          <motion.div variants={itemVariants} className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
                <Eye className="h-4 w-4 text-teal-300" />
                Queue Preview
                {previewQ.isFetching && (
                  <span className="text-[12px] text-muted-foreground font-normal">Refreshing…</span>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPreviewOpen(true)}
                aria-label="Open queue preview drawer"
                className="text-xs text-teal-300 hover:text-teal-200 hover:bg-teal-500/10"
              >
                <Eye className="h-3.5 w-3.5 mr-1" />
                Preview Queue
              </Button>
            </div>

            {previewQ.isError && (
              <div role="alert" className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-destructive">Preview unavailable.</span>
                <span className="text-muted-foreground">{errorMessage(previewQ.error)}</span>
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => void previewQ.refetch()}>
                  Retry
                </Button>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <PreviewTile
                label="Matching leads"
                value={stats?.matching ?? "—"}
                tone="teal"
              />
              <PreviewTile
                label="Oldest lead"
                value={stats?.oldest ? `${daysOld(stats.oldest.createdAt)}d` : "—"}
                hint={stats?.oldest?.name}
                tone="gold"
              />
              <PreviewTile
                label="Newest lead"
                value={stats?.newest ? `${daysOld(stats.newest.createdAt)}d` : "—"}
                hint={stats?.newest?.name}
                tone="blue"
              />
              <PreviewTile
                label="Licensed"
                value={stats?.licensed ?? "—"}
                tone="green"
              />
              <PreviewTile
                label="Unlicensed"
                value={stats?.unlicensed ?? "—"}
                tone="rose"
              />
              <PreviewTile
                label="Aged leads"
                value={stats?.aged ?? "—"}
                tone="slate"
              />
              <PreviewTile
                label="No-contact"
                value={stats?.noContact ?? "—"}
                tone="gold"
              />
              <PreviewTile
                label="Est. session"
                value={stats?.matching ? `${Math.max(1, Math.round(stats.matching * 2.5))}m` : "—"}
                hint="2.5 min avg / lead"
                tone="slate"
              />
            </div>
          </motion.div>

          <motion.div variants={itemVariants} className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button
              onClick={onStart}
              disabled={disabled}
              size="lg"
              aria-label="Start calling leads"
              className="flex-1 relative overflow-hidden bg-teal-500 hover:bg-teal-400 text-slate-950 font-semibold shadow-sm"
            >
              <PlayCircle className="h-5 w-5 mr-2" />
              Start Calling
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setPreviewOpen(true)}
              aria-label="Open queue preview drawer"
              className="sm:w-auto border-teal-500/40 text-teal-200 hover:bg-teal-500/10"
            >
              <Eye className="h-4 w-4 mr-2" />
              Preview Queue
            </Button>
          </motion.div>
        </GlassCard>
      </motion.div>

      {/* Keyboard Hints */}
      <motion.p
        variants={itemVariants}
        className="text-xs text-muted-foreground text-center mt-4"
      >
        Keyboard shortcuts inside workflow:{" "}
        <span className="text-muted-foreground">1</span> Hired ·{" "}
        <span className="text-muted-foreground">2</span> Contracted ·{" "}
        <span className="text-muted-foreground">3</span> Not a Fit ·{" "}
        <span className="text-muted-foreground">4</span> No Pickup ·{" "}
        <span className="text-muted-foreground">5</span> Contacted ·{" "}
        <span className="text-muted-foreground">6</span> Reschedule ·{" "}
        <span className="text-muted-foreground">7</span> Bad Number ·{" "}
        <span className="text-muted-foreground">8</span> Follow-Up ·{" "}
        <span className="text-muted-foreground">N</span> Next ·{" "}
        <span className="text-muted-foreground">P</span> Prev ·{" "}
        <span className="text-muted-foreground">ESC</span> Exit
      </motion.p>

      {/* Preview Queue Drawer */}
      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md bg-background border-border">
          <SheetHeader>
            <SheetTitle className="text-foreground">Queue Preview</SheetTitle>
            <SheetDescription className="text-muted-foreground">
              Snapshot of the {stats?.matching ?? 0} leads matching your current filter selection.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <PreviewTile label="Matching leads" value={stats?.matching ?? 0} tone="teal" />
              <PreviewTile
                label="Est. session"
                value={stats?.matching ? `${Math.max(1, Math.round(stats.matching * 2.5))} min` : "—"}
                hint="2.5 min avg / lead"
                tone="slate"
              />
              <PreviewTile
                label="Oldest"
                value={stats?.oldest ? `${daysOld(stats.oldest.createdAt)}d` : "—"}
                hint={stats?.oldest?.name}
                tone="gold"
              />
              <PreviewTile
                label="Newest"
                value={stats?.newest ? `${daysOld(stats.newest.createdAt)}d` : "—"}
                hint={stats?.newest?.name}
                tone="blue"
              />
              <PreviewTile label="Licensed" value={stats?.licensed ?? 0} tone="green" />
              <PreviewTile label="Unlicensed" value={stats?.unlicensed ?? 0} tone="rose" />
              <PreviewTile label="Aged leads" value={stats?.aged ?? 0} tone="slate" />
              <PreviewTile label="No-contact" value={stats?.noContact ?? 0} tone="gold" />
            </div>

            <div className="rounded-md border border-border bg-card/60 p-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground mb-1">Filter Summary</div>
              <ul className="space-y-0.5">
                <li>Source: {sourceFilter.replace("_", " ")}</li>
                <li>Referrer: {refererFilter.replace("_", " ")}</li>
                <li>License: {licenseFilter}</li>
                <li>Status: {statusFilter.replace("_", " ")}</li>
                <li>Progress: {progressFilter.replace("_", " ")}</li>
                <li>Sort: {sortOrder.replace("_", " ")}</li>
                <li>Date: {dateRangeFilter.replace("_", " ")}</li>
                <li>Owner: {ownerFilter === "all" ? "all managers" : ownerFilter === "unassigned" ? "unassigned" : (managersQ.data ?? []).find((m) => m.id === ownerFilter)?.display_name ?? "custom"}</li>
                <li>State: {stateFilter}</li>
              </ul>
            </div>

            <Button
              onClick={() => {
                setPreviewOpen(false);
                onStart();
              }}
              disabled={disabled || !stats?.matching}
              className="w-full bg-teal-500 hover:bg-teal-400 text-slate-950 font-semibold"
              aria-label="Start calling leads from preview"
            >
              <PlayCircle className="h-4 w-4 mr-2" />
              Start Calling
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </motion.div>
  );
}
