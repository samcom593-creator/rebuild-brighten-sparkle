// SoldCallPanel — surfaces a client's ReadyMode "Completed Sale" booking packet
// INLINE on an existing record (Client Pipeline, Book of Business, Book Flips).
// It looks the packet up by phone (preferred) or name, and renders nothing when
// there is no match, so it never adds clutter to a client who has no sold call.
//
// SSN and bank account/routing are encrypted at rest; this panel shows only the
// last 4 of the SSN and a "Reveal" action that calls booking_packet_reveal_sensitive,
// which logs every access. Sensitive numbers from the call are best-effort transcribed
// and each carries the recording timestamp where it was spoken, to confirm by ear.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Headphones, Loader2, Lock, PhoneCall, Unlock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { looseSupabase } from "@/lib/looseSupabase";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { SOLD_CALL_EXTRA_UID } from "@/hooks/useSoldCallKeys";

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
  recording_url: string | null; duration_seconds: number | null; status: string | null; booked_at: string | null;
}

const digits10 = (s?: string | null) => (s ? s.replace(/[^0-9]/g, "").slice(-10) : "");
const money = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const mmss = (s: number | null) => (s == null ? "" : ` (${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")})`);
const dateStr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—");

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
  const [open, setOpen] = useState(true);
  const [sensitive, setSensitive] = useState<{ ssn?: string; bank_account?: string; bank_routing?: string } | null>(null);
  const [revealing, setRevealing] = useState(false);
  const bens = useMemo(() => p?.beneficiaries ?? [], [p]);

  if (!p) return null; // no match → render nothing (no clutter)

  const reveal = async () => {
    setRevealing(true);
    const { data, error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)("booking_packet_reveal_sensitive", { p_id: p.packet_id });
    setRevealing(false);
    if (error) { toast.error("Reveal failed", { description: error.message }); return; }
    const rec = Array.isArray(data) ? (data[0] as Record<string, string>) : (data as Record<string, string>);
    setSensitive(rec ?? {});
    toast.success("Sensitive fields revealed — this access was logged.");
  };

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <PhoneCall className="h-4 w-4 text-amber-400" />
          Sold call on file — {dateStr(p.call_at)}
          {p.carrier ? <span className="font-normal text-muted-foreground">· {p.carrier}{p.monthly_premium ? ` · ${money(p.monthly_premium)}/mo` : ""}</span> : null}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-amber-500/20 px-4 py-3 text-sm">
          {p.missing_fields && p.missing_fields.length > 0 && (
            <p className="text-xs text-amber-300">Still needed from client: {p.missing_fields.join(", ")}</p>
          )}
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <Field k="Agent" v={p.agent_raw} />
            <Field k="State" v={p.client_state} />
            <Field k="Carrier" v={p.carrier} />
            <Field k="Product" v={p.product} />
            <Field k="Face amount" v={p.face_amount == null ? null : money(p.face_amount)} />
            <Field k="Monthly premium" v={p.monthly_premium == null ? null : money(p.monthly_premium)} />
            <Field k="Policy #" v={p.policy_number} />
            <Field k="Bank" v={p.bank_name} />
            <Field k="Draft day" v={p.draft_day} />
            <Field k="Tobacco" v={p.tobacco == null ? null : p.tobacco ? "Yes" : "No"} />
            <Field k="DOB" v={p.client_dob} />
            <Field k="SSN (last 4)" v={p.ssn_last4 ? `•••-••-${p.ssn_last4}` : null} />
          </div>
          {p.client_street && <Field k="Address" v={[p.client_street, p.client_city, p.client_state, p.client_zip].filter(Boolean).join(", ")} />}
          {p.health_notes && <Field k="Health" v={p.health_notes} />}

          {bens.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Beneficiaries</div>
              <ul className="space-y-0.5">
                {bens.map((b) => (
                  <li key={`${b.name ?? "ben"}|${b.relationship ?? ""}|${b.pct ?? ""}`} className="flex justify-between">
                    <span>{b.name ?? "—"}{b.relationship ? ` · ${b.relationship}` : ""}{b.contingent ? " (contingent)" : ""}</span>
                    <span className="tabular-nums">{b.pct != null ? `${b.pct}%` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(p.has_ssn || p.has_bank) && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Lock className="h-3 w-3" />Sensitive — for booking only</div>
              {sensitive ? (
                <div className="rounded-lg border border-border/60 bg-background/40 p-2 font-mono text-xs">
                  <Field k="SSN" v={sensitive.ssn ?? "—"} />
                  <Field k="Bank account" v={sensitive.bank_account ?? "—"} />
                  <Field k="Routing" v={sensitive.bank_routing ?? "—"} />
                  <p className="mt-1 font-sans text-[11px] text-muted-foreground">Confirm against the recording before booking — digits are transcribed best-effort.</p>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={reveal} disabled={revealing}>
                  {revealing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Unlock className="mr-1 h-3.5 w-3.5" />}
                  Reveal SSN &amp; bank (logged)
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-amber-500/20 pt-3">
            {p.recording_url && (
              <Button asChild variant="outline" size="sm">
                <a href={p.recording_url} target="_blank" rel="noopener noreferrer"><Headphones className="mr-1 h-3.5 w-3.5" />Recording{mmss(p.duration_seconds)}</a>
              </Button>
            )}
            {p.status === "booked" ? (
              <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" />Booked {dateStr(p.booked_at)}</span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-medium">{v ?? "—"}</span>
    </div>
  );
}

export default SoldCallPanel;
