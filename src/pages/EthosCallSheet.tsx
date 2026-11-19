import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  Loader2,
  MessageSquare,
  MessagesSquare,
  Phone,
  PhoneCall,
  PhoneMissed,
  PhoneOff,
  Search,
  Upload,
  Users,
  Voicemail,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GlassCard } from "@/components/ui/glass-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatTimeAgo, getBusinessDayKey } from "@/lib/dateUtils";
import { formatPhoneDisplay, startPhoneCall, startSmsThread } from "@/lib/phone";
import {
  FIRST_SEEN_SOURCE_LABEL,
  LANES,
  OUTCOME_LABEL,
  REASON_LABEL,
  REASON_ORDER,
  SPOKE_OUTCOMES,
  callAngle,
  formatDollars,
  laneOf,
  monthYear,
  parseEthosExport,
  shortDate,
  sortForLane,
  tenureLabel,
  type CallLaneFilter,
  type CallOutcome,
  type DropOffReason,
  type EthosCallSheetPayload,
  type EthosCallSheetRow,
} from "@/lib/ethosCallSheet";

/**
 * /dashboard/ethos-call-sheet (MP-ETHOS-CALLSHEET, 2026-11-19)
 *
 * Sam: "I need to spike my production up drastically starting tomorrow ... people who already have my
 * Ethos contract ... that I can call on the spot, figure out what made them drop off, and get them
 * rolling ... made for all managers for their own hierarchies, and me overseeing for all ... mark down
 * after I call them what was the end result."
 *
 * Contract:
 *   - source: ethos_call_sheet() (definer). The owner gets everyone on the Ethos hierarchy export; an
 *             active agent gets the people under them plus the Ethos sub-agency they head; anyone else
 *             gets no rows. Nothing here reads a table directly.
 *   - writes: ethos_call_sheet_log() per call result, ethos_call_sheet_set_phone() for a missing number,
 *             ethos_call_sheet_import() when the owner loads a newer export.
 *   - a failed load says the list is missing. It never renders as an empty sheet.
 */

const QUERY_KEY = ["ethos-call-sheet"] as const;
const NO_LEADER = "__direct__";

type RpcFn<T> = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: T | null; error: { message: string } | null }>;

interface SpokeForm {
  row: EthosCallSheetRow;
  outcome: CallOutcome | null;
  reason: DropOffReason | null;
  followUpOn: string;
  note: string;
}

export default function EthosCallSheet() {
  usePageTitle("Ethos call sheet");
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [lane, setLane] = useState<CallLaneFilter>("call_now");
  const [search, setSearch] = useState("");
  const [leader, setLeader] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [spoke, setSpoke] = useState<SpokeForm | null>(null);
  const [phoneDraft, setPhoneDraft] = useState<{ id: string; value: string } | null>(null);
  const [importing, setImporting] = useState(false);

  const sheet = useQuery<EthosCallSheetPayload>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ethos_call_sheet" as never);
      if (error) throw error;
      const payload = data as unknown as EthosCallSheetPayload | null;
      if (!payload || !Array.isArray(payload.rows)) {
        throw new Error("The call sheet came back in a shape this page does not understand.");
      }
      return payload;
    },
    staleTime: 30_000,
  });

  const rows = useMemo(() => sheet.data?.rows ?? [], [sheet.data]);
  const seesAll = sheet.data?.sees_all === true;
  const today = getBusinessDayKey();

  const leaders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const key = r.manager_name?.trim() || NO_LEADER;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const scoped = useMemo(() => {
    if (!seesAll || leader === "all") return rows;
    return rows.filter((r) => (r.manager_name?.trim() || NO_LEADER) === leader);
  }, [rows, leader, seesAll]);

  const laneCounts = useMemo(() => {
    const out: Record<CallLaneFilter, number> = {
      call_now: 0,
      follow_up: 0,
      coming_back: 0,
      needs_action: 0,
      closed: 0,
      selling: 0,
      left: 0,
      all: scoped.length,
    };
    for (const r of scoped) out[laneOf(r)] += 1;
    return out;
  }, [scoped]);

  const visible = useMemo(() => {
    const inLane = lane === "all" ? scoped : scoped.filter((r) => laneOf(r) === lane);
    const q = search.trim().toLowerCase();
    const matched = q
      ? inLane.filter((r) =>
          r.full_name.toLowerCase().includes(q)
          || (r.phone ?? "").includes(q.replace(/\D/g, "") || "\u0000")
          || (r.email ?? "").toLowerCase().includes(q)
          || (r.npn ?? "").includes(q)
          || (r.manager_name ?? "").toLowerCase().includes(q))
      : inLane;
    return sortForLane(matched, lane);
  }, [scoped, lane, search]);

  const withPhone = useMemo(() => scoped.filter((r) => r.phone).length, [scoped]);
  const laneHint = LANES.find((l) => l.key === lane)?.hint ?? "";

  function patchRow(id: string, patch: Partial<EthosCallSheetRow>) {
    qc.setQueryData<EthosCallSheetPayload>(QUERY_KEY, (prev) =>
      prev ? { ...prev, rows: prev.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : prev,
    );
  }

  async function logCall(
    row: EthosCallSheetRow,
    outcome: CallOutcome,
    extra: { reason?: DropOffReason | null; note?: string; followUpOn?: string } = {},
  ): Promise<boolean> {
    setBusy(`${row.id}:${outcome}`);
    try {
      const note = extra.note?.trim() || null;
      const followUpOn = extra.followUpOn || null;
      const { data, error } = await (supabase.rpc as unknown as RpcFn<{ ok?: boolean }>)("ethos_call_sheet_log", {
        p_person_id: row.id,
        p_outcome: outcome,
        p_reason: extra.reason ?? null,
        p_note: note,
        p_follow_up_on: followUpOn,
      });
      if (error || !data?.ok) throw new Error(error?.message || "The call result was not saved");
      patchRow(row.id, {
        last_outcome: outcome,
        last_reason: extra.reason ?? null,
        last_note: note,
        follow_up_on: followUpOn,
        last_called_at: new Date().toISOString(),
        last_called_by: "you",
        calls: row.calls + 1,
      });
      toast.success(`${row.full_name}: ${OUTCOME_LABEL[outcome]}`);
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
      return true;
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "The call result was not saved");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function savePhone(row: EthosCallSheetRow, value: string) {
    setBusy(`${row.id}:phone`);
    try {
      const { data, error } = await (supabase.rpc as unknown as RpcFn<{ ok?: boolean; phone?: string }>)(
        "ethos_call_sheet_set_phone",
        { p_person_id: row.id, p_phone: value },
      );
      if (error || !data?.ok) throw new Error(error?.message || "The number was not saved");
      patchRow(row.id, { phone: data.phone ?? value });
      setPhoneDraft(null);
      toast.success(`Number saved for ${row.full_name}`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "The number was not saved");
    } finally {
      setBusy(null);
    }
  }

  async function loadExport(file: File) {
    setImporting(true);
    try {
      const parsed = parseEthosExport(await file.text());
      if (parsed.error) throw new Error(parsed.error);
      const { data, error } = await (supabase.rpc as unknown as RpcFn<{ ok?: boolean; people?: number; new_people?: number; with_phone?: number }>)(
        "ethos_call_sheet_import",
        { p_rows: parsed.rows, p_snapshot_on: today },
      );
      if (error || !data?.ok) throw new Error(error?.message || "The export was not loaded");
      toast.success(`Loaded ${data.people ?? parsed.rows.length} people (${data.new_people ?? 0} new, ${data.with_phone ?? 0} with a number)`);
      await qc.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "The export was not loaded");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submitSpoke() {
    if (!spoke?.outcome) return;
    const ok = await logCall(spoke.row, spoke.outcome, {
      reason: spoke.reason,
      note: spoke.note,
      followUpOn: spoke.followUpOn,
    });
    if (ok) setSpoke(null);
  }

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrowIcon={<PhoneCall className="h-4 w-4" />}
        eyebrow="Contracted and ready to sell"
        title="Ethos call sheet"
        subtitle={
          seesAll
            ? "Everyone who holds the Ethos contract. Call, find out why they stopped, and log what happened."
            : "The people under you who hold the Ethos contract. Call, find out why they stopped, and log what happened."
        }
        accent="emerald"
        actions={
          seesAll ? (
            <Button
              type="button"
              variant="outline"
              className="h-10 gap-2 sm:h-9"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Load new Ethos export
            </Button>
          ) : undefined
        }
      />
      {/* Kept outside the header: the header counts every child of `actions` as a control. */}
      {seesAll && (
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          aria-label="Ethos hierarchy performance export file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadExport(file);
          }}
        />
      )}

      <GlassCard className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="shrink-0">
            <div className="text-2xl font-bold leading-none tabular-nums text-foreground">{visible.length.toLocaleString()}</div>
            <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">In this list</div>
          </div>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name, phone, email or NPN"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search the Ethos call sheet"
              className="h-10 pl-9 sm:h-9"
            />
          </div>
          {seesAll && leaders.length > 1 && (
            <Select value={leader} onValueChange={setLeader}>
              <SelectTrigger className="h-10 w-full sm:h-9 sm:w-56" aria-label="Filter by team leader">
                <SelectValue placeholder="Every team" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every team ({rows.length})</SelectItem>
                {leaders.map(([name, count]) => (
                  <SelectItem key={name} value={name}>
                    {name === NO_LEADER ? "No team leader listed" : name} ({count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Call sheet list">
          {LANES.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => setLane(l.key)}
              aria-pressed={lane === l.key}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                lane === l.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:bg-muted",
              )}
            >
              {l.label} <span className="tabular-nums opacity-80">{laneCounts[l.key]}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {laneHint}
          {sheet.data ? (
            <>
              {" "}
              {withPhone} of {scoped.length} have a phone number on file.
              {sheet.data.snapshot_on ? ` Ethos numbers are from the ${shortDate(sheet.data.snapshot_on)} export.` : ""}
            </>
          ) : null}
        </p>
      </GlassCard>

      <GlassCard className="p-4">
        {sheet.isLoading && (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <div
                // stable-key-allow:skeleton — static Array(N) decorative loader, no reorder
                key={i}
                className="h-[168px] animate-pulse rounded-lg bg-muted/30"
              />
            ))}
          </div>
        )}

        {sheet.isError && (
          <div className="rounded-lg border border-rose-500/35 bg-rose-500/5 p-3 sm:p-4" role="alert">
            <div className="flex min-w-0 items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">The call sheet could not load</p>
                <p className="mt-0.5 break-words text-xs text-muted-foreground">
                  {(sheet.error instanceof Error ? sheet.error.message : String(sheet.error)).slice(0, 160)}
                </p>
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  This list is missing, not empty. Nobody has been cleared.
                </p>
              </div>
            </div>
          </div>
        )}

        {!sheet.isLoading && !sheet.isError && rows.length === 0 && (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            variant="default"
            title="Nobody under you is on the Ethos export yet"
            description="This sheet lists people in your hierarchy who hold the Ethos contract. When someone under you is contracted with Ethos, they show up here with their number."
          />
        )}

        {!sheet.isLoading && !sheet.isError && rows.length > 0 && visible.length === 0 && (
          <EmptyState
            icon={<PhoneCall className="h-7 w-7" />}
            variant="default"
            title="Nobody in this list"
            description="Nothing matches this list and search. Pick another list above to keep going."
          />
        )}

        <ul className="space-y-2">
          {visible.map((r) => {
            const angle = callAngle(r);
            const tenure = tenureLabel(r.first_seen_on);
            const chargeback = Number(r.chargeback_total) || 0;
            const personalChargeback = Number(r.chargeback_personal) || 0;
            const appAp = Number(r.lifetime_ap) || 0;
            const due = Boolean(r.follow_up_on && r.follow_up_on <= today);
            const editingPhone = phoneDraft?.id === r.id;
            const rowBusy = (suffix: string) => busy === `${r.id}:${suffix}`;
            return (
              <li
                key={r.id}
                className="rounded-lg border border-border/60 bg-card/60 px-3 py-3 transition-colors hover:border-border hover:bg-card"
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-base font-semibold text-foreground">{r.full_name}</span>
                      {r.manager_name && (
                        <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                          Under {r.manager_name}
                        </span>
                      )}
                      {!r.in_app && (
                        <span
                          title="Holds the Ethos contract but has no account in this app"
                          className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
                        >
                          No account here
                        </span>
                      )}
                      {r.standing === "inactive" && (
                        <span className="shrink-0 rounded-sm border border-amber-500/35 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          Inactive here
                        </span>
                      )}
                      {r.standing === "terminated" && (
                        <span className="shrink-0 rounded-sm border border-rose-500/35 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                          Left the agency
                        </span>
                      )}
                      {r.comp_level && (
                        <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                          {r.comp_level}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-foreground/90">{angle.text}</p>
                  </div>
                  <div
                    className="shrink-0 sm:text-right"
                    title={r.first_seen_on ? `Since ${monthYear(r.first_seen_on)}, ${FIRST_SEEN_SOURCE_LABEL[r.first_seen_source ?? ""] ?? "earliest date on file"}` : undefined}
                  >
                    {r.first_seen_on ? (
                      <>
                        <span className="text-sm font-bold tabular-nums text-foreground">{tenure}</span>
                        <span className="ml-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground sm:ml-0 sm:block">
                          With us since {monthYear(r.first_seen_on)}
                        </span>
                      </>
                    ) : (
                      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Start date not on file</span>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {r.phone ? (
                    <>
                      <Button
                        type="button"
                        className="h-11 gap-2 px-4 text-base font-semibold tabular-nums sm:h-10"
                        aria-label={`Call ${r.full_name} at ${formatPhoneDisplay(r.phone)}`}
                        onClick={() => {
                          if (!startPhoneCall(r.phone)) toast.error(`Cannot dial ${r.phone}`);
                        }}
                      >
                        <Phone className="h-4 w-4 shrink-0" />
                        {formatPhoneDisplay(r.phone)}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 gap-1.5 px-3 sm:h-10"
                        aria-label={`Text ${r.full_name}`}
                        onClick={() => {
                          if (!startSmsThread(r.phone)) toast.error(`Cannot text ${r.phone}`);
                        }}
                      >
                        <MessageSquare className="h-4 w-4 shrink-0" />
                        Text
                      </Button>
                    </>
                  ) : editingPhone ? (
                    <form
                      className="flex flex-wrap items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void savePhone(r, phoneDraft?.value ?? "");
                      }}
                    >
                      <Input
                        autoFocus
                        inputMode="tel"
                        placeholder="10-digit number"
                        value={phoneDraft?.value ?? ""}
                        onChange={(event) => setPhoneDraft({ id: r.id, value: event.target.value })}
                        aria-label={`Phone number for ${r.full_name}`}
                        className="h-10 w-44"
                      />
                      <Button type="submit" className="h-10" disabled={rowBusy("phone")}>
                        {rowBusy("phone") ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save number"}
                      </Button>
                      <Button type="button" variant="ghost" className="h-10" onClick={() => setPhoneDraft(null)}>
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <>
                      <span className="text-sm font-medium text-amber-600 dark:text-amber-400">No phone number on file</span>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 gap-1.5 px-3"
                        onClick={() => setPhoneDraft({ id: r.id, value: "" })}
                      >
                        <Phone className="h-4 w-4 shrink-0" />
                        Add number
                      </Button>
                    </>
                  )}
                  {r.email && <span className="min-w-0 basis-full truncate text-[13px] text-muted-foreground sm:basis-auto sm:flex-1">{r.email}</span>}
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
                  <Stat label="Ethos issued" value={formatDollars(r.issued_premium)} />
                  <Stat label="Ethos in force" value={formatDollars(r.inforce_premium)} />
                  <Stat
                    label="Chargebacks owed"
                    value={chargeback > 0 ? formatDollars(chargeback) : "None"}
                    tone={chargeback > 0 ? "rose" : undefined}
                    detail={chargeback > 0 && personalChargeback !== chargeback ? `${formatDollars(personalChargeback)} personal` : undefined}
                  />
                  <Stat
                    label="Sold in this app"
                    value={r.in_app ? formatDollars(appAp) : "No account"}
                    detail={r.last_deal_on ? `last deal ${shortDate(r.last_deal_on)}` : undefined}
                  />
                  <Stat
                    label="Last sign-in"
                    value={r.last_sign_in_at ? formatTimeAgo(r.last_sign_in_at) : r.in_app ? "Never" : "No account"}
                  />
                </dl>

                {r.last_outcome && (
                  <div className="mt-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-foreground">{OUTCOME_LABEL[r.last_outcome]}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.last_called_at ? formatTimeAgo(r.last_called_at) : ""}
                        {r.last_called_by ? ` by ${r.last_called_by}` : ""}
                        {r.calls > 1 ? `, ${r.calls} calls logged` : ""}
                      </span>
                      {r.follow_up_on && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
                            due
                              ? "border-amber-500/35 text-amber-600 dark:text-amber-400"
                              : "border-border text-muted-foreground",
                          )}
                        >
                          <CalendarClock className="h-3 w-3" />
                          {due ? `Due ${shortDate(r.follow_up_on)}` : `Check back ${shortDate(r.follow_up_on)}`}
                        </span>
                      )}
                    </div>
                    {r.last_reason && <p className="mt-1 text-xs text-muted-foreground">Why they stopped: {REASON_LABEL[r.last_reason]}</p>}
                    {r.last_note && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground/90">{r.last_note}</p>}
                  </div>
                )}

                <div className="mt-3 grid grid-cols-4 gap-2 sm:flex sm:flex-wrap sm:items-center" role="group" aria-label={`Log the call with ${r.full_name}`}>
                  <Button
                    type="button"
                    className="col-span-4 h-11 gap-1.5 px-3 sm:h-9"
                    onClick={() => setSpoke({ row: r, outcome: null, reason: null, followUpOn: "", note: "" })}
                  >
                    <MessagesSquare className="h-4 w-4 shrink-0" />
                    Spoke to them
                  </Button>
                  <QuickResult label="No answer" icon={PhoneMissed} busy={rowBusy("no_answer")} onClick={() => void logCall(r, "no_answer")} />
                  <QuickResult label="Voicemail" icon={Voicemail} busy={rowBusy("voicemail")} onClick={() => void logCall(r, "voicemail")} />
                  <QuickResult label="Texted" icon={MessageSquare} busy={rowBusy("texted")} onClick={() => void logCall(r, "texted")} />
                  <QuickResult label="Wrong number" icon={PhoneOff} busy={rowBusy("wrong_number")} onClick={() => void logCall(r, "wrong_number")} />
                </div>
              </li>
            );
          })}
        </ul>
      </GlassCard>

      <Dialog
        open={spoke !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setSpoke(null);
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>How did the call go?</DialogTitle>
            <DialogDescription>
              {spoke ? `${spoke.row.full_name}. Pick the result, then say why they stopped if they told you.` : ""}
            </DialogDescription>
          </DialogHeader>

          {spoke && (
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-semibold">Result</Label>
                <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label="Call result">
                  {SPOKE_OUTCOMES.map((o) => (
                    <Button
                      key={o}
                      type="button"
                      variant={spoke.outcome === o ? "default" : "outline"}
                      aria-pressed={spoke.outcome === o}
                      className="h-11 whitespace-normal px-2 text-sm leading-tight"
                      onClick={() => setSpoke({ ...spoke, outcome: o })}
                    >
                      {OUTCOME_LABEL[o]}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-sm font-semibold">Why did they stop?</Label>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Why they stopped">
                  {REASON_ORDER.map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      aria-pressed={spoke.reason === reason}
                      onClick={() => setSpoke({ ...spoke, reason: spoke.reason === reason ? null : reason })}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-left text-[13px] font-medium focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                        spoke.reason === reason
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-foreground hover:bg-muted",
                      )}
                    >
                      {REASON_LABEL[reason]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ethos-call-follow-up">Check back on (optional)</Label>
                <Input
                  id="ethos-call-follow-up"
                  type="date"
                  min={today}
                  value={spoke.followUpOn}
                  onChange={(event) => setSpoke({ ...spoke, followUpOn: event.target.value })}
                  className="h-10 w-full sm:w-56"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ethos-call-note">Notes</Label>
                <Textarea
                  id="ethos-call-note"
                  rows={4}
                  maxLength={2000}
                  placeholder="What they said, and what you promised to do next."
                  value={spoke.note}
                  onChange={(event) => setSpoke({ ...spoke, note: event.target.value })}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => setSpoke(null)}>
              Cancel
            </Button>
            <Button type="button" className="gap-2" disabled={!spoke?.outcome || Boolean(busy)} onClick={() => void submitSpoke()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save call
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "rose";
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("truncate font-semibold tabular-nums text-foreground", tone === "rose" && "text-rose-600 dark:text-rose-400")}>
        {value}
      </dd>
      {detail && <dd className="truncate text-xs text-muted-foreground">{detail}</dd>}
    </div>
  );
}

function QuickResult({
  label,
  icon: Icon,
  busy,
  onClick,
}: {
  label: string;
  icon: React.ElementType;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      className="h-14 flex-col gap-1 whitespace-normal px-1 text-[12px] leading-tight sm:h-9 sm:flex-row sm:gap-1.5 sm:whitespace-nowrap sm:px-2.5 sm:text-[13px]"
      onClick={onClick}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Icon className="h-3.5 w-3.5 shrink-0" />}
      <span>{label}</span>
    </Button>
  );
}
