// SoldCalls — My Business → Sold Calls.
//
// Every ReadyMode call dispositioned "Completed Sale", with the recording pulled,
// transcribed, and turned into a booking packet: the client + policy facts needed
// to submit the application to the carrier.
//
// 2026-10-15: the page used to be a table where each sale opened in a narrow side
// drawer, with SSN and bank numbers behind a "Reveal" button. Sam books and calls
// from this page, so every sale now shows in full on the page itself: a Call button
// with the number on it, what to ask the client for, the policy, and the SSN and
// bank numbers. Access is unchanged: only Sam's admin logins and Aisha can open the
// page (can_view_sold_calls), and booking_packets_sensitive_all logs every packet it
// returns, the same audit the reveal button wrote.
//
// Data: v_sold_calls_queue (one row per sold call), v_sold_call_packets (client
// contact + bank name), booking_packets_sensitive_all() and
// booking_packet_mark_booked(uuid,text). None of these are in the generated types,
// so reads go through looseSupabase.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, Copy, Headphones, Loader2, MessageSquare, Phone, RefreshCw, Search, ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { looseSupabase } from "@/lib/looseSupabase";
import { useAuth } from "@/hooks/useAuth";
import { SOLD_CALL_EXTRA_UID } from "@/hooks/useSoldCallKeys";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { externalHref } from "@/lib/externalHref";
import { contactLinkProps, formatPhoneDisplay, isDialablePhone, nationalDigits, phoneHref, smsHref } from "@/lib/phone";
import { bookingGaps, clientAsks, draftDayLabel, formatDob, formatSsn, paymentLabel } from "@/lib/soldCallPacket";
import { cn } from "@/lib/utils";

interface Beneficiary { name?: string; relationship?: string; pct?: number | string; contingent?: boolean; dob?: string }
interface SoldRow {
  call_id: string;
  call_at: string | null;
  agent_raw: string | null;
  lead_first_name: string | null;
  lead_last_name: string | null;
  lead_phone: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  packet_id: string | null;
  client_first_name: string | null;
  client_last_name: string | null;
  client_state: string | null;
  carrier: string | null;
  product: string | null;
  face_amount: number | null;
  monthly_premium: number | null;
  policy_number: string | null;
  ssn_last4: string | null;
  has_ssn: boolean | null;
  has_bank: boolean | null;
  beneficiaries: Beneficiary[] | null;
  sensitive_pointers: Record<string, { t_start?: number }> | null;
  missing_fields: string[] | null;
  call_summary: string | null;
  key_points: string[] | null;
  draft_day: string | null;
  payment_method_type: string | null;
  status: string | null;
  booked_at: string | null;
  packet_status: string;
}
interface PacketExtra {
  packet_id: string;
  client_dob: string | null;
  client_phone: string | null;
  client_email: string | null;
  client_street: string | null;
  client_city: string | null;
  client_zip: string | null;
  tobacco: boolean | null;
  health_notes: string | null;
  bank_name: string | null;
  booked_policy_number: string | null;
}
interface Sensitive { packet_id: string; ssn: string | null; bank_account: string | null; bank_routing: string | null }

const STATUS_META: Record<string, { label: string; tone: string }> = {
  no_recording: { label: "No recording", tone: "bg-muted text-muted-foreground" },
  downloading: { label: "Pulling recording", tone: "bg-sky-500/15 text-sky-600 dark:text-sky-300" },
  transcribing: { label: "Packet in progress", tone: "bg-sky-500/15 text-sky-600 dark:text-sky-300" },
  short_call: { label: "Short call", tone: "bg-muted text-muted-foreground" },
  needs_review: { label: "Missing info", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  ready: { label: "Ready to resell", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  booked: { label: "Resold", tone: "bg-emerald-600/20 text-emerald-700 dark:text-emerald-200" },
};

// The database still calls a finished sale "booked" (status, booked_at,
// booking_packet_mark_booked); everything a person reads says resold, which is Sam's word.
type FilterKey = "to_resell" | "coming" | "no_packet" | "resold" | "all";
const FILTERS: Array<{ key: FilterKey; label: string; match: (s: string) => boolean }> = [
  { key: "to_resell", label: "To resell", match: (s) => s === "ready" || s === "needs_review" },
  { key: "coming", label: "Packet coming", match: (s) => s === "transcribing" || s === "downloading" },
  { key: "no_packet", label: "No packet", match: (s) => s === "no_recording" || s === "short_call" },
  { key: "resold", label: "Resold", match: (s) => s === "booked" },
  { key: "all", label: "All", match: () => true },
];
const phone10 = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").slice(-10);

const money = (n: number | null | undefined) =>
  n == null ? null : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const mmss = (s: number | null | undefined) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
const clientName = (r: SoldRow) =>
  [r.client_first_name ?? r.lead_first_name, r.client_last_name ?? r.lead_last_name].filter(Boolean).join(" ") || "Unknown client";
const saleDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "Date unknown";

async function fetchQueue(): Promise<SoldRow[]> {
  const { data, error } = await (looseSupabase
    .from("v_sold_calls_queue")
    .select("*")
    .order("call_at", { ascending: false }) as unknown as Promise<{ data: SoldRow[] | null; error: Error | null }>);
  if (error) throw error;
  return data ?? [];
}

async function fetchExtras(): Promise<Map<string, PacketExtra>> {
  const { data, error } = await (looseSupabase
    .from("v_sold_call_packets")
    .select("packet_id, client_dob, client_phone, client_email, client_street, client_city, client_zip, tobacco, health_notes, bank_name, booked_policy_number") as unknown as Promise<{ data: PacketExtra[] | null; error: Error | null }>);
  if (error) throw error;
  return new Map((data ?? []).map((p) => [p.packet_id, p]));
}

async function fetchSensitive(): Promise<Map<string, Sensitive>> {
  const { data, error } = await supabase.rpc("booking_packets_sensitive_all" as never);
  if (error) throw error;
  const rows = (Array.isArray(data) ? data : []) as Sensitive[];
  return new Map(rows.map((s) => [s.packet_id, s]));
}

export default function SoldCalls() {
  const { isAdmin, user } = useAuth();
  const canView = !!isAdmin || user?.id === SOLD_CALL_EXTRA_UID;
  usePageTitle("Sold Calls");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["sold-calls-queue"], queryFn: fetchQueue, staleTime: 30_000, enabled: canView });
  const extras = useQuery({ queryKey: ["sold-calls-extras"], queryFn: fetchExtras, staleTime: 60_000, enabled: canView });
  // Five minutes: every fetch writes one access-log row per packet, so the page
  // should not re-read the numbers on every tab focus.
  const sensitive = useQuery({ queryKey: ["sold-calls-sensitive"], queryFn: fetchSensitive, staleTime: 5 * 60_000, refetchOnWindowFocus: false, enabled: canView });
  const rows = useMemo(() => q.data ?? [], [q.data]);

  const [filter, setFilter] = useState<FilterKey>("to_resell");
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const out: Record<FilterKey, number> = { to_resell: 0, coming: 0, no_packet: 0, resold: 0, all: rows.length };
    for (const r of rows) {
      for (const f of FILTERS) if (f.key !== "all" && f.match(r.packet_status)) out[f.key] += 1;
    }
    return out;
  }, [rows]);

  const filtered = useMemo(() => {
    const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[FILTERS.length - 1];
    const term = search.trim().toLowerCase();
    const termDigits = term.replace(/\D/g, "");
    return rows.filter((r) => {
      if (!active.match(r.packet_status)) return false;
      if (!term) return true;
      const extra = r.packet_id ? extras.data?.get(r.packet_id) : undefined;
      if (termDigits.length >= 4 && [r.lead_phone, extra?.client_phone].some((p) => (p ?? "").replace(/\D/g, "").includes(termDigits))) return true;
      return [clientName(r), r.agent_raw, r.carrier, r.product, r.policy_number, r.client_state]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [rows, filter, search, extras.data]);

  // The newest sale with a packet for each phone, so a short or unrecorded sale can
  // point at the same client's full call instead of looking like a lost sale.
  const packetByPhone = new Map<string, SoldRow>();
  for (const r of rows) {
    const key = phone10(r.lead_phone);
    if (key.length === 10 && r.packet_id && !packetByPhone.has(key)) packetByPhone.set(key, r);
  }

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16 text-center text-sm text-muted-foreground">
        This page is restricted.
      </div>
    );
  }

  const refreshResold = () => {
    qc.invalidateQueries({ queryKey: ["sold-calls-queue"] });
    qc.invalidateQueries({ queryKey: ["sold-calls-extras"] });
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <PageHeader
        eyebrow="My Business"
        title="Sold Calls"
        subtitle="Every ReadyMode sale with the client, the policy and the payment details on one card. Call, fill the gaps, resell it."
        accent="amber"
      />

      <div className="z-30 -mx-4 mb-4 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur lg:sticky lg:top-[60px]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Which sold calls to show">
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? "default" : "outline"}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
              >
                {f.label}
                <span className={cn("ml-1.5 rounded-full px-1.5 text-xs tabular-nums", filter === f.key ? "bg-background/20" : "bg-muted")}>
                  {counts[f.key]}
                </span>
              </Button>
            ))}
          </div>
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, agent, carrier, policy #"
              aria-label="Search sold calls"
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {sensitive.isError && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          <span>SSN and bank numbers did not load: {String((sensitive.error as Error)?.message ?? "unknown error")}</span>
          <Button size="sm" variant="outline" onClick={() => sensitive.refetch()}><RefreshCw className="mr-1 h-3.5 w-3.5" />Try again</Button>
        </div>
      )}

      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }, (_, n) => <Skeleton key={`sold-sk-${n}`} className="h-56 w-full rounded-xl" />)}</div>
      ) : q.isError ? (
        <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="Could not load sold calls" description={String((q.error as Error)?.message ?? "Unknown error")} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Phone className="h-6 w-6" />} title="Nothing here" description={search ? "No sold call matches that search." : "No sold calls in this list right now."} />
      ) : (
        <div className="space-y-4">
          {filtered.map((r) => (
            <SoldCallCard
              key={r.call_id}
              row={r}
              extra={r.packet_id ? extras.data?.get(r.packet_id) : undefined}
              secret={r.packet_id ? sensitive.data?.get(r.packet_id) : undefined}
              secretLoading={sensitive.isLoading}
              onResold={refreshResold}
              twin={r.packet_id ? undefined : packetByPhone.get(phone10(r.lead_phone))}
              onOpenTwin={(t) => { setFilter("all"); setSearch(phone10(t.lead_phone)); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono, copy, stacked }: { label: string; value: React.ReactNode; mono?: boolean; copy?: string | null; stacked?: boolean }) {
  const empty = value == null || value === "";
  const shown = (
    <span className={cn("break-words", empty ? "text-muted-foreground" : "font-medium", !empty && mono && "font-mono tabular-nums")}>
      {empty ? "Not captured" : value}
    </span>
  );
  if (stacked && !empty) {
    return (
      <div className="py-1 text-sm">
        <div className="flex items-center justify-between gap-2 text-muted-foreground">
          <span>{label}</span>
          {copy ? <CopyButton value={copy} label={label} /> : null}
        </div>
        <div className="mt-0.5">{shown}</div>
      </div>
    );
  }
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1 text-right">
        {shown}
        {copy && !empty ? <CopyButton value={copy} label={label} /> : null}
      </span>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch (e) {
      toast.error(`Could not copy ${label.toLowerCase()}`, { description: e instanceof Error ? e.message : "The browser blocked the clipboard." });
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
  );
}

function Heard({ href, seconds }: { href: string | null; seconds: number | undefined }) {
  if (seconds == null) return null;
  const label = `heard at ${mmss(seconds)}`;
  if (!href) return <span className="text-xs text-muted-foreground">{label}</span>;
  return (
    <a href={`${href}#t=${Math.max(0, Math.floor(seconds) - 3)}`} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
      {label}
    </a>
  );
}

function SoldCallCard({ row, extra, secret, secretLoading, onResold, twin, onOpenTwin }: {
  row: SoldRow;
  extra: PacketExtra | undefined;
  secret: Sensitive | undefined;
  secretLoading: boolean;
  onResold: () => void;
  twin?: SoldRow;
  onOpenTwin: (twin: SoldRow) => void;
}) {
  const [policyInput, setPolicyInput] = useState("");
  const [booking, setBooking] = useState(false);

  const recordingHref = externalHref(row.recording_url);
  const dialPhone = row.lead_phone ?? extra?.client_phone ?? null;
  const callHref = phoneHref(dialPhone);
  const textHref = smsHref(dialPhone);
  const otherPhone = extra?.client_phone && isDialablePhone(extra.client_phone) && nationalDigits(extra.client_phone) !== nationalDigits(row.lead_phone) ? extra.client_phone : null;
  const asks = clientAsks(row.missing_fields, Boolean(callHref));
  const gaps = bookingGaps(row.missing_fields);
  const status = STATUS_META[row.packet_status] ?? { label: row.packet_status, tone: "bg-muted text-muted-foreground" };
  const pointers = row.sensitive_pointers ?? {};
  const ssn = formatSsn(secret?.ssn);
  const address = extra ? [extra.client_street, extra.client_city, [row.client_state, extra.client_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
  const bens = row.beneficiaries ?? [];
  const policyNumber = row.policy_number ?? extra?.booked_policy_number ?? null;

  const markResold = async () => {
    if (!row.packet_id) return;
    setBooking(true);
    const { error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>)(
      "booking_packet_mark_booked", { p_id: row.packet_id, p_policy: policyInput.trim() },
    );
    setBooking(false);
    if (error) { toast.error("Could not mark resold", { description: error.message }); return; }
    toast.success(`${clientName(row)} marked resold.`);
    onResold();
  };

  return (
    <article className="rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5" aria-label={`Sold call: ${clientName(row)}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight">
            {clientName(row)}
            {row.client_state ? <span className="ml-2 text-sm font-normal text-muted-foreground">{row.client_state}</span> : null}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Sold {saleDate(row.call_at)}{row.agent_raw ? ` by ${row.agent_raw}` : ""}{row.duration_seconds ? ` · ${mmss(row.duration_seconds)} call` : ""}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", status.tone)}>{status.label}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {callHref ? (
          <Button asChild size="sm" className="h-9">
            <a href={callHref} {...contactLinkProps(callHref)}>
              <Phone className="mr-1.5 h-4 w-4" />Call {formatPhoneDisplay(dialPhone)}
            </a>
          </Button>
        ) : (
          <span className="rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground">No phone number on file</span>
        )}
        {textHref && (
          <Button asChild size="sm" variant="outline" className="h-9">
            <a href={textHref} {...contactLinkProps(textHref)}><MessageSquare className="mr-1.5 h-4 w-4" />Text</a>
          </Button>
        )}
        {recordingHref && (
          <Button asChild size="sm" variant="outline" className="h-9">
            <a href={recordingHref} target="_blank" rel="noopener noreferrer"><Headphones className="mr-1.5 h-4 w-4" />Recording {mmss(row.duration_seconds)}</a>
          </Button>
        )}
      </div>

      {!row.packet_id ? (
        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
          <p>
            {row.packet_status === "no_recording"
              ? "ReadyMode has no recording for this sale, so there is no packet. Call the client to collect the application details."
              : row.packet_status === "short_call"
                ? `This call lasted ${mmss(row.duration_seconds) || "a few seconds"}, too short to hold an application, so no packet can be built from it.`
                : "The recording is pulled and the sale packet is being written. It shows here when it is done."}
          </p>
          {twin && (
            <p className="flex flex-wrap items-center gap-2 text-foreground">
              <span>The same client has a full packet from the {saleDate(twin.call_at)} sale.</span>
              <Button size="sm" variant="outline" className="h-8" onClick={() => onOpenTwin(twin)}>Show that sale</Button>
            </p>
          )}
        </div>
      ) : (
        <>
          {(asks.length > 0 || gaps.length > 0) && (
            <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              {asks.length > 0 && (
                <p><span className="font-semibold text-amber-700 dark:text-amber-300">Ask the client for:</span> {asks.join(" · ")}</p>
              )}
              {gaps.length > 0 && (
                <p className={cn(asks.length > 0 && "mt-1")}><span className="font-semibold text-amber-700 dark:text-amber-300">Not heard on the call:</span> {gaps.join(" · ")}</p>
              )}
            </div>
          )}

          <div className="mt-4 grid gap-x-6 gap-y-4 md:grid-cols-3">
            <section aria-label="Client">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client</h3>
              <Field label="Date of birth" value={formatDob(extra?.client_dob)} copy={formatDob(extra?.client_dob)} />
              {otherPhone ? <Field label="Phone said on call" value={formatPhoneDisplay(otherPhone)} copy={otherPhone} /> : null}
              <Field label="Email" value={extra?.client_email} copy={extra?.client_email} />
              <Field label="Address" value={address || null} copy={address || null} stacked />
              <Field label="Tobacco" value={extra?.tobacco == null ? null : extra.tobacco ? "Yes" : "No"} />
              {extra?.health_notes ? <Field label="Health" value={extra.health_notes} stacked /> : null}
            </section>

            <section aria-label="Policy">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Policy</h3>
              <Field label="Carrier" value={row.carrier} />
              <Field label="Product" value={row.product} />
              <Field label="Face amount" value={money(row.face_amount)} />
              <Field label="Premium" value={row.monthly_premium == null ? null : `${money(row.monthly_premium)}/mo`} />
              <Field label="Draft day" value={draftDayLabel(row.draft_day)} />
              <Field label="Policy #" value={policyNumber} mono copy={policyNumber} />
            </section>

            <section aria-label="Payment and SSN">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment &amp; SSN</h3>
              {secretLoading && !secret && (row.has_ssn || row.has_bank) ? (
                <div className="space-y-2 py-1"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-4/6" /></div>
              ) : (
                <>
                  <Field label="SSN" value={ssn ?? (row.ssn_last4 ? `•••-••-${row.ssn_last4}` : null)} mono copy={secret?.ssn?.replace(/\D/g, "") || null} />
                  <div className="-mt-1 text-right"><Heard href={recordingHref} seconds={pointers.ssn?.t_start} /></div>
                  <Field label="Pays by" value={paymentLabel(row.payment_method_type)} />
                  <Field label="Bank" value={extra?.bank_name} />
                  <Field label="Routing #" value={secret?.bank_routing} mono copy={secret?.bank_routing} />
                  <Field label="Account #" value={secret?.bank_account} mono copy={secret?.bank_account} />
                  <div className="-mt-1 text-right"><Heard href={recordingHref} seconds={pointers.bank_account?.t_start ?? pointers.routing?.t_start} /></div>
                </>
              )}
            </section>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <section aria-label="Beneficiaries" className="md:col-span-1">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Beneficiaries</h3>
              {bens.length === 0 ? <p className="text-sm text-muted-foreground">None captured.</p> : (
                <ul className="space-y-1 text-sm">
                  {bens.map((b) => (
                    <li key={`${b.name ?? "beneficiary"}|${b.relationship ?? ""}|${b.pct ?? ""}|${b.contingent ? "c" : "p"}`} className="flex justify-between gap-2">
                      <span>{b.name ?? "Name not captured"}{b.relationship ? ` · ${b.relationship}` : ""}{b.contingent ? " (contingent)" : ""}</span>
                      <span className="tabular-nums text-muted-foreground">{b.pct != null && b.pct !== "" ? `${b.pct}%` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {(row.call_summary || (row.key_points && row.key_points.length > 0)) && (
              <section aria-label="Call summary" className="md:col-span-2">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">On the call</h3>
                {row.call_summary && <p className="text-sm">{row.call_summary}</p>}
                {row.key_points && row.key_points.length > 0 && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                    {row.key_points.map((k) => <li key={k}>{k}</li>)}
                  </ul>
                )}
              </section>
            )}
          </div>

          {(row.has_ssn || row.has_bank) && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              SSN and bank numbers are transcribed from the recording. Check them against the recording before you submit.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            {row.status === "booked" ? (
              <span className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />Resold {row.booked_at ? saleDate(row.booked_at) : ""}
              </span>
            ) : (
              <>
                <Input
                  value={policyInput}
                  onChange={(e) => setPolicyInput(e.target.value)}
                  placeholder="Policy number (optional)"
                  aria-label={`Policy number for ${clientName(row)} (optional)`}
                  className="h-9 w-56"
                  disabled={booking}
                />
                <Button size="sm" className="h-9" onClick={markResold} disabled={booking}>
                  {booking ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                  Mark resold
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </article>
  );
}
