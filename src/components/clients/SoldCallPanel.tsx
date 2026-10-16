// SoldCallPanel — surfaces a client's ReadyMode "Completed Sale" booking packet
// INLINE on an existing record (Production, Client Detail, Book Flips). It looks
// the packet up by phone (preferred) or name, and renders nothing when there is no
// match, so it never adds clutter to a client who has no sold call.
//
// 2026-10-15: SSN and bank numbers used to sit behind a "Reveal" button. They now
// load with the panel for the people allowed to see them (Sam's admin logins and
// Aisha, enforced in the database by can_view_sold_calls), and
// booking_packet_reveal_sensitive still writes an access-log row on every read.
// Numbers are transcribed best-effort, so each one links to the second in the
// recording where it was spoken.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronDown, Headphones, MessageSquare, Phone, PhoneCall } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { looseSupabase } from "@/lib/looseSupabase";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { externalHref } from "@/lib/externalHref";
import { useAuth } from "@/hooks/useAuth";
import { SOLD_CALL_EXTRA_UID } from "@/hooks/useSoldCallKeys";
import { contactLinkProps, formatPhoneDisplay, phoneHref, smsHref } from "@/lib/phone";
import { bookingGaps, clientAsks, draftDayLabel, formatDob, formatSsn, paymentLabel } from "@/lib/soldCallPacket";

interface Beneficiary { name?: string; relationship?: string; pct?: number | string; contingent?: boolean }
interface Packet {
  packet_id: string; call_at: string | null; agent_raw: string | null;
  client_first_name: string | null; client_last_name: string | null; client_state: string | null;
  client_dob: string | null; client_phone: string | null; client_street: string | null;
  client_city: string | null; client_zip: string | null; client_email: string | null;
  ssn_last4: string | null; tobacco: boolean | null; health_notes: string | null;
  carrier: string | null; product: string | null; face_amount: number | null; monthly_premium: number | null;
  draft_day: string | null; payment_method_type: string | null; bank_name: string | null; policy_number: string | null;
  beneficiaries: Beneficiary[] | null; sensitive_pointers: Record<string, { t_start?: number }> | null;
  missing_fields: string[] | null; has_ssn: boolean | null; has_bank: boolean | null;
  call_summary: string | null; key_points: string[] | null;
  recording_url: string | null; duration_seconds: number | null; status: string | null; booked_at: string | null;
}
interface Sensitive { ssn: string | null; bank_account: string | null; bank_routing: string | null }

const digits10 = (s?: string | null) => (s ? s.replace(/[^0-9]/g, "").slice(-10) : "");
const money = (n: number | null) => (n == null ? null : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const mmss = (s: number | null | undefined) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
const dateStr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "date unknown");

export function SoldCallPanel({ phone, firstName, lastName }: { phone?: string | null; firstName?: string | null; lastName?: string | null }) {
  const { isAdmin, user } = useAuth();
  const canView = !!isAdmin || user?.id === SOLD_CALL_EXTRA_UID;
  const ph = digits10(phone);
  const fn = (firstName ?? "").trim().toLowerCase();
  const ln = (lastName ?? "").trim().toLowerCase();

  const q = useQuery({
    queryKey: ["sold-call-packet", ph, fn, ln],
    enabled: canView && !!(ph || (fn && ln)),
    staleTime: 60_000,
    queryFn: async (): Promise<Packet | null> => {
      // phone match first (most reliable), then full-name fallback
      if (ph) {
        const { data } = await (looseSupabase.from("v_sold_call_packets").select("*").eq("match_phone10", ph).order("call_at", { ascending: false }).limit(1) as unknown as Promise<{ data: Packet[] | null }>);
        if (data && data.length) return data[0];
      }
      if (fn && ln) {
        const { data } = await (looseSupabase.from("v_sold_call_packets").select("*").eq("match_first", fn).eq("match_last", ln).order("call_at", { ascending: false }).limit(1) as unknown as Promise<{ data: Packet[] | null }>);
        if (data && data.length) return data[0];
      }
      return null;
    },
  });

  const p = q.data;
  const secret = useQuery({
    queryKey: ["sold-call-sensitive", p?.packet_id ?? null],
    enabled: canView && Boolean(p?.packet_id) && Boolean(p?.has_ssn || p?.has_bank),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Sensitive> => {
      const { data, error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(
        "booking_packet_reveal_sensitive", { p_id: p?.packet_id },
      );
      if (error) throw new Error(error.message);
      const rec = (Array.isArray(data) ? data[0] : data) as Sensitive | undefined;
      return rec ?? { ssn: null, bank_account: null, bank_routing: null };
    },
  });
  const [open, setOpen] = useState(true);
  const bens = useMemo(() => p?.beneficiaries ?? [], [p]);

  if (!p) return null; // no match → render nothing (no clutter)
  // ReadyMode recording URL from the DB: laundered so a scheme-less value can never
  // resolve relative to the current page (MP-497). Every live row is https today.
  const recordingHref = externalHref(p.recording_url);
  const dialPhone = p.client_phone ?? phone ?? null;
  const callHref = phoneHref(dialPhone);
  const textHref = smsHref(dialPhone);
  const asks = clientAsks(p.missing_fields, Boolean(callHref));
  const gaps = bookingGaps(p.missing_fields);
  const pointers = p.sensitive_pointers ?? {};
  const heardAt = (s: number | undefined) =>
    s == null ? null : recordingHref ? (
      <a href={`${recordingHref}#t=${Math.max(0, Math.floor(s) - 3)}`} target="_blank" rel="noopener noreferrer" className="ml-1 text-[11px] font-normal text-muted-foreground underline-offset-2 hover:underline">heard at {mmss(s)}</a>
    ) : <span className="ml-1 text-[11px] font-normal text-muted-foreground">heard at {mmss(s)}</span>;
  const s = secret.data;
  const ssnShown = formatSsn(s?.ssn) ?? (p.ssn_last4 ? `•••-••-${p.ssn_last4}` : null);

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <PhoneCall className="h-4 w-4 text-amber-500" />
          Sold call on file, {dateStr(p.call_at)}
          {p.carrier ? <span className="font-normal text-muted-foreground">· {p.carrier}{p.monthly_premium ? ` · ${money(p.monthly_premium)}/mo` : ""}</span> : null}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-amber-500/20 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {callHref && (
              <Button asChild size="sm">
                <a href={callHref} {...contactLinkProps(callHref)}><Phone className="mr-1.5 h-3.5 w-3.5" />Call {formatPhoneDisplay(dialPhone)}</a>
              </Button>
            )}
            {textHref && (
              <Button asChild size="sm" variant="outline">
                <a href={textHref} {...contactLinkProps(textHref)}><MessageSquare className="mr-1.5 h-3.5 w-3.5" />Text</a>
              </Button>
            )}
            {recordingHref && (
              <Button asChild variant="outline" size="sm">
                <a href={recordingHref} target="_blank" rel="noopener noreferrer"><Headphones className="mr-1.5 h-3.5 w-3.5" />Recording {mmss(p.duration_seconds)}</a>
              </Button>
            )}
            {p.status === "booked" ? (
              <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" />Resold {dateStr(p.booked_at)}</span>
            ) : null}
          </div>

          {(asks.length > 0 || gaps.length > 0) && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              {asks.length > 0 && <p><span className="font-semibold text-amber-700 dark:text-amber-300">Ask the client for:</span> {asks.join(" · ")}</p>}
              {gaps.length > 0 && <p className={asks.length > 0 ? "mt-1" : undefined}><span className="font-semibold text-amber-700 dark:text-amber-300">Not heard on the call:</span> {gaps.join(" · ")}</p>}
            </div>
          )}

          {(p.call_summary || (p.key_points && p.key_points.length > 0)) && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              {p.call_summary && <p className="text-foreground">{p.call_summary}</p>}
              {p.key_points && p.key_points.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {p.key_points.map((k) => <li key={k}>{k}</li>)}
                </ul>
              )}
            </div>
          )}

          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <Field k="Agent" v={p.agent_raw} />
            <Field k="State" v={p.client_state} />
            <Field k="Carrier" v={p.carrier} />
            <Field k="Product" v={p.product} />
            <Field k="Face amount" v={money(p.face_amount)} />
            <Field k="Premium" v={p.monthly_premium == null ? null : `${money(p.monthly_premium)}/mo`} />
            <Field k="Policy #" v={p.policy_number} />
            <Field k="Draft day" v={draftDayLabel(p.draft_day)} />
            <Field k="Date of birth" v={formatDob(p.client_dob)} />
            <Field k="Tobacco" v={p.tobacco == null ? null : p.tobacco ? "Yes" : "No"} />
            <Field k="Email" v={p.client_email} />
            <Field k="Pays by" v={paymentLabel(p.payment_method_type)} />
          </div>
          {p.client_street && <Field k="Address" v={[p.client_street, p.client_city, [p.client_state, p.client_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")} />}
          {p.health_notes && <Field k="Health" v={p.health_notes} />}

          {(p.has_ssn || p.has_bank || p.bank_name) && (
            <div className="rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">SSN and bank</div>
              {secret.isLoading ? (
                <div className="space-y-2 py-1"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/6" /></div>
              ) : secret.isError ? (
                <p className="text-destructive">SSN and bank numbers did not load: {(secret.error as Error).message}</p>
              ) : (
                <div className="grid gap-x-6 gap-y-1 font-mono sm:grid-cols-2">
                  <Field k="SSN" v={ssnShown ? <>{ssnShown}{heardAt(pointers.ssn?.t_start)}</> : null} />
                  <Field k="Bank" v={p.bank_name} />
                  <Field k="Routing #" v={s?.bank_routing ? <>{s.bank_routing}{heardAt(pointers.routing?.t_start)}</> : null} />
                  <Field k="Account #" v={s?.bank_account ? <>{s.bank_account}{heardAt(pointers.bank_account?.t_start)}</> : null} />
                </div>
              )}
              <p className="mt-2 flex items-center gap-1.5 font-sans text-[11px] text-muted-foreground">
                <AlertTriangle className="h-3 w-3 shrink-0" />Transcribed from the recording. Check the numbers against it before you submit.
              </p>
            </div>
          )}

          {bens.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Beneficiaries</div>
              <ul className="space-y-0.5">
                {bens.map((b) => (
                  <li key={`${b.name ?? "ben"}|${b.relationship ?? ""}|${b.pct ?? ""}|${b.contingent ? "c" : "p"}`} className="flex justify-between">
                    <span>{b.name ?? "Name not captured"}{b.relationship ? ` · ${b.relationship}` : ""}{b.contingent ? " (contingent)" : ""}</span>
                    <span className="tabular-nums">{b.pct != null && b.pct !== "" ? `${b.pct}%` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  const empty = v == null || v === "";
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="font-sans text-muted-foreground">{k}</span>
      <span className={empty ? "text-right font-sans text-muted-foreground" : "text-right font-medium"}>{empty ? "Not captured" : v}</span>
    </div>
  );
}

export default SoldCallPanel;
