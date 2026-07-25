import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Phone,
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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <PageHeader
        eyebrowIcon={<Phone className="h-4 w-4" />}
        eyebrow="Immediate outbound"
        title="Licensed Inbox"
        subtitle="Licensed applicants. Call now. Newest first. Every tap is logged."
        accent="emerald"
      />

      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name / email / phone / state"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Badge variant="outline" className="whitespace-nowrap text-xs">
            {filtered.length} licensed
          </Badge>
        </div>

        {isLoading && (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <MailX className="h-8 w-8" />
              <p className="text-sm">No hits.</p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          {filtered.map((r) => {
            const name = fullName(r);
            const applied = relTime(r.created_at);
            return (
              <Card
                key={r.id}
                className="border-emerald-500/20 hover:border-emerald-500/40 transition-colors"
              >
                <CardContent className="flex flex-col gap-3 p-3 sm:p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold">{name}</span>
                      <Badge
                        variant="outline"
                        className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]"
                      >
                        licensed
                      </Badge>
                      {r.state && (
                        <Badge
                          variant="outline"
                          className="text-[10px] uppercase"
                        >
                          {r.state}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        applied {applied}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {r.phone ? (
                        <a
                          href={`tel:${r.phone}`}
                          className="inline-flex items-center gap-1 font-mono text-sm text-primary hover:underline"
                          aria-label={`Call ${name} at ${r.phone}`}
                          onClick={() => logContact(r.id, "call", "call_started")}
                        >
                          <Phone className="h-3.5 w-3.5" />
                          {r.phone}
                        </a>
                      ) : (
                        <span className="italic text-muted-foreground">
                          no phone on file
                        </span>
                      )}
                      {r.email && (
                        <a
                          href={`mailto:${r.email}`}
                          className="truncate hover:underline"
                        >
                          {r.email}
                        </a>
                      )}
                    </div>
                  </div>

                  <div
                    className="flex flex-wrap items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DispBtn
                      label="Called"
                      icon={Phone}
                      tone="sky"
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
                      tone="violet"
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
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type Tone = "sky" | "amber" | "violet" | "emerald" | "rose";

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
  const toneMap: Record<Tone, string> = {
    sky: "hover:border-sky-500/50 hover:bg-sky-500/10 hover:text-sky-200",
    amber:
      "hover:border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-200",
    violet:
      "hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-violet-200",
    emerald:
      "hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-200",
    rose: "hover:border-rose-500/50 hover:bg-rose-500/10 hover:text-rose-200",
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
      className={cn(
        "min-h-[44px] h-11 gap-1 px-2 text-[11px] sm:text-xs",
        toneMap[tone],
      )}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
      ) : (
        <Icon className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="truncate">{label}</span>
    </Button>
  );
}
