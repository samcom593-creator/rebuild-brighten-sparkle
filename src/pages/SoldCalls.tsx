// SoldCalls — My Business → Sold Calls.
//
// Every ReadyMode call dispositioned "Completed Sale", with the recording pulled,
// transcribed, and turned into a booking packet: the client + policy facts needed
// to submit the application to the carrier. SSN and bank account/routing are stored
// encrypted and revealed only on demand (admin + managers), and every reveal is logged.
//
// Data: v_sold_calls_queue (read), booking_packet_reveal_sensitive(uuid) and
// booking_packet_mark_booked(uuid,text) (RPCs). The view and RPCs are not in the
// generated types yet, so we go through looseSupabase.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, Clock, Download, FileAudio, Loader2, Lock, Phone, Search, ShieldAlert, Unlock, UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { looseSupabase } from "@/lib/looseSupabase";
import { useAuth } from "@/hooks/useAuth";
import { SOLD_CALL_EXTRA_UID } from "@/hooks/useSoldCallKeys";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { externalHref } from "@/lib/externalHref";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface Beneficiary { name?: string; relationship?: string; pct?: number | string; contingent?: boolean }
interface SoldRow {
  call_id: string;
  external_call_id: string | null;
  call_at: string | null;
  agent_raw: string | null;
  lead_first_name: string | null;
  lead_last_name: string | null;
  lead_phone: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  download_status: string | null;
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

const STATUS_META: Record<string, { label: string; tone: string }> = {
  no_recording: { label: "No recording", tone: "bg-muted text-muted-foreground" },
  downloading: { label: "Downloading", tone: "bg-amber-500/15 text-amber-300" },
  transcribing: { label: "Transcribing", tone: "bg-sky-500/15 text-sky-300" },
  needs_review: { label: "Needs review", tone: "bg-amber-500/15 text-amber-300" },
  ready: { label: "Ready to book", tone: "bg-emerald-500/15 text-emerald-300" },
  booked: { label: "Booked", tone: "bg-emerald-600/20 text-emerald-200" },
};

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready" },
  { key: "needs_review", label: "Needs review" },
  { key: "transcribing", label: "In progress" },
  { key: "booked", label: "Booked" },
];

const money = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const mmss = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const clientName = (r: SoldRow) =>
  [r.client_first_name ?? r.lead_first_name, r.client_last_name ?? r.lead_last_name].filter(Boolean).join(" ") || "Unknown client";
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");

async function fetchQueue(): Promise<SoldRow[]> {
  const { data, error } = await (looseSupabase
    .from("v_sold_calls_queue")
    .select("*")
    .order("call_at", { ascending: false }) as unknown as Promise<{ data: SoldRow[] | null; error: Error | null }>);
  if (error) throw error;
  return (data ?? []) as SoldRow[];
}

export default function SoldCalls() {
  const { isAdmin, user } = useAuth();
  const canView = !!isAdmin || user?.id === SOLD_CALL_EXTRA_UID;
  usePageTitle("Sold Calls");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["sold-calls-queue"], queryFn: fetchQueue, staleTime: 30_000 });
  const rows = useMemo(() => q.data ?? [], [q.data]);

  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const open = useMemo(() => rows.find((r) => r.call_id === openId) ?? null, [rows, openId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.packet_status !== filter) return false;
      if (!term) return true;
      return [clientName(r), r.agent_raw, r.carrier, r.product, r.policy_number, r.client_state]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [rows, filter, search]);

  const stats = useMemo(() => {
    const by = (s: string) => rows.filter((r) => r.packet_status === s).length;
    return { total: rows.length, ready: by("ready"), review: by("needs_review"), booked: by("booked") };
  }, [rows]);

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16 text-center text-sm text-muted-foreground">
        This page is restricted.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <PageHeader
        eyebrow="My Business"
        title="Sold Calls"
        subtitle="Every ReadyMode sale, transcribed into a booking packet. No re-listening to close the deal."
        accent="amber"
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { k: "Sold calls", v: stats.total, icon: Phone },
          { k: "Ready to book", v: stats.ready, icon: CheckCircle2 },
          { k: "Needs review", v: stats.review, icon: Clock },
          { k: "Booked", v: stats.booked, icon: FileAudio },
        ].map((s) => (
          <GlassCard key={s.k} className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><s.icon className="h-3.5 w-3.5" />{s.k}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{s.v}</div>
          </GlassCard>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client, agent, carrier, policy…" className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Status filter">
          {FILTERS.map((f) => (
            <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} onClick={() => setFilter(f.key)}>
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={`sk-${i}`} className="h-14 w-full" />)}</div>
      ) : q.isError ? (
        <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="Could not load sold calls" description={String((q.error as Error)?.message ?? "Unknown error")} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Phone className="h-6 w-6" />} title="No sold calls here" description="Nothing matches this filter yet." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Date</th><th className="px-3 py-2">Client</th>
                <th className="px-3 py-2 hidden sm:table-cell">Agent</th>
                <th className="px-3 py-2 hidden md:table-cell">Carrier / Product</th>
                <th className="px-3 py-2 text-right">Premium</th><th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.call_id} onClick={() => setOpenId(r.call_id)}
                    className="cursor-pointer border-t border-border/40 hover:bg-muted/30">
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{shortDate(r.call_at)}</td>
                  <td className="px-3 py-2 font-medium">{clientName(r)}<span className="ml-1 text-xs text-muted-foreground">{r.client_state ?? ""}</span></td>
                  <td className="px-3 py-2 hidden sm:table-cell text-muted-foreground">{r.agent_raw ?? "—"}</td>
                  <td className="px-3 py-2 hidden md:table-cell">{r.carrier ?? "—"}{r.product ? ` · ${r.product}` : ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.monthly_premium)}</td>
                  <td className="px-3 py-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs", STATUS_META[r.packet_status]?.tone)}>
                      {STATUS_META[r.packet_status]?.label ?? r.packet_status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PacketDrawer row={open} onClose={() => setOpenId(null)} onBooked={() => qc.invalidateQueries({ queryKey: ["sold-calls-queue"] })} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value ?? "—"}</span>
    </div>
  );
}

function PacketDrawer({ row, onClose, onBooked }: { row: SoldRow | null; onClose: () => void; onBooked: () => void }) {
  const [sensitive, setSensitive] = useState<{ ssn?: string; bank_account?: string; bank_routing?: string } | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [booking, setBooking] = useState(false);
  const [policyInput, setPolicyInput] = useState("");

  // Reset reveal when switching rows.
  const key = row?.call_id ?? null;
  useMemo(() => { setSensitive(null); setPolicyInput(""); }, [key]);

  if (!row) return null;
  const money2 = (n: number | null) => (n == null ? "—" : money(n));
  const recordingHref = externalHref(row.recording_url);

  const reveal = async () => {
    if (!row.packet_id) return;
    setRevealing(true);
    const { data, error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)("booking_packet_reveal_sensitive", { p_id: row.packet_id });
    setRevealing(false);
    if (error) { toast.error("Reveal failed", { description: error.message }); return; }
    const rec = Array.isArray(data) ? data[0] : data;
    setSensitive(rec ?? {});
    toast.success("Sensitive fields revealed — this access was logged.");
  };

  const markBooked = async () => {
    if (!row.packet_id) return;
    const policy = policyInput.trim();
    setBooking(true);
    const { error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>)("booking_packet_mark_booked", { p_id: row.packet_id, p_policy: policy });
    setBooking(false);
    if (error) { toast.error("Could not mark booked", { description: error.message }); return; }
    toast.success("Marked booked.");
    onBooked();
    onClose();
  };

  const bens = row.beneficiaries ?? [];

  return (
    <Sheet open={!!row} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><UserRound className="h-4 w-4" />{clientName(row)}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {(row.call_summary || (row.key_points && row.key_points.length > 0)) && (
            <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-500 dark:text-emerald-400">Call summary</h3>
              {row.call_summary && <p className="text-sm text-foreground">{row.call_summary}</p>}
              {row.key_points && row.key_points.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                  {row.key_points.map((k) => <li key={k}>{k}</li>)}
                </ul>
              )}
            </section>
          )}
          {row.missing_fields && row.missing_fields.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <div className="mb-1 flex items-center gap-1.5 font-medium text-amber-300"><ShieldAlert className="h-3.5 w-3.5" />Still needed from client</div>
              <ul className="list-disc pl-5 text-amber-200/90">{row.missing_fields.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}

          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client</h3>
            <Field label="Name" value={clientName(row)} />
            <Field label="State" value={row.client_state} />
            <Field label="Phone" value={row.lead_phone} />
            <Field label="SSN (last 4)" value={row.ssn_last4 ? `•••-••-${row.ssn_last4}` : "—"} />
          </section>

          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Policy</h3>
            <Field label="Status" value={STATUS_META[row.packet_status]?.label ?? row.packet_status} />
            <Field label="Carrier" value={row.carrier} />
            <Field label="Product" value={row.product} />
            <Field label="Face amount" value={money2(row.face_amount)} />
            <Field label="Monthly premium" value={money2(row.monthly_premium)} />
            <Field label="Draft day" value={row.draft_day} />
            <Field label="Payment" value={row.payment_method_type && row.payment_method_type !== "unknown" ? row.payment_method_type : null} />
            <Field label="Policy #" value={row.policy_number} />
          </section>

          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Beneficiaries</h3>
            {bens.length === 0 ? <p className="text-sm text-muted-foreground">None captured.</p> : (
              <ul className="space-y-1 text-sm">
                {bens.map((b, i) => (
                  <li key={`ben-${i}`} className="flex justify-between">
                    <span>{b.name ?? "—"}{b.relationship ? ` · ${b.relationship}` : ""}{b.contingent ? " (contingent)" : ""}</span>
                    <span className="tabular-nums">{b.pct != null ? `${b.pct}%` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Lock className="h-3 w-3" />Sensitive — for booking only
            </h3>
            {!row.has_ssn && !row.has_bank ? (
              <p className="text-sm text-muted-foreground">No SSN or bank details captured on this call.</p>
            ) : sensitive ? (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3 font-mono text-sm">
                <Field label="SSN" value={sensitive.ssn ?? "—"} />
                <Field label="Bank account" value={sensitive.bank_account ?? "—"} />
                <Field label="Routing" value={sensitive.bank_routing ?? "—"} />
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={reveal} disabled={revealing}>
                {revealing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Unlock className="mr-1 h-3.5 w-3.5" />}
                Reveal SSN &amp; bank (logged)
              </Button>
            )}
          </section>

          <section className="flex flex-wrap gap-2 border-t border-border/40 pt-3">
            {recordingHref && (
              <Button asChild variant="outline" size="sm">
                <a href={recordingHref} target="_blank" rel="noopener noreferrer"><Download className="mr-1 h-3.5 w-3.5" />Recording ({mmss(row.duration_seconds)})</a>
              </Button>
            )}
            {row.status !== "booked" && row.packet_id && (
              <Input
                value={policyInput}
                onChange={(e) => setPolicyInput(e.target.value)}
                placeholder="Policy number (optional)"
                aria-label="Policy number for this booked deal (optional)"
                className="h-9 w-48"
                disabled={booking}
              />
            )}
            {row.status !== "booked" && row.packet_id && (
              <Button size="sm" onClick={markBooked} disabled={booking}>
                {booking ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                Mark booked
              </Button>
            )}
            {row.status === "booked" && <Badge variant="outline">Booked {shortDate(row.booked_at)}</Badge>}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
