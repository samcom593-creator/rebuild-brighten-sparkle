/**
 * Aflac onboarding: /dashboard/contracting/aflac
 *
 * Every licensed hire has to be sent to Aflac, and Aflac then emails the hire directly. This page is the
 * one place that send is recorded, and the daily check-off cannot be completed while a ready hire is
 * unsent. The owner types the comp level by hand for every hire; nothing here defaults it.
 *
 * Truth comes from aflac_gate_state() (see src/lib/aflacGate.ts). A hire with missing or malformed data is
 * shown as BLOCKED with the exact missing fields, never hidden and never auto-filled. Blocked hires do
 * not stop the check-off (a gate nobody can clear turns permanently red); they are counted and carried.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Loader2, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { resolveBrand } from "@/config/brand";
import { formatPhoneDisplay } from "@/lib/phone";
import { formatTimeAgo } from "@/lib/dateUtils";
import {
  AFLAC_GATE_QUERY_KEY, AFLAC_MISSING_LABELS, useAflacGate,
  type AflacQueueRow, type AflacRecentRow,
} from "@/lib/aflacGate";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { GlassCard } from "@/components/ui/glass-card";

const COMP_RE = /^[A-Za-z0-9][A-Za-z0-9 %./()+-]{0,39}$/;

/** Whole Phoenix calendar days since an ISO timestamp, matching how the database counts hire days. */
function daysSince(iso: string): number {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix" }).format(d);
  const a = Date.parse(`${day(new Date(iso))}T00:00:00Z`);
  const b = Date.parse(`${day(new Date())}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function fullName(r: { first_name: string | null; last_name: string | null }): string {
  return `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Unnamed";
}

function QueueRow({ row, onSent }: { row: AflacQueueRow; onSent: () => void }) {
  const [comp, setComp] = useState("");
  const ready = row.missing.length === 0;
  const compValid = COMP_RE.test(comp.trim());

  const send = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("aflac_mark_submitted", {
        p_intake_id: row.intake_id,
        p_comp_level: comp.trim(),
      });
      if (error) throw new Error(error.message);
      const res = data as unknown as { ok: boolean; reason?: string; missing?: string[]; submission_id?: string; already_submitted?: boolean };
      if (!res.ok) {
        const why = res.reason === "missing_data"
          ? `Missing: ${(res.missing ?? []).map((m) => AFLAC_MISSING_LABELS[m] ?? m).join(", ")}`
          : res.reason === "comp_level_required" ? "Type the commission level first" : (res.reason ?? "Refused");
        throw new Error(why);
      }
      let mailed = false;
      if (res.submission_id) {
        const { data: mail, error: mailErr } = await supabase.functions.invoke("notify-aflac-submitted", {
          body: { submission_id: res.submission_id },
        });
        mailed = !mailErr && (mail as { ok?: boolean } | null)?.ok === true;
      }
      return { mailed, already: res.already_submitted === true };
    },
    onSuccess: ({ mailed, already }) => {
      if (already) toast.message(`${fullName(row)} was already marked sent`);
      else if (mailed) toast.success(`${fullName(row)} marked sent. They were emailed.`);
      else toast.warning(`${fullName(row)} marked sent, but the email to them failed. Retry it from Recently sent.`);
      onSent();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-lg border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-foreground">{fullName(row)}</div>
          <div className="mt-1 grid gap-x-6 gap-y-0.5 text-sm text-muted-foreground sm:grid-cols-3">
            <span className="truncate">{row.email || "no email"}</span>
            <span>NPN {row.npn || "missing"}</span>
            <span>{row.phone_e164 ? formatPhoneDisplay(row.phone_e164) : "no phone"}</span>
          </div>
        </div>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {daysSince(row.created_at) >= 3 && row.tracked ? (
            <span className="rounded-full border border-red-500/50 bg-red-500/15 px-2.5 py-0.5 font-bold text-red-300">Overdue: day {daysSince(row.created_at)}</span>
          ) : null}
          Intake {formatTimeAgo(row.created_at)}
        </span>
      </div>

      {ready ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={comp}
            onChange={(e) => setComp(e.target.value)}
            placeholder="Commission level (type it)"
            aria-label={`Commission level for ${fullName(row)}`}
            maxLength={40}
            className="sm:max-w-xs"
          />
          <Button onClick={() => send.mutate()} disabled={!compValid || send.isPending} className="sm:w-auto">
            {send.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Sent to Aflac
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-amber-500/50 text-amber-300">Blocked</Badge>
          {row.missing.map((m) => (
            <Badge key={m} variant="secondary">{AFLAC_MISSING_LABELS[m] ?? m}</Badge>
          ))}
          {row.review_reason ? <span className="text-xs text-muted-foreground">{row.review_reason}</span> : null}
        </div>
      )}
    </div>
  );
}

function RecentRow({ row, onRetried }: { row: AflacRecentRow; onRetried: () => void }) {
  const retry = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("notify-aflac-submitted", { body: { submission_id: row.id } });
      if (error || (data as { ok?: boolean } | null)?.ok !== true) throw new Error(error?.message ?? "Email still failing");
    },
    onSuccess: () => { toast.success(`Emailed ${row.first_name}`); onRetried(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <div className="min-w-0">
        <span className="font-medium text-foreground">{row.first_name} {row.last_name}</span>
        <span className="ml-2 text-muted-foreground">NPN {row.npn} · {row.comp_level} · sent {formatTimeAgo(row.submitted_at)}</span>
      </div>
      {row.hire_notified_at ? (
        <Badge variant="secondary"><Mail className="mr-1 h-3 w-3" />Hire emailed</Badge>
      ) : (
        <Button size="sm" variant="outline" onClick={() => retry.mutate()} disabled={retry.isPending}>
          {retry.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-2 h-3 w-3" />}
          Hire not emailed. Retry
        </Button>
      )}
    </div>
  );
}

export default function AflacOnboarding() {
  const brand = resolveBrand();
  usePageTitle(`Aflac onboarding ${brand.titleSuffix}`);
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useAflacGate();
  const [showEarlier, setShowEarlier] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: AFLAC_GATE_QUERY_KEY });

  const checkoff = useMutation({
    mutationFn: async () => {
      const { data: res, error: err } = await supabase.rpc("aflac_daily_checkoff");
      if (err) throw new Error(err.message);
      const r = res as unknown as { ok: boolean; reason?: string; count?: number };
      if (!r.ok) throw new Error(r.reason === "ready_hires_unsent" ? `${r.count} ready hire(s) still unsent` : (r.reason ?? "Refused"));
    },
    onSuccess: () => { toast.success("Aflac check-off done for today"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="mx-auto w-full max-w-4xl space-y-4 p-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>;

  if (isError || !data) {
    return (
      <div className="mx-auto w-full max-w-4xl p-4">
        <GlassCard className="p-6">
          <p className="font-semibold text-foreground">Could not read the Aflac queue.</p>
          <p className="mt-1 text-sm text-muted-foreground">{error instanceof Error ? error.message : "Unknown error"}. This is not an empty queue.</p>
          <Button className="mt-4" variant="outline" onClick={() => refetch()}>Try again</Button>
        </GlassCard>
      </div>
    );
  }

  const tracked = data.queue.filter((r) => r.tracked);
  const ready = tracked.filter((r) => r.missing.length === 0);
  const blocked = tracked.filter((r) => r.missing.length > 0);
  const earlier = data.queue.filter((r) => !r.tracked);

  return (
    <div className="page-enter mx-auto w-full max-w-4xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow={`${brand.platformName} · Contracting`}
        eyebrowIcon={<ShieldCheck className="h-3 w-3" />}
        title="Aflac onboarding"
        subtitle="Send every new licensed hire to Aflac, type their commission level, then check off the day. Aflac emails the hire directly once you do."
        actions={
          data.checked_off_today ? (
            <Badge variant="secondary" className="text-xs">Checked off today</Badge>
          ) : (
            <Button onClick={() => checkoff.mutate()} disabled={ready.length > 0 || checkoff.isPending}>
              {checkoff.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Check off today
            </Button>
          )
        }
      />

      {!data.checked_off_today && ready.length > 0 ? (
        <p className="text-sm text-red-300">{ready.length} ready {ready.length === 1 ? "hire has" : "hires have"} not been sent. Send {ready.length === 1 ? "them" : "each"} to unlock today&apos;s check-off.</p>
      ) : null}
      {!data.checked_off_today && ready.length === 0 && blocked.length > 0 ? (
        <p className="text-sm text-amber-300">{blocked.length} blocked {blocked.length === 1 ? "hire needs" : "hires need"} missing details. The check-off is open; they stay listed until fixed.</p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Ready to send ({ready.length})</h2>
        {ready.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No licensed hires waiting on Aflac.</p>
        ) : ready.map((r) => <QueueRow key={r.intake_id} row={r} onSent={refresh} />)}
      </section>

      {blocked.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Blocked, missing details ({blocked.length})</h2>
          {blocked.map((r) => <QueueRow key={r.intake_id} row={r} onSent={refresh} />)}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recently sent ({data.recent.length})</h2>
        {data.recent.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Nothing sent in the last 14 days.</p>
        ) : data.recent.map((r) => <RecentRow key={r.id} row={r} onRetried={refresh} />)}
      </section>

      {earlier.length > 0 ? (
        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setShowEarlier((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${showEarlier ? "rotate-180" : ""}`} />
            Earlier hires, not tracked ({earlier.length})
          </button>
          {showEarlier ? (
            <>
              <p className="text-xs text-muted-foreground">Licensed before this check-off existed. They never block the day, but you can send any of them here.</p>
              {earlier.map((r) => <QueueRow key={r.intake_id} row={r} onSent={refresh} />)}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
