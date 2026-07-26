import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Phone,
  MessageCircle,
  Mail,
  Send,
  UserCheck,
  Snowflake,
  Flame,
  Clock,
  ArrowRight,
  Filter,
  Ghost,
  RefreshCw,
  EyeOff,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Severity vocabulary — the only three tones, each paired so it stays legible
// on the white light-theme card and on the dark card. Colour is never the only
// signal: every use below sits beside an icon, a word, or a numeral.
// ---------------------------------------------------------------------------
const GOOD = "text-emerald-600 dark:text-emerald-400";
const WARN = "text-amber-600 dark:text-amber-400";
const BAD = "text-rose-600 dark:text-rose-400";
const NEUTRAL = "text-muted-foreground";

/** A chip carries its meaning in the label; the surface stays neutral. */
const CHIP_BASE = "shrink-0 border-border bg-muted/40 text-[10px] font-bold uppercase tracking-wide";

/** Contact actions are the point of this page — full touch target on phones. */
const CONTACT_CHIP =
  "inline-flex h-10 max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2.5 " +
  "text-[11px] font-medium text-foreground transition-colors hover:bg-muted/30 " +
  "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:h-8";

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

// Four buckets, three tones. "Icy" and "Cold" both read as trouble; the label
// and the icon carry the difference so no fourth severity colour is invented.
const stalenessConfig: Record<Staleness, { label: string; tone: string; icon: any }> = {
  fresh: { label: "Fresh", tone: GOOD, icon: Flame },
  stale: { label: "Stale (24h)", tone: WARN, icon: Clock },
  icy:   { label: "Icy (72h+)", tone: WARN, icon: Snowflake },
  cold:  { label: "Cold (7d+)", tone: BAD, icon: Snowflake },
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
    <li className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 transition-colors hover:border-border hover:bg-card">
      <div className="flex items-start gap-3">
        <Avatar className="h-10 w-10 shrink-0 ring-1 ring-border/60" aria-label={fullName || "Applicant"}>
          <AvatarFallback className="text-[11px] font-bold">
            {(row.firstName?.[0] ?? "?")}{(row.lastName?.[0] ?? "")}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="max-w-full truncate text-sm font-medium text-foreground">
                  {row.firstName} {row.lastName}
                </span>
                <Badge variant="outline" className={cn(CHIP_BASE, cfg.tone)}>
                  <StIcon className="mr-1 h-3 w-3 shrink-0" /> {cfg.label}
                </Badge>
                {row.licenseStatus ? (
                  <Badge variant="outline" className={cn(CHIP_BASE, NEUTRAL)}>
                    {row.licenseStatus}
                  </Badge>
                ) : null}
                {row.group === "surfaced" ? (
                  <Badge variant="outline" className={cn(CHIP_BASE, WARN)}>
                    <EyeOff className="mr-1 h-3 w-3 shrink-0" /> Hidden until now
                  </Badge>
                ) : null}
                {!row.managerName ? (
                  <Badge variant="outline" className={cn(CHIP_BASE, BAD)}>
                    <AlertTriangle className="mr-1 h-3 w-3 shrink-0" /> No manager
                  </Badge>
                ) : null}
              </div>

              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {row.city || row.state ? <span>{[row.city, row.state].filter(Boolean).join(", ")}</span> : null}
                {row.managerName ? (
                  <span>Mgr: <span className="font-medium text-foreground">{row.managerName}</span></span>
                ) : null}
                {row.reason ? <span>{REASON_LABELS[row.reason]}</span> : null}
              </p>

              {row.nextAction ? (
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  Next: <span className="font-medium text-foreground">{row.nextAction}</span>
                </p>
              ) : null}
            </div>

            {/* The one number that decides whether this row gets worked next. */}
            <div className={cn("w-24 shrink-0 text-right text-sm font-bold leading-tight tabular-nums", cfg.tone)}>
              {row.ageLabel}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {row.phone ? (
              <a
                href={`tel:${row.phone}`}
                className={CONTACT_CHIP}
                aria-label={`Call ${fullName || "applicant"}`}
              >
                <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate tabular-nums">{row.phone}</span>
              </a>
            ) : null}
            {row.email ? (
              <a
                href={`mailto:${row.email}`}
                className={CONTACT_CHIP}
                aria-label={`Email ${fullName || "applicant"}`}
              >
                <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{row.email}</span>
              </a>
            ) : null}
            {row.phone ? (
              <a
                href={`sms:${row.phone}?body=${encodeURIComponent(`Hey ${row.firstName}, this is APEX Financial — saw your application. Quick text to confirm: are you still looking to get started with insurance recruiting?`)}`}
                className={CONTACT_CHIP}
                aria-label={`Text ${fullName || "applicant"} the recovery template`}
              >
                <MessageCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">SMS template</span>
              </a>
            ) : null}
            {row.instagramHandle ? (
              <a
                href={`https://instagram.com/${row.instagramHandle}`}
                target="_blank"
                rel="noopener noreferrer"
                className={CONTACT_CHIP}
                aria-label={`Open Instagram profile @${row.instagramHandle}`}
              >
                <Send className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">@{row.instagramHandle}</span>
              </a>
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" className="h-10 sm:h-9" onClick={() => onAction(row.id, "mark_contacted")}>
              <UserCheck className="mr-1.5 h-4 w-4" /> Mark Contacted
            </Button>
            <Button asChild size="sm" variant="outline" className="h-10 sm:h-9">
              <Link to={`/dashboard/applicants?id=${row.id}`}>
                Open <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={cn("h-10 sm:h-9", WARN)}
              onClick={() => onAction(row.id, "ghost")}
            >
              <Ghost className="mr-1.5 h-4 w-4" /> Ghost
            </Button>
          </div>
        </div>
      </div>
    </li>
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

  const activeLabel = segment === "working" ? "Working list" : "Hidden until now";

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        title="Stale Applicant Recovery"
        subtitle="Applicants who applied >24h ago and no one has contacted yet. Reach out, reassign, or dismiss."
        actions={
          <Button variant="outline" size="sm" className="h-10 w-full sm:h-9 sm:w-auto" onClick={refreshAll}>
            <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
          </Button>
        }
      />

      {/* Funnel snapshot */}
      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Funnel snapshot</span>
          </h3>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          What the last seven days moved, and how many applicants are sitting open and stale right now.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Applied (7d)", value: funnel?.applied_7d ?? 0, tone: NEUTRAL },
            { label: "Manager Assigned (7d)", value: funnel?.assigned_7d ?? 0, tone: NEUTRAL },
            { label: "Contacted (7d)", value: funnel?.contacted_7d ?? 0, tone: GOOD },
            { label: "Open Stale", value: funnel?.stale_open_total ?? rows?.length ?? 0, tone: WARN },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-card p-3 sm:p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className={cn("mt-2 text-2xl font-bold leading-none tabular-nums", s.tone)}>{s.value}</p>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Stalled but invisible — the gap between the working list and the stalled queue */}
      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <EyeOff className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Stalled but invisible</span>
          </h3>
          {gapReady && !queueFailed ? (
            <span className={cn("shrink-0 text-sm font-bold tabular-nums", WARN)}>
              {surfacedRows.length.toLocaleString()}
            </span>
          ) : null}
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          The stalled queue counts more stuck applications than this page has ever shown. Every one of these
          is a real person who applied, went nowhere, and never appeared in anyone's follow-up list.
        </p>

        {queueFailed ? (
          <p className={cn("text-xs leading-relaxed", WARN)}>
            Could not read the stalled-applications queue — these counts are missing, not zero.
          </p>
        ) : !gapReady ? (
          <div className="grid grid-cols-3 gap-3">
            {/* stable-key-allow:skeleton */}
            {[1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Stalled total</p>
                <p className="mt-2 text-2xl font-bold leading-none tabular-nums">{queueTotal.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-3 sm:p-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Already in your list</p>
                <p className="mt-2 text-2xl font-bold leading-none tabular-nums">{overlapCount.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-amber-500/35 bg-card p-3 sm:p-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Hidden until now</p>
                <p className={cn("mt-2 text-2xl font-bold leading-none tabular-nums", WARN)}>
                  {surfacedRows.length.toLocaleString()}
                </p>
              </div>
            </div>

            {surfacedRows.length === 0 ? (
              <p className={cn("text-xs leading-relaxed", GOOD)}>
                Every stalled application already appears in the working list. Nothing is hiding.
              </p>
            ) : reasonBreakdown.length > 0 ? (
              <div className="space-y-2">
                {reasonBreakdown.map((b) => (
                  <div
                    key={b.key}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-xs text-foreground">{b.label}</span>
                    <span className={cn("shrink-0 text-sm font-bold tabular-nums", WARN)}>
                      {b.n.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {contactsFailed ? (
              <p className={cn("mt-2 text-xs leading-relaxed", WARN)}>
                Could not load contact details for the hidden applicants — phone, email and Instagram links are
                missing, not absent.
              </p>
            ) : null}
          </>
        )}
      </GlassCard>

      {/* Which list am I working? */}
      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Which list am I working</span>
          </h3>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Switch between the list this page has always shown and the stalled applications it could never see,
          then narrow to one staleness bucket.
        </p>

        {/* One scroll container for the segments — the page body never moves sideways. */}
        <div className="-mx-4 overflow-x-auto pb-1 sm:mx-0">
          <div className="flex min-w-max gap-2 px-4 sm:px-0">
            {segments.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSegment(s.key)}
                aria-pressed={segment === s.key}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-2 rounded-md border border-border bg-card px-3",
                  "text-xs font-semibold transition-colors hover:bg-muted/30 sm:h-9",
                  "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                  segment === s.key ? "ring-2 ring-primary/60 text-foreground" : "text-muted-foreground",
                )}
              >
                {s.key === "surfaced" ? <EyeOff className="h-3.5 w-3.5 shrink-0" /> : null}
                <span className="truncate">{s.label}</span>
                {s.count === null ? null : (
                  <span
                    className={cn(
                      "shrink-0 text-sm font-bold tabular-nums",
                      s.key === "surfaced" ? WARN : "text-foreground",
                    )}
                  >
                    {s.count.toLocaleString()}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
            <SelectTrigger className="h-10 w-full sm:h-9 sm:w-56" aria-label="Filter by staleness">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({activeRows.length})</SelectItem>
              <SelectItem value="stale">Stale (24h+)</SelectItem>
              <SelectItem value="icy">Icy (72h+)</SelectItem>
              <SelectItem value="cold">Cold (7d+)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </GlassCard>

      {/* The list itself */}
      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{activeLabel}</span>
          </h3>
          <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
            {filtered.length.toLocaleString()}
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          {segment === "working"
            ? "Everyone here applied and nobody has reached them yet — the number on the right is how long they have been waiting."
            : "These stalled applications never reached anyone's follow-up list — the number on the right is how long they have been stuck."}
        </p>

        {activeLoading ? (
          <div className="space-y-2">
            {/* stable-key-allow:skeleton */}
            {[1, 2, 3, 4, 5].map((n) => (
              <Skeleton key={n} className="h-32 w-full rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Flame className="h-7 w-7" />}
            variant="success"
            title={
              segment === "working"
                ? "No stale applicants in this bucket"
                : "No hidden stalled applications in this bucket"
            }
            description={
              segment === "working"
                ? "Every applicant who came in >24h ago has been contacted. Hold the Standard."
                : "Everything the stalled queue can see is already in the working list."
            }
          />
        ) : (
          <ul className="space-y-2">
            {filtered.map((r) => (
              <RecoveryRowCard key={r.id} row={r} onAction={callAction} />
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
