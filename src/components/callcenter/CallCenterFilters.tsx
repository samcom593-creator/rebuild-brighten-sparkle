import { useMemo, useState } from "react";
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

interface QueuePreviewStats {
  matching: number;
  oldest: { name: string; ageDays: number } | null;
  newest: { name: string; ageDays: number } | null;
  licensed: number;
  unlicensed: number;
  aged: number;
  noContact: number;
}

function dateRangeToIso(range: DateRangeFilter): string | null {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  switch (range) {
    case "last_7": return new Date(now - 7 * day).toISOString();
    case "last_30": return new Date(now - 30 * day).toISOString();
    case "last_90": return new Date(now - 90 * day).toISOString();
    default: return null;
  }
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000)));
}

function usePreviewStats(filters: {
  sourceFilter: SourceFilter;
  licenseFilter: LicenseFilter;
  statusFilter: StatusFilter;
  progressFilter: ProgressFilter;
  refererFilter: RefererFilter;
  dateRangeFilter: DateRangeFilter;
  ownerFilter: OwnerFilter;
  stateFilter: StateFilter;
  enabled: boolean;
}) {
  return useQuery<QueuePreviewStats>({
    queryKey: ["mp260-callcenter-preview", filters],
    enabled: filters.enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const sinceIso = dateRangeToIso(filters.dateRangeFilter);
      const rows: Array<{
        id: string;
        first_name: string | null;
        last_name: string | null;
        created_at: string | null;
        license_status: string | null;
        contacted_at: string | null;
        state: string | null;
        source: "aged_leads" | "applications";
      }> = [];

      if (filters.sourceFilter === "all" || filters.sourceFilter === "applications") {
        let q: any = supabase
          .from("applications")
          .select("id, first_name, last_name, created_at, license_status, contacted_at, state, assigned_agent_id, referral_manager_id, terminated_at, contracted_at, closed_at, license_progress")
          .is("terminated_at", null)
          .is("contracted_at", null)
          .is("closed_at", null)
          .limit(500);
        if (sinceIso) q = q.gte("created_at", sinceIso);
        if (filters.licenseFilter !== "all") q = q.eq("license_status", filters.licenseFilter);
        if (filters.progressFilter !== "all") q = q.eq("license_progress", filters.progressFilter);
        if (filters.statusFilter === "new") q = q.is("contacted_at", null);
        if (filters.statusFilter === "contacted") q = q.not("contacted_at", "is", null);
        if (filters.stateFilter && filters.stateFilter !== "all") q = q.eq("state", filters.stateFilter);
        if (filters.ownerFilter === "unassigned") {
          q = q.is("assigned_agent_id", null).is("referral_manager_id", null);
        } else if (filters.ownerFilter && filters.ownerFilter !== "all") {
          q = q.or(`assigned_agent_id.eq.${filters.ownerFilter},referral_manager_id.eq.${filters.ownerFilter}`);
        }
        const { data } = await q;
        for (const r of (data ?? []) as any[]) {
          rows.push({
            id: r.id,
            first_name: r.first_name,
            last_name: r.last_name,
            created_at: r.created_at,
            license_status: r.license_status,
            contacted_at: r.contacted_at,
            state: r.state,
            source: "applications",
          });
        }
      }

      if (filters.sourceFilter === "all" || filters.sourceFilter === "aged_leads") {
        let q: any = supabase
          .from("aged_leads")
          .select("id, first_name, last_name, created_at, license_status, contacted_at, assigned_manager_id")
          .limit(500);
        if (sinceIso) q = q.gte("created_at", sinceIso);
        if (filters.licenseFilter !== "all") q = q.eq("license_status", filters.licenseFilter);
        if (filters.statusFilter === "new") q = q.is("contacted_at", null);
        if (filters.statusFilter === "contacted") q = q.not("contacted_at", "is", null);
        if (filters.ownerFilter === "unassigned") q = q.is("assigned_manager_id", null);
        else if (filters.ownerFilter && filters.ownerFilter !== "all") q = q.eq("assigned_manager_id", filters.ownerFilter);
        const { data } = await q;
        for (const r of (data ?? []) as any[]) {
          rows.push({
            id: r.id,
            first_name: r.first_name,
            last_name: r.last_name,
            created_at: r.created_at,
            license_status: r.license_status,
            contacted_at: r.contacted_at,
            state: null,
            source: "aged_leads",
          });
        }
      }

      const sorted = [...rows].sort((a, b) => {
        const ta = new Date(a.created_at ?? 0).getTime();
        const tb = new Date(b.created_at ?? 0).getTime();
        return ta - tb;
      });
      const oldestRow = sorted[0];
      const newestRow = sorted[sorted.length - 1];

      let licensed = 0;
      let unlicensed = 0;
      let aged = 0;
      let noContact = 0;
      for (const r of rows) {
        if ((r.license_status ?? "").toLowerCase() === "licensed") licensed++;
        else unlicensed++;
        if (r.source === "aged_leads") aged++;
        if (!r.contacted_at) noContact++;
      }

      const nameOf = (r: typeof oldestRow) =>
        `${(r?.first_name ?? "").trim()} ${(r?.last_name ?? "").trim()}`.trim() || "Unnamed";

      return {
        matching: rows.length,
        oldest: oldestRow ? { name: nameOf(oldestRow), ageDays: daysSince(oldestRow.created_at) } : null,
        newest: newestRow ? { name: nameOf(newestRow), ageDays: daysSince(newestRow.created_at) } : null,
        licensed,
        unlicensed,
        aged,
        noContact,
      } satisfies QueuePreviewStats;
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
    blue: "border-sky-500/30 text-sky-300",
    slate: "border-white/10 text-slate-100",
    green: "border-emerald-500/30 text-emerald-300",
  };
  return (
    <div className={cn(
      "rounded-md border p-3 bg-background/60",
      toneMap[tone],
    )}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground truncate" title={hint}>{hint}</div>}
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
}: CallCenterFiltersProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const managersQ = useManagerOptions();
  const previewFilters = useMemo(
    () => ({
      sourceFilter,
      licenseFilter,
      statusFilter,
      progressFilter,
      refererFilter,
      dateRangeFilter,
      ownerFilter,
      stateFilter,
      enabled: true,
    }),
    [sourceFilter, licenseFilter, statusFilter, progressFilter, refererFilter, dateRangeFilter, ownerFilter, stateFilter],
  );
  const previewQ = usePreviewStats(previewFilters);
  const stats = previewQ.data;

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
          className="text-2xl font-bold mb-1 text-slate-100"
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
            className="flex items-center gap-2 text-slate-100 font-semibold"
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
                    <SelectTrigger className="bg-background/50 border-white/10 hover:border-teal-500/40 transition-colors">
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
          <motion.div variants={itemVariants} className="border-t border-white/10 pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-slate-100 font-semibold text-sm">
                <Eye className="h-4 w-4 text-teal-300" />
                Queue Preview
                {previewQ.isFetching && (
                  <span className="text-[11px] text-muted-foreground font-normal">Refreshing…</span>
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

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <PreviewTile
                label="Matching leads"
                value={stats?.matching ?? "—"}
                tone="teal"
              />
              <PreviewTile
                label="Oldest lead"
                value={stats?.oldest ? `${stats.oldest.ageDays}d` : "—"}
                hint={stats?.oldest?.name}
                tone="gold"
              />
              <PreviewTile
                label="Newest lead"
                value={stats?.newest ? `${stats.newest.ageDays}d` : "—"}
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
        <SheetContent side="right" className="w-full sm:max-w-md bg-background border-white/10">
          <SheetHeader>
            <SheetTitle className="text-slate-100">Queue Preview</SheetTitle>
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
                value={stats?.oldest ? `${stats.oldest.ageDays}d` : "—"}
                hint={stats?.oldest?.name}
                tone="gold"
              />
              <PreviewTile
                label="Newest"
                value={stats?.newest ? `${stats.newest.ageDays}d` : "—"}
                hint={stats?.newest?.name}
                tone="blue"
              />
              <PreviewTile label="Licensed" value={stats?.licensed ?? 0} tone="green" />
              <PreviewTile label="Unlicensed" value={stats?.unlicensed ?? 0} tone="rose" />
              <PreviewTile label="Aged leads" value={stats?.aged ?? 0} tone="slate" />
              <PreviewTile label="No-contact" value={stats?.noContact ?? 0} tone="gold" />
            </div>

            <div className="rounded-md border border-white/10 bg-card/60 p-3 text-xs text-muted-foreground">
              <div className="font-medium text-slate-200 mb-1">Filter Summary</div>
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
