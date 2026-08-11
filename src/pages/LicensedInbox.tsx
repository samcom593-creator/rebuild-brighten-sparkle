import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Phone,
  PhoneOutgoing,
  ListChecks,
  Voicemail,
  MessageSquare,
  UserCheck,
  XCircle,
  Loader2,
  Search,
  MailX,
  AlertTriangle,
  Route,
} from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { QuickAddAgentDialog } from "@/components/onboarding/QuickAddAgentDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/ui/glass-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/dateUtils";

/**
 * /admin/licensed-inbox: immediate-call surface for licensed applicants and
 * staff-added agents.
 *
 * Sam directive: when a *licensed* applicant applies, don't queue Calendly.
 * Call them NOW. This page is a tight, phone-first inbox showing every
 * licensed application sorted newest-first, with tap-to-call, tap-to-text,
 * and 5 fast disposition buttons that write to application_contact_log.
 *
 * Contract:
 *   - source: applications where license_status='licensed' plus the dedicated
 *             apex_toolkit_agents roster (kept separate to avoid applicant
 *             notification/provisioning triggers)
 *   - sort:   created_at DESC (freshest at top)
 *   - taps:   application_contact_log insert per MP-226 schema
 *   - route:  ProtectedRoute requireAdmin
 */

interface LicensedRow {
  id: string;
  origin: "application" | "toolkit_agent";
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  city: string | null;
  license_status: string;
  nipr_verified: boolean | null;
  pa_number: string | null;
  status: string | null;
  created_at: string;
}

interface ToolkitInboxResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface ToolkitInboxWrite extends PromiseLike<ToolkitInboxResult<unknown>> {
  eq(column: string, value: unknown): ToolkitInboxWrite;
}

interface ToolkitInboxQuery<T> extends PromiseLike<ToolkitInboxResult<T[]>> {
  select(columns: string): ToolkitInboxQuery<T>;
  eq(column: string, value: unknown): ToolkitInboxQuery<T>;
  order(column: string, options?: { ascending?: boolean }): ToolkitInboxQuery<T>;
  limit(count: number): ToolkitInboxQuery<T>;
  insert(payload: Record<string, unknown>): ToolkitInboxWrite;
  update(payload: Record<string, unknown>): ToolkitInboxWrite;
}

interface ToolkitInboxClient {
  from<T>(table: string): ToolkitInboxQuery<T>;
}

const toolkitInboxClient = supabase as unknown as ToolkitInboxClient;

// MP-264 declutter: local copy of the shared relative-time ladder.
// formatTimeAgo() clamps the delta and covers the same buckets.
function relTime(iso: string): string {
  return formatTimeAgo(iso);
}

function fullName(r: LicensedRow): string {
  return `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Unknown";
}

function licensedRowKey(row: Pick<LicensedRow, "id" | "origin">): string {
  return `${row.origin}:${row.id}`;
}

export default function LicensedInbox() {
  usePageTitle("Licensed Inbox · Apex Admin");
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // key = `${origin}:${id}:${outcome}`

  const { data: rows, isLoading, isError, error } = useQuery<LicensedRow[]>({
    queryKey: ["licensed-inbox"],
    queryFn: async () => {
      const [applicationResult, manualAgentResult] = await Promise.all([
        supabase
          .from("applications")
          .select(
            "id, first_name, last_name, email, phone, state, city, license_status, nipr_verified, status, created_at",
          )
          .eq("license_status", "licensed")
        // wave-p1k: exclude terminal dispositions so the inbox actually drains.
        // markHired flips status='contracting', markPassed flips status='rejected'.
        //
        // 2026-07-27: this list also carried 'hired', 'active' and 'terminated', none of
        // which are members of the application_status enum. Those are agent_status values.
        // PostgREST coerces the literals during planning, so the whole request failed with
        // 400 / 22P02 "invalid input value for enum application_status", the catch below
        // turned it into `return []`, and this page rendered EMPTY for three days while
        // looking like a legitimately clear queue. 73 licensed applicants were invisible.
        //
        // Only real enum members belong here. Full set:
        //   new, reviewing, interview, contracting, approved, rejected, no_pickup, lead,
        //   registered, attended, attended_no_show, paid, onboarding, producing, lapsed,
        //   disqualified, quick_qualified
          .not("status", "in", "(contracting,rejected)")
          .order("created_at", { ascending: false })
          .limit(500),
        toolkitInboxClient
          .from<Omit<LicensedRow, "origin" | "state" | "city" | "nipr_verified">>("apex_toolkit_agents")
          .select("id,first_name,last_name,email,phone,pa_number,license_status,status,created_at")
          .eq("license_status", "licensed")
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
      if (applicationResult.error) {
        console.error("[licensed-inbox] application load failed:", applicationResult.error);
        // Do NOT return [] here. Swallowing the error is what let a hard 400 render as
        // "No licensed applicants" for three days. Throw so react-query reports isError
        // and the page can say the list is MISSING rather than empty.
        throw applicationResult.error;
      }
      if (manualAgentResult.error) {
        console.error("[licensed-inbox] manual-agent load failed:", manualAgentResult.error);
        throw manualAgentResult.error;
      }
      const applications = ((applicationResult.data ?? []) as unknown as Array<
        Omit<LicensedRow, "origin" | "pa_number">
      >).map((row) => ({
        ...row,
        origin: "application" as const,
        pa_number: null,
      }));
      const manualAgents = (manualAgentResult.data ?? []).map((row) => ({
        ...row,
        origin: "toolkit_agent" as const,
        state: null,
        city: null,
        nipr_verified: false,
      }));
      return [...applications, ...manualAgents]
        .sort((left, right) => right.created_at.localeCompare(left.created_at));
    },
    staleTime: 15_000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return rows ?? [];
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      const name = fullName(r).toLowerCase();
      return (
        name.includes(q) ||
        (r.email ?? "").toLowerCase().includes(q) ||
        (r.phone ?? "").toLowerCase().includes(q) ||
        (r.state ?? "").toLowerCase().includes(q) ||
        (r.pa_number ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search]);

  async function logContact(
    row: LicensedRow,
    channel: "call" | "sms" | "email" | "note",
    outcome: string,
  ) {
    const key = `${licensedRowKey(row)}:${outcome}`;
    setBusy(key);
    try {
      const result = row.origin === "toolkit_agent"
        ? await toolkitInboxClient
            .from("apex_toolkit_agent_contact_log")
            .insert({
              toolkit_agent_id: row.id,
              channel,
              outcome,
              logged_by: user?.id ?? null,
            })
        : await supabase
            .from("application_contact_log" as never)
            .insert({
              application_id: row.id,
              channel,
              outcome,
              logged_by: user?.id ?? null,
            } as never);
      const { error } = result;
      if (error) {
        console.error("[licensed-inbox] log failed:", error);
        toast.error(`Log failed: ${error.message.slice(0, 80)}`);
        return;
      }
      toast.success(`Logged: ${outcome.replace(/_/g, " ")}`);
    } finally {
      setBusy(null);
    }
  }

  async function markHired(row: LicensedRow) {
    const key = `${licensedRowKey(row)}:hired`;
    setBusy(key);
    try {
      const result = row.origin === "toolkit_agent"
        ? await toolkitInboxClient.from("apex_toolkit_agents").update({ status: "hired" }).eq("id", row.id)
        : await supabase.from("applications").update({ status: "contracting" }).eq("id", row.id);
      const { error } = result;
      if (error) {
        console.error("[licensed-inbox] hire flip failed:", error);
        toast.error(`Hire flip failed: ${error.message.slice(0, 80)}`);
        return;
      }
      await logContact(row, "note", "hired");
      // wave-p1k: optimistically drop the row so the queue clears immediately;
      // invalidate afterward to reconcile with the server.
      qc.setQueryData<LicensedRow[]>(["licensed-inbox"], (prev) =>
        (prev ?? []).filter((candidate) => licensedRowKey(candidate) !== licensedRowKey(row)),
      );
      qc.invalidateQueries({ queryKey: ["licensed-inbox"] });
    } finally {
      setBusy(null);
    }
  }

  async function markPassed(row: LicensedRow) {
    const key = `${licensedRowKey(row)}:passed`;
    setBusy(key);
    try {
      const result = row.origin === "toolkit_agent"
        ? await toolkitInboxClient.from("apex_toolkit_agents").update({ status: "passed" }).eq("id", row.id)
        : await supabase.from("applications").update({ status: "rejected" }).eq("id", row.id);
      const { error } = result;
      if (error) {
        console.error("[licensed-inbox] pass flip failed:", error);
        toast.error(`Pass flip failed: ${error.message.slice(0, 80)}`);
        return;
      }
      await logContact(row, "note", "passed");
      // wave-p1k: optimistic drop mirroring markHired.
      qc.setQueryData<LicensedRow[]>(["licensed-inbox"], (prev) =>
        (prev ?? []).filter((candidate) => licensedRowKey(candidate) !== licensedRowKey(row)),
      );
      qc.invalidateQueries({ queryKey: ["licensed-inbox"] });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrowIcon={<Phone className="h-4 w-4" />}
        eyebrow="Immediate outbound"
        title="Licensed Inbox"
        subtitle="Licensed applicants and added agents. Call now. Newest first. Every tap is logged."
        accent="emerald"
        actions={(
          <>
            <Button asChild variant="outline" className="h-10 gap-2 sm:h-9">
              <Link to="/admin/apex-toolkit">
                <Route className="h-4 w-4" />
                APEX Journey
              </Link>
            </Button>
            <QuickAddAgentDialog
              onAgentAdded={() => {
                void qc.invalidateQueries({ queryKey: ["licensed-inbox"] });
                void qc.invalidateQueries({ queryKey: ["apex-career-toolkit"] });
              }}
            />
          </>
        )}
      />

      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <PhoneOutgoing className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Call queue</span>
          </h3>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Licensed applicants and added agents who have not been worked yet —
          every row is a producer who can write business today and is still waiting on a call.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="shrink-0">
            <div className="text-2xl font-bold leading-none tabular-nums text-foreground">
              {filtered.length.toLocaleString()}
            </div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Waiting to call
            </div>
          </div>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name / email / phone / state / PA number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search the licensed call queue"
              className="h-10 pl-9 sm:h-9"
            />
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Newest first</span>
          </h3>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          The freshest record sits at the top because a licensed producer is
          easiest to reach in the minutes right after they apply or are added.
        </p>

        {isLoading && (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <div
                // stable-key-allow:skeleton — static Array(N) decorative loader, no reorder
                key={i}
                className="h-[144px] animate-pulse rounded-lg bg-muted/30"
              />
            ))}
          </div>
        )}

        {/* A failed fetch must never read as a cleared queue. This exact surface spent
            three days telling Sam every licensed application had been worked while the
            query was 400-ing on a bad enum literal. */}
        {isError && (
          <div className="rounded-lg border border-rose-500/35 bg-rose-500/5 p-3 sm:p-4">
            <div className="flex min-w-0 items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">Licensed applicants could not load</p>
                <p className="mt-0.5 break-words text-xs text-muted-foreground">
                  {(error instanceof Error ? error.message : String(error)).slice(0, 120)}
                </p>
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  This list is missing, not empty. Do not read it as a cleared queue.
                </p>
              </div>
            </div>
          </div>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <EmptyState
            icon={<MailX className="h-7 w-7" />}
            variant="default"
            title="No licensed producer is waiting"
            description="Nothing matches the current search, and an empty queue means every licensed applicant and added agent has already been worked."
          />
        )}

        <ul className="space-y-2">
          {filtered.map((r) => {
            const name = fullName(r);
            const applied = relTime(r.created_at);
            return (
              <li
                key={licensedRowKey(r)}
                className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 transition-colors hover:border-border hover:bg-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {name}
                      </span>
                      {r.origin === "toolkit_agent" ? (
                        <span title="Added by APEX staff; PA number recorded separately from NIPR verification" className="shrink-0 rounded-sm border border-sky-500/35 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-600 dark:text-sky-400">
                          Added agent
                        </span>
                      ) : r.nipr_verified === true ? (
                        <span className="shrink-0 rounded-sm border border-emerald-500/35 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                          Licensed ✓
                        </span>
                      ) : (
                        <span title="Self-reported on the apply form — not verified against NIPR" className="shrink-0 rounded-sm border border-amber-500/35 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          Self-reported
                        </span>
                      )}
                      {r.state && (
                        <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          {r.state}
                        </span>
                      )}
                      {r.pa_number && (
                        <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          {r.pa_number}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-bold tabular-nums text-foreground">
                      {applied}
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      {r.origin === "toolkit_agent" ? "Added" : "Applied"}
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {r.phone ? (
                    <a
                      href={`tel:${r.phone}`}
                      className="inline-flex h-10 min-w-0 items-center gap-2 rounded-sm border border-border bg-background px-3 text-sm font-semibold tabular-nums text-foreground transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:h-9"
                      aria-label={`Call ${name} at ${r.phone}`}
                      onClick={() => void logContact(r, "call", "call_started")}
                    >
                      <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{r.phone}</span>
                    </a>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      No phone on file
                    </span>
                  )}
                  {r.email && (
                    <a
                      href={`mailto:${r.email}`}
                      className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                    >
                      {r.email}
                    </a>
                  )}
                </div>

                <div
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DispBtn
                    label="Called"
                    icon={Phone}
                    tone="neutral"
                    busy={busy === `${licensedRowKey(r)}:called`}
                    onClick={() => void logContact(r, "call", "called")}
                  />
                  <DispBtn
                    label="Voicemail"
                    icon={Voicemail}
                    tone="amber"
                    busy={busy === `${licensedRowKey(r)}:voicemail`}
                    onClick={() => void logContact(r, "call", "voicemail")}
                  />
                  <DispBtn
                    label="Text sent"
                    icon={MessageSquare}
                    tone="neutral"
                    busy={busy === `${licensedRowKey(r)}:text_sent`}
                    onClick={() => void logContact(r, "sms", "text_sent")}
                  />
                  <DispBtn
                    label="Hired"
                    icon={UserCheck}
                    tone="emerald"
                    busy={busy === `${licensedRowKey(r)}:hired`}
                    onClick={() => void markHired(r)}
                  />
                  <DispBtn
                    label="Passed"
                    icon={XCircle}
                    tone="rose"
                    busy={busy === `${licensedRowKey(r)}:passed`}
                    onClick={() => void markPassed(r)}
                  />
                  <Button
                    asChild
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 gap-1.5 px-2.5 text-[11px] hover:border-amber-500/50 hover:bg-amber-500/10 sm:h-9"
                  >
                    <Link to={`/admin/apex-toolkit?agent=${encodeURIComponent(r.id)}&source=${r.origin}`}>
                      <Route className="h-3.5 w-3.5 shrink-0" />
                      Journey
                    </Link>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </GlassCard>
    </div>
  );
}

type Tone = "neutral" | "amber" | "emerald" | "rose";

function DispBtn({
  label,
  icon: Icon,
  tone,
  busy,
  onClick,
}: {
  label: string;
  icon: React.ElementType;
  tone: Tone;
  busy?: boolean;
  onClick: () => void;
}) {
  // Severity discipline: rose / amber / emerald only, always theme-paired so the
  // hover text stays legible on the white light-theme card. Neutral actions
  // ("Called", "Text sent") carry no severity colour — the icon distinguishes them.
  const toneMap: Record<Tone, string> = {
    neutral: "hover:bg-muted/30",
    amber:
      "hover:border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400",
    emerald:
      "hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400",
    rose: "hover:border-rose-500/50 hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400",
  };
  const slug = label.toLowerCase().replace(/[^a-z0-9]/g, "-");
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      data-cc-action={slug}
      disabled={busy}
      className={cn("h-10 gap-1.5 px-2.5 text-[11px] sm:h-9", toneMap[tone])}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="truncate">{label}</span>
    </Button>
  );
}
