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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
 * /admin/licensed-inbox: immediate-call surface for LICENSED applicants.
 *
 * Sam directive: when a *licensed* applicant applies, don't queue Calendly.
 * Call them NOW. This page is a tight, phone-first inbox showing every
 * licensed application sorted newest-first, with tap-to-call, tap-to-text,
 * and 5 fast disposition buttons that write to application_contact_log.
 *
 * Contract:
 *   - source: applications where license_status='licensed'
 *   - sort:   created_at DESC (freshest at top)
 *   - taps:   application_contact_log insert per MP-226 schema
 *   - route:  ProtectedRoute requireAdmin
 */

interface LicensedRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  city: string | null;
  license_status: string;
  status: string | null;
  created_at: string;
}

// MP-264 declutter: local copy of the shared relative-time ladder.
// formatTimeAgo() clamps the delta and covers the same buckets.
function relTime(iso: string): string {
  return formatTimeAgo(iso);
}

function fullName(r: LicensedRow): string {
  return `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Unknown";
}

export default function LicensedInbox() {
  usePageTitle("Licensed Inbox · Apex Admin");
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // key = `${appId}:${outcome}`

  const { data: rows, isLoading } = useQuery<LicensedRow[]>({
    queryKey: ["licensed-inbox"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select(
          "id, first_name, last_name, email, phone, state, city, license_status, status, created_at",
        )
        .eq("license_status", "licensed")
        // wave-p1k: exclude terminal dispositions so the inbox actually drains.
        // markHired flips status='contracting', markPassed flips status='rejected';
        // without this filter, already-worked applicants re-surface on every refetch
        // and the "call now" queue grows monotonically. 'active'/'hired'/'terminated'
        // covered for the same reason (already-onboarded agents shouldn't reappear).
        .not(
          "status",
          "in",
          "(contracting,rejected,hired,active,terminated)",
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) {
        console.error("[licensed-inbox] load failed:", error);
        toast.error(`Load failed: ${error.message.slice(0, 80)}`);
        return [];
      }
      return (data ?? []) as LicensedRow[];
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
        (r.state ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search]);

  async function logContact(
    applicationId: string,
    channel: "call" | "sms" | "email" | "note",
    outcome: string,
  ) {
    const key = `${applicationId}:${outcome}`;
    setBusy(key);
    try {
      const { error } = await supabase
        .from("application_contact_log" as never)
        .insert({
          application_id: applicationId,
          channel,
          outcome,
          logged_by: user?.id ?? null,
        } as never);
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

  async function markHired(applicationId: string) {
    const key = `${applicationId}:hired`;
    setBusy(key);
    try {
      const { error } = await supabase
        .from("applications")
        .update({ status: "contracting" })
        .eq("id", applicationId);
      if (error) {
        console.error("[licensed-inbox] hire flip failed:", error);
        toast.error(`Hire flip failed: ${error.message.slice(0, 80)}`);
        return;
      }
      await logContact(applicationId, "note", "hired");
      // wave-p1k: optimistically drop the row so the queue clears immediately;
      // invalidate afterward to reconcile with the server.
      qc.setQueryData<LicensedRow[]>(["licensed-inbox"], (prev) =>
        (prev ?? []).filter((r) => r.id !== applicationId),
      );
      qc.invalidateQueries({ queryKey: ["licensed-inbox"] });
    } finally {
      setBusy(null);
    }
  }

  async function markPassed(applicationId: string) {
    const key = `${applicationId}:passed`;
    setBusy(key);
    try {
      const { error } = await supabase
        .from("applications")
        .update({ status: "rejected" })
        .eq("id", applicationId);
      if (error) {
        console.error("[licensed-inbox] pass flip failed:", error);
        toast.error(`Pass flip failed: ${error.message.slice(0, 80)}`);
        return;
      }
      await logContact(applicationId, "note", "passed");
      // wave-p1k: optimistic drop mirroring markHired.
      qc.setQueryData<LicensedRow[]>(["licensed-inbox"], (prev) =>
        (prev ?? []).filter((r) => r.id !== applicationId),
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
        subtitle="Licensed applicants. Call now. Newest first. Every tap is logged."
        accent="emerald"
      />

      <GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <PhoneOutgoing className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Call queue</span>
          </h3>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Licensed applicants who have not been worked yet — every row is a
          producer who can write business today and is still waiting on a call.
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
              placeholder="Search name / email / phone / state"
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
          The freshest application sits at the top because a licensed applicant
          is easiest to reach in the minutes right after they apply.
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

        {!isLoading && filtered.length === 0 && (
          <EmptyState
            icon={<MailX className="h-7 w-7" />}
            variant="default"
            title="No licensed applicant is waiting"
            description="Nothing matches the current search, and an empty queue means every licensed application has already been worked."
          />
        )}

        <ul className="space-y-2">
          {filtered.map((r) => {
            const name = fullName(r);
            const applied = relTime(r.created_at);
            return (
              <li
                key={r.id}
                className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 transition-colors hover:border-border hover:bg-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {name}
                      </span>
                      <span className="shrink-0 rounded-sm border border-emerald-500/35 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                        Licensed
                      </span>
                      {r.state && (
                        <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          {r.state}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-bold tabular-nums text-foreground">
                      {applied}
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Applied
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {r.phone ? (
                    <a
                      href={`tel:${r.phone}`}
                      className="inline-flex h-10 min-w-0 items-center gap-2 rounded-sm border border-border bg-background px-3 text-sm font-semibold tabular-nums text-foreground transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:h-9"
                      aria-label={`Call ${name} at ${r.phone}`}
                      onClick={() => logContact(r.id, "call", "call_started")}
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
                    busy={busy === `${r.id}:called`}
                    onClick={() => logContact(r.id, "call", "called")}
                  />
                  <DispBtn
                    label="Voicemail"
                    icon={Voicemail}
                    tone="amber"
                    busy={busy === `${r.id}:voicemail`}
                    onClick={() => logContact(r.id, "call", "voicemail")}
                  />
                  <DispBtn
                    label="Text sent"
                    icon={MessageSquare}
                    tone="neutral"
                    busy={busy === `${r.id}:text_sent`}
                    onClick={() => logContact(r.id, "sms", "text_sent")}
                  />
                  <DispBtn
                    label="Hired"
                    icon={UserCheck}
                    tone="emerald"
                    busy={busy === `${r.id}:hired`}
                    onClick={() => markHired(r.id)}
                  />
                  <DispBtn
                    label="Passed"
                    icon={XCircle}
                    tone="rose"
                    busy={busy === `${r.id}:passed`}
                    onClick={() => markPassed(r.id)}
                  />
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
