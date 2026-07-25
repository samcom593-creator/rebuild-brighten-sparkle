import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Phone,
  MessageCircle,
  Mail,
  Send,
  UserCheck,
  Snowflake,
  Flame,
  Clock,
  ArrowRight,
  Ghost,
  RefreshCw,
  EyeOff,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Staleness = "fresh" | "stale" | "icy" | "cold";

interface StaleRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  license_status: string;
  status: string;
  assigned_agent_id: string | null;
  instagram_handle: string | null;
  created_at: string;
  hours_since_application: number;
  staleness: Staleness;
  assigned_manager_name: string | null;
  assigned_manager_avatar: string | null;
}

/** v_queue_stalled_applications — the wider stalled definition (last_action_at based, no 60-day cap). */
interface QueueStalledRow {
  application_id: string;
  applicant: string | null;
  app_status: string | null;
  next_step_stage_key: string | null;
  license_status: string | null;
  owner: string | null;
  recruiter_id: string | null;
  assigned_agent_id: string | null;
  last_action_at: string | null;
  next_action: string | null;
  due_at: string | null;
  days_stuck: number | null;
  priority: number | null;
  is_ghosted: boolean | null;
  lead_score: number | null;
  created_at: string | null;
}

/** Contact details pulled from applications so surfaced rows are workable, not just visible. */
interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  instagram_handle: string | null;
  contacted_at: string | null;
  created_at: string | null;
}

type RowGroup = "working" | "surfaced";
type RecoveryAction = "mark_contacted" | "ghost" | "dismiss";

/** Why the working list could not see this row. Null when contact details did not load. */
type SurfacedReason = "contacted" | "outside-window" | "status" | "other";

/** Normalised row both sources render through — one row component, no parallel UI. */
interface RecoveryRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  licenseStatus: string | null;
  instagramHandle: string | null;
  managerName: string | null;
  nextAction: string | null;
  ageLabel: string;
  staleness: Staleness;
  group: RowGroup;
  reason: SurfacedReason | null;
}

const stalenessConfig: Record<Staleness, { label: string; cls: string; icon: any }> = {
  fresh: { label: "Fresh", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: Flame },
  stale: { label: "Stale (24h)", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30", icon: Clock },
  icy:   { label: "Icy (72h+)", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30", icon: Snowflake },
  cold:  { label: "Cold (7d+)", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30", icon: Snowflake },
};

/** Statuses v_stale_applicants drops outright. */
const WORKING_LIST_EXCLUDED_STATUSES = new Set([
  "paid",
  "approved",
  "rejected",
  "disqualified",
  "attended",
  "producing",
]);

/** v_stale_applicants only reaches back 60 days. */
const WORKING_LIST_WINDOW_DAYS = 60;

const REASON_LABELS: Record<SurfacedReason, string> = {
  contacted: "Contacted once, then went quiet",
  "outside-window": "Older than the 60-day working window",
  status: "Status excluded from the working list",
  other: "Other — outside the working list rules",
};

/** Same thresholds v_stale_applicants uses, so both groups bucket identically. */
function bucketFor(hours: number): Staleness {
  if (hours > 168) return "cold";
  if (hours > 72) return "icy";
  if (hours >= 24) return "stale";
  return "fresh";
}

function splitName(full: string | null): { first: string; last: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function fromStale(r: StaleRow): RecoveryRow {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    phone: r.phone,
    city: r.city,
    state: r.state,
    licenseStatus: r.license_status,
    instagramHandle: r.instagram_handle,
    managerName: r.assigned_manager_name,
    nextAction: null,
    ageLabel: `${Math.round(r.hours_since_application)}h since apply`,
    staleness: r.staleness,
    group: "working",
    reason: null,
  };
}

function reasonFor(q: QueueStalledRow, contact: ContactRow | undefined): SurfacedReason | null {
  if (!contact) return null;
  if (contact.contacted_at) return "contacted";
  const created = contact.created_at ?? q.created_at;
  if (created) {
    // Clamped at 0: a future-dated created_at must never render a negative age.
  const ageDays = Math.max(0, (Date.now() - new Date(created).getTime()) / 86_400_000);
    if (ageDays > WORKING_LIST_WINDOW_DAYS) return "outside-window";
  }
  if (q.app_status && WORKING_LIST_EXCLUDED_STATUSES.has(q.app_status)) return "status";
  return "other";
}

function fromQueue(q: QueueStalledRow, contact: ContactRow | undefined): RecoveryRow {
  const fallback = splitName(q.applicant);
  const days = Number(q.days_stuck ?? 0);
  return {
    id: q.application_id,
    firstName: contact?.first_name || fallback.first,
    lastName: contact?.last_name || fallback.last,
    email: contact?.email ?? null,
    phone: contact?.phone ?? null,
    city: contact?.city ?? null,
    state: contact?.state ?? null,
    licenseStatus: q.license_status,
    instagramHandle: contact?.instagram_handle ?? null,
    managerName: q.owner,
    nextAction: q.next_action,
    ageLabel: `${Math.round(days)}d stuck`,
    staleness: bucketFor(days * 24),
    group: "surfaced",
    reason: reasonFor(q, contact),
  };
}

function RecoveryRowCard({
  row,
  onAction,
}: {
  row: RecoveryRow;
  onAction: (id: string, action: RecoveryAction) => void;
}) {
  const cfg = stalenessConfig[row.staleness];
  const StIcon = cfg.icon;
  const fullName = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <GlassCard className="p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
          <Avatar className="h-12 w-12 ring-1 ring-border/60" aria-label={fullName || "Applicant"}>
            <AvatarFallback>{(row.firstName?.[0] ?? "?")}{(row.lastName?.[0] ?? "")}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-base">
                {row.firstName} {row.lastName}
              </p>
              <Badge variant="outline" className={cfg.cls}>
                <StIcon className="h-3 w-3 mr-1" /> {cfg.label}
              </Badge>
              {row.licenseStatus ? (
                <Badge variant="outline" className="capitalize">
                  {row.licenseStatus}
                </Badge>
              ) : null}
              {row.group === "surfaced" ? (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-300 border-amber-500/30">
                  <EyeOff className="h-3 w-3 mr-1" /> Hidden until now
                </Badge>
              ) : null}
              {!row.managerName ? (
                <Badge variant="outline" className="bg-rose-500/10 text-rose-300 border-rose-500/30">
                  <AlertTriangle className="h-3 w-3 mr-1" /> No manager
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="tabular-nums">{row.ageLabel}</span>
              {row.city || row.state ? <span>{[row.city, row.state].filter(Boolean).join(", ")}</span> : null}
              {row.managerName ? (
                <span>Mgr: <span className="text-foreground">{row.managerName}</span></span>
              ) : null}
              {row.reason ? <span>{REASON_LABELS[row.reason]}</span> : null}
            </div>
            {row.nextAction ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Next: <span className="text-foreground">{row.nextAction}</span>
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              {row.phone ? (
                <a href={`tel:${row.phone}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Phone className="h-3.5 w-3.5" /> {row.phone}
                </a>
              ) : null}
              {row.email ? (
                <a href={`mailto:${row.email}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Mail className="h-3.5 w-3.5" /> {row.email}
                </a>
              ) : null}
              {row.phone ? (
                <a
                  href={`sms:${row.phone}?body=${encodeURIComponent(`Hey ${row.firstName}, this is APEX Financial — saw your application. Quick text to confirm: are you still looking to get started with insurance recruiting?`)}`}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> SMS template
                </a>
              ) : null}
              {row.instagramHandle ? (
                <a href={`https://instagram.com/${row.instagramHandle}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Send className="h-3.5 w-3.5" /> @{row.instagramHandle}
                </a>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 md:flex-col md:gap-1">
            <Button size="sm" onClick={() => onAction(row.id, "mark_contacted")}>
              <UserCheck className="h-4 w-4 mr-1" /> Mark Contacted
            </Button>
            <Button asChild size="sm" variant="outline" className="w-full">
              <Link to={`/dashboard/applicants?id=${row.id}`}>
                Open <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
            <Button size="sm" variant="outline" className="text-amber-300 border-amber-500/30 hover:bg-amber-500/10" onClick={() => onAction(row.id, "ghost")}>
              <Ghost className="h-4 w-4 mr-1" /> Ghost
            </Button>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}

export default function StaleRecovery() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "stale" | "icy" | "cold">("all");
  const [segment, setSegment] = useState<RowGroup>("working");

  const { data: rows, isLoading } = useQuery<StaleRow[]>({
    queryKey: ["stale-applicants"],
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_stale_applicants")
        .select(
          "id, first_name, last_name, email, phone, city, state, license_status, status, assigned_agent_id, instagram_handle, created_at, hours_since_application, staleness, assigned_manager_name, assigned_manager_avatar",
        )
        .order("hours_since_application", { ascending: false });
      if (error) throw error;
      return (data ?? []) as StaleRow[];
    },
  });

  const { data: funnel } = useQuery({
    queryKey: ["application-conversion-funnel"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_application_conversion_funnel")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const {
    data: queueRows,
    isLoading: queueLoading,
    isError: queueFailed,
  } = useQuery<QueueStalledRow[]>({
    queryKey: ["queue-stalled-applications"],
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_queue_stalled_applications")
        .select(
          "application_id, applicant, app_status, next_step_stage_key, license_status, owner, recruiter_id, assigned_agent_id, last_action_at, next_action, due_at, days_stuck, priority, is_ghosted, lead_score, created_at",
        )
        .order("days_stuck", { ascending: false });
      if (error) throw error;
      return (data ?? []) as QueueStalledRow[];
    },
  });

  const staleIds = useMemo(() => new Set((rows ?? []).map((r) => r.id)), [rows]);

  /** Stalled rows the working list has never been able to show. */
  const surfacedQueue = useMemo(
    () => (queueRows ?? []).filter((q) => !staleIds.has(q.application_id)),
    [queueRows, staleIds],
  );

  const surfacedIds = useMemo(() => surfacedQueue.map((q) => q.application_id), [surfacedQueue]);

  const {
    data: contacts,
    isError: contactsFailed,
  } = useQuery<Record<string, ContactRow>>({
    queryKey: ["queue-stalled-contacts", surfacedIds],
    enabled: surfacedIds.length > 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const map: Record<string, ContactRow> = {};
      // Chunked so the id filter never blows past a safe request-URL length.
      for (let i = 0; i < surfacedIds.length; i += 100) {
        const chunk = surfacedIds.slice(i, i + 100);
        const { data, error } = await (supabase as any)
          .from("applications")
          .select("id, first_name, last_name, email, phone, city, state, instagram_handle, contacted_at, created_at")
          .in("id", chunk);
        if (error) throw error;
        for (const c of (data ?? []) as ContactRow[]) map[c.id] = c;
      }
      return map;
    },
  });

  const workingRows = useMemo(() => (rows ?? []).map(fromStale), [rows]);

  const surfacedRows = useMemo(
    () => surfacedQueue.map((q) => fromQueue(q, contacts?.[q.application_id])),
    [surfacedQueue, contacts],
  );

  const reasonBreakdown = useMemo(() => {
    const counts: Record<SurfacedReason, number> = {
      contacted: 0,
      "outside-window": 0,
      status: 0,
      other: 0,
    };
    let known = 0;
    for (const r of surfacedRows) {
      if (!r.reason) continue;
      counts[r.reason] += 1;
      known += 1;
    }
    if (known === 0) return [];
    return (Object.keys(REASON_LABELS) as SurfacedReason[])
      .map((key) => ({ key, label: REASON_LABELS[key], n: counts[key] }))
      .filter((b) => b.n > 0);
  }, [surfacedRows]);

  const activeRows = segment === "working" ? workingRows : surfacedRows;
  const activeLoading = segment === "working" ? isLoading : isLoading || queueLoading;

  const filtered = useMemo(() => {
    if (filter === "all") return activeRows;
    return activeRows.filter((r) => r.staleness === filter);
  }, [activeRows, filter]);

  async function callAction(applicationId: string, action: RecoveryAction) {
    const { data, error } = await (supabase.rpc as any)("fn_recover_stale_applicant", {
      p_application_id: applicationId,
      p_action: action,
      p_new_agent_id: null,
      p_note: action === "dismiss" ? "Cleared via Stale Recovery panel" : null,
    });
    if (error || !data?.ok) {
      toast.error(data?.error || error?.message || "Action failed");
      return;
    }
    toast.success(`Marked ${action.replace("_", " ")}`);
    qc.invalidateQueries({ queryKey: ["stale-applicants"] });
    qc.invalidateQueries({ queryKey: ["application-conversion-funnel"] });
    qc.invalidateQueries({ queryKey: ["queue-stalled-applications"] });
  }

  function refreshAll() {
    qc.invalidateQueries({ queryKey: ["stale-applicants"] });
    qc.invalidateQueries({ queryKey: ["queue-stalled-applications"] });
  }

  const queueTotal = queueRows?.length ?? 0;
  const overlapCount = queueTotal - surfacedRows.length;
  /** Both sources must be in before any gap number is real — a partial load would overstate the gap. */
  const gapReady = !isLoading && !queueLoading;

  const segments: { key: RowGroup; label: string; count: number | null }[] = [
    { key: "working", label: "Working list", count: isLoading ? null : workingRows.length },
    { key: "surfaced", label: "Hidden until now", count: gapReady && !queueFailed ? surfacedRows.length : null },
  ];

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <PageHeader
        title="Stale Applicant Recovery"
        subtitle="Applicants who applied >24h ago and no one has contacted yet. Reach out, reassign, or dismiss."
      />

      {/* Funnel snapshot */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Applied (7d)", value: funnel?.applied_7d ?? 0 },
          { label: "Manager Assigned (7d)", value: funnel?.assigned_7d ?? 0 },
          { label: "Contacted (7d)", value: funnel?.contacted_7d ?? 0 },
          { label: "Open Stale", value: funnel?.stale_open_total ?? rows?.length ?? 0 },
        ].map((s) => (
          <GlassCard key={s.label} className="p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
            <p className="text-2xl font-bold mt-1">{s.value}</p>
          </GlassCard>
        ))}
      </div>

      {/* Stalled but invisible — the gap between the working list and the stalled queue */}
      <div className="rounded-lg border border-border bg-card p-3 sm:p-4 mb-6">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <EyeOff className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Stalled but invisible</h3>
          </div>
          {gapReady && !queueFailed ? (
            <span className="text-lg font-bold tabular-nums text-amber-500 flex-shrink-0">
              {surfacedRows.length.toLocaleString()}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          The stalled queue counts more stuck applications than this page has ever shown. Every one of these
          is a real person who applied, went nowhere, and never appeared in anyone's follow-up list.
        </p>

        {queueFailed ? (
          <p className="text-xs text-amber-500">
            Could not read the stalled-applications queue — these counts are missing, not zero.
          </p>
        ) : !gapReady ? (
          <div className="grid grid-cols-3 gap-2">
            {/* stable-key-allow:skeleton */}
            {[1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Stalled total</p>
                <p className="text-lg font-bold leading-tight tabular-nums">{queueTotal.toLocaleString()}</p>
              </div>
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Already in your list</p>
                <p className="text-lg font-bold leading-tight tabular-nums">{overlapCount.toLocaleString()}</p>
              </div>
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Hidden until now</p>
                <p className="text-lg font-bold leading-tight tabular-nums text-amber-500">
                  {surfacedRows.length.toLocaleString()}
                </p>
              </div>
            </div>

            {surfacedRows.length === 0 ? (
              <p className="text-xs text-emerald-500">
                Every stalled application already appears in the working list. Nothing is hiding.
              </p>
            ) : reasonBreakdown.length > 0 ? (
              <div className="space-y-1.5">
                {reasonBreakdown.map((b) => (
                  <div
                    key={b.key}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
                  >
                    <span className="text-xs text-foreground min-w-0 truncate">{b.label}</span>
                    <span className="text-sm font-bold tabular-nums text-amber-500 flex-shrink-0">
                      {b.n.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {contactsFailed ? (
              <p className="text-xs text-amber-500 mt-2">
                Could not load contact details for the hidden applicants — phone, email and Instagram links are
                missing, not absent.
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Which list am I working? */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {segments.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSegment(s.key)}
            aria-pressed={segment === s.key}
            className={cn(
              "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors",
              segment === s.key
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {s.key === "surfaced" ? <EyeOff className="h-3.5 w-3.5" /> : null}
            {s.label}
            {s.count === null ? null : (
              <span
                className={cn(
                  "tabular-nums font-bold",
                  s.key === "surfaced" ? "text-amber-500" : "text-foreground",
                )}
              >
                {s.count.toLocaleString()}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ({activeRows.length})</SelectItem>
            <SelectItem value="stale">Stale (24h+)</SelectItem>
            <SelectItem value="icy">Icy (72h+)</SelectItem>
            <SelectItem value="cold">Cold (7d+)</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={refreshAll}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {activeLoading ? (
        <div className="space-y-3">
          {/* stable-key-allow:skeleton */}
          {[1, 2, 3, 4, 5].map((n) => (
            <Skeleton key={n} className="h-32 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-8 text-center">
          <Flame className="h-8 w-8 text-emerald-400 mx-auto mb-3" />
          <p className="font-semibold">
            {segment === "working"
              ? "No stale applicants in this bucket."
              : "No hidden stalled applications in this bucket."}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {segment === "working"
              ? "Every applicant who came in >24h ago has been contacted. Hold the Standard."
              : "Everything the stalled queue can see is already in the working list."}
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <RecoveryRowCard key={r.id} row={r} onAction={callAction} />
          ))}
        </div>
      )}
    </div>
  );
}
