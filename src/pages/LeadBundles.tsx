// LeadBundles: Sam and Aisha package dialer leads and choose who works them (MP-310 wave 3, 2026-10-29).
//
// Sam: "assign a certain amount of leads at different bundles, different formats, different packages, from the quality
// of the leads, to different agents or managers ... dispatch those leads as leads called, as POSs ... revoke access,
// give access, and put them inside of people's accounts, only certain people, and I choose at any point."
// Tiers come from v_readymode_lead_quality. A lead sits in one live bundle at a time and do-not-call numbers never
// enter one (the RPCs refuse them). Every write is a lead_bundle_* RPC gated by can_view_sold_calls(); the page also
// hides itself from everyone else, and a holder sees their leads on My Leads.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, ChevronDown, Phone, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { looseSupabase } from "@/lib/looseSupabase";
import { useAuth } from "@/hooks/useAuth";
import { canViewSoldCalls } from "@/hooks/useSoldCallKeys";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useConfirm } from "@/hooks/useConfirm";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPhoneDisplay, phoneHref } from "@/lib/phone";
import { CALLED_LEAD_TIERS, canDial, formatLabel, leadStatusLabel, tierLabel } from "@/lib/leadBundles";
import { closerOptionLabel, fetchClosers, type CloserOption } from "@/lib/closers";
import { cn } from "@/lib/utils";

interface PoolRow { quality_tier: string; quality_reason: string; available: number; in_live_bundles: number }
interface Holder { user_id: string; name: string | null; granted_at: string | null }
interface Bundle {
  bundle_id: string;
  name: string;
  format: string;
  note: string | null;
  created_at: string;
  live_items: number;
  untouched: number;
  appointments: number;
  sold: number;
  closed_out: number;
  holders: Holder[] | null;
}
interface Item { id: string; first_name: string | null; last_name: string | null; phone10: string; quality_tier: string | null; status: string; status_note: string | null; last_dialed_at: string | null }

const TIER_ORDER = ["pos", "A", "B", "C", "D"];
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const selectClass = "h-9 rounded-md border border-border bg-background px-2 text-sm";

async function fetchPool(days: number): Promise<PoolRow[]> {
  const { data, error } = await supabase.rpc("lead_bundle_pool" as never, { p_min_days_since_dialed: days } as never);
  if (error) throw new Error(error.message);
  // Do-not-call numbers are counted by the pool but can never be bundled (lead_bundle_create refuses them), so they are
  // not offered here.
  return ((Array.isArray(data) ? data : []) as PoolRow[])
    .filter((r) => r.quality_tier !== "blocked")
    .sort((a, b) => TIER_ORDER.indexOf(a.quality_tier) - TIER_ORDER.indexOf(b.quality_tier));
}
async function fetchBundles(): Promise<Bundle[]> {
  const { data, error } = await looseSupabase
    .from<Bundle>("v_lead_bundle_summary")
    .select("bundle_id, name, format, note, created_at, live_items, untouched, appointments, sold, closed_out, holders")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}
async function fetchItems(bundleId: string): Promise<Item[]> {
  const { data, error } = await looseSupabase
    .from<Item>("lead_bundle_items")
    .select("id, first_name, last_name, phone10, quality_tier, status, status_note, last_dialed_at")
    .eq("bundle_id", bundleId)
    .is("removed_at", null)
    .order("added_at", { ascending: true })
    .limit(2000);
  if (error) throw error;
  return data ?? [];
}

export default function LeadBundles() {
  const { isAdmin, user } = useAuth();
  usePageTitle("Lead Bundles");
  if (!canViewSoldCalls(!!isAdmin, user?.id)) {
    return <EmptyState icon={<Boxes className="h-6 w-6" />} title="Lead Bundles is for Sam and Aisha" description="Leads given to you are on My Leads." />;
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Lead Bundles" subtitle="Package dialer leads by quality, give them to the agents and managers you pick, and take them back any time." />
      <CreateBundle />
      <BundleList />
    </div>
  );
}

function CreateBundle() {
  const qc = useQueryClient();
  const [minDays, setMinDays] = useState("7");
  const days = Math.max(0, Math.min(365, Number(minDays) || 0));
  const pool = useQuery({ queryKey: ["lead-bundle-pool", days], queryFn: () => fetchPool(days), staleTime: 60_000 });
  const [name, setName] = useState("");
  const [format, setFormat] = useState<"called_leads" | "pos">("called_leads");
  const [tiers, setTiers] = useState<string[]>(["A"]);
  const [size, setSize] = useState("100");
  const [note, setNote] = useState("");
  const create = useMutation({
    mutationFn: async () => {
      const n = Number(size);
      if (!Number.isInteger(n) || n < 1 || n > 2000) throw new Error("A bundle holds 1 to 2,000 leads.");
      if (format === "called_leads" && tiers.length === 0) throw new Error("Pick at least one tier.");
      const { data, error } = await supabase.rpc("lead_bundle_create" as never, {
        p_name: name.trim() || null, p_format: format, p_tiers: format === "pos" ? ["pos"] : tiers,
        p_min_days_since_dialed: days, p_limit: n, p_note: note.trim() || null,
      } as never);
      if (error) throw new Error(error.message);
      return (data ?? {}) as { bundle_id?: string; items?: number };
    },
    onSuccess: (r) => {
      toast.success(r.items ? `Bundle made with ${r.items} leads. Give it to someone below.` : "Bundle made, but no lead matched. Widen the tiers or lower the days.");
      setName("");
      setNote("");
      void qc.invalidateQueries({ queryKey: ["lead-bundle-pool"] });
      void qc.invalidateQueries({ queryKey: ["lead-bundles"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = (t: string) => setTiers((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  return (
    <GlassCard className="space-y-4 p-4">
      <p className="text-sm font-semibold">Leads ready to give</p>
      {pool.isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((n) => <Skeleton key={`pool-sk-${n}`} className="h-6 w-full" />)}</div>
      ) : pool.isError ? (
        <p className="text-sm text-rose-700 dark:text-rose-300">The lead pool did not load: {(pool.error as Error).message}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="py-1 pr-2">Tier</th><th className="px-2">What it means</th><th className="px-2 text-right">Ready to give</th><th className="px-2 text-right">In bundles now</th></tr>
            </thead>
            <tbody>
              {(pool.data ?? []).map((r) => (
                <tr key={r.quality_tier} className="border-t border-border/40">
                  <td className="py-1.5 pr-2 font-medium">{tierLabel(r.quality_tier)}</td>
                  <td className="px-2 text-muted-foreground">{r.quality_reason}</td>
                  <td className="px-2 text-right font-semibold tabular-nums">{Number(r.available).toLocaleString()}</td>
                  <td className="px-2 text-right tabular-nums">{Number(r.in_live_bundles).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-muted-foreground">Do-not-call numbers are left out and never go in a bundle.</p>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 text-sm"><span className="block text-xs font-medium text-muted-foreground">Name (optional)</span><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Warm leads for Meja" /></label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium text-muted-foreground">Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value === "pos" ? "pos" : "called_leads")} className={cn(selectClass, "w-full")}>
            <option value="called_leads">Called leads</option>
            <option value="pos">POS (bought on a call)</option>
          </select>
        </label>
        <label className="space-y-1 text-sm"><span className="block text-xs font-medium text-muted-foreground">How many leads (1 to 2,000)</span><Input value={size} onChange={(e) => setSize(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" /></label>
        <label className="space-y-1 text-sm"><span className="block text-xs font-medium text-muted-foreground">Last dialed at least this many days ago</span><Input value={minDays} onChange={(e) => setMinDays(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" /></label>
        <label className="space-y-1 text-sm md:col-span-2"><span className="block text-xs font-medium text-muted-foreground">Note (optional)</span><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></label>
      </div>
      {format === "called_leads" && (
        <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">Tiers</legend>
          {CALLED_LEAD_TIERS.map((t) => (
            <label key={t.key} className="inline-flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4" checked={tiers.includes(t.key)} onChange={() => toggle(t.key)} />
              {t.label}
            </label>
          ))}
        </fieldset>
      )}
      <Button type="button" disabled={create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Making it…" : "Make the bundle"}</Button>
    </GlassCard>
  );
}

function BundleList() {
  const q = useQuery({ queryKey: ["lead-bundles"], queryFn: fetchBundles, staleTime: 30_000 });
  const closers = useQuery({ queryKey: ["closer-candidates"], queryFn: fetchClosers, staleTime: 10 * 60_000 });
  if (q.isLoading) return <div className="space-y-2">{[1, 2, 3].map((n) => <Skeleton key={`bundle-sk-${n}`} className="h-24 w-full" />)}</div>;
  if (q.isError) return <EmptyState icon={<Boxes className="h-6 w-6" />} title="Bundles did not load" description={(q.error as Error).message} />;
  const list = q.data ?? [];
  if (list.length === 0) return <EmptyState icon={<Boxes className="h-6 w-6" />} title="No bundles yet" description="Make one above, then give it to an agent or a manager." />;
  return (
    <div className="space-y-3">
      {list.map((b) => <BundleCard key={b.bundle_id} b={b} closers={closers.data ?? []} />)}
    </div>
  );
}

function BundleCard({ b, closers }: { b: Bundle; closers: CloserOption[] }) {
  const qc = useQueryClient();
  const askToConfirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [giveTo, setGiveTo] = useState("");
  const items = useQuery({ queryKey: ["lead-bundle-items", b.bundle_id], queryFn: () => fetchItems(b.bundle_id), enabled: open, staleTime: 30_000 });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["lead-bundles"] });
    void qc.invalidateQueries({ queryKey: ["lead-bundle-items", b.bundle_id] });
    void qc.invalidateQueries({ queryKey: ["lead-bundle-pool"] });
  };
  const fail = (e: Error) => toast.error(e.message);
  const grant = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("lead_bundle_grant" as never, { p_bundle: b.bundle_id, p_user: giveTo, p_note: null } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Access given. The leads are on their My Leads page now."); setGiveTo(""); refresh(); },
    onError: fail,
  });
  const revoke = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("lead_bundle_revoke" as never, { p_bundle: b.bundle_id, p_user: userId } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Access taken back."); refresh(); },
    onError: fail,
  });
  const archive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("lead_bundle_archive" as never, { p_bundle: b.bundle_id } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Bundle archived. Nobody holds it on My Leads anymore."); refresh(); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.rpc("lead_bundle_remove_item" as never, { p_item: itemId } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Lead taken out of the bundle."); refresh(); },
    onError: fail,
  });
  const onArchive = async () => {
    const ok = await askToConfirm({ title: `Archive ${b.name}?`, description: "Everyone holding it loses it from My Leads. What they recorded stays on file.", confirmText: "Archive" });
    if (ok) archive.mutate();
  };
  const holders = b.holders ?? [];
  const holderIds = new Set(holders.map((h) => h.user_id));
  return (
    <GlassCard className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{b.name} <Badge variant="outline" className="ml-1 font-normal">{formatLabel(b.format)}</Badge></p>
          <p className="text-xs text-muted-foreground">
            Made {shortDate(b.created_at)} · {b.live_items} leads · {b.untouched} not called yet · {b.appointments} appointments · {b.sold} sold · {b.closed_out} closed out
          </p>
          {b.note && <p className="text-xs text-muted-foreground">{b.note}</p>}
        </div>
        <Button type="button" size="sm" variant="ghost" disabled={archive.isPending} onClick={() => void onArchive()}>Archive</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs font-medium text-muted-foreground">Held by</span>
        {holders.length === 0 && <span className="text-muted-foreground">nobody yet</span>}
        {holders.map((h) => (
          <span key={h.user_id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
            {h.name ?? "Someone"}
            <button type="button" title="Take back access" aria-label={`Take back access from ${h.name ?? "this person"}`} disabled={revoke.isPending} onClick={() => revoke.mutate(h.user_id)} className="text-rose-700 hover:text-rose-800 dark:text-rose-300 dark:hover:text-rose-200">
              <UserMinus className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        <select value={giveTo} onChange={(e) => setGiveTo(e.target.value)} aria-label="Give access to" className={selectClass}>
          <option value="">Give access to…</option>
          {closers.filter((c) => !holderIds.has(c.user_id)).map((c) => <option key={c.user_id} value={c.user_id}>{closerOptionLabel(c)}</option>)}
        </select>
        <Button type="button" size="sm" disabled={!giveTo || grant.isPending} onClick={() => grant.mutate()}>Give access</Button>
      </div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
        {open ? "Hide the leads" : "See the leads"} <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        items.isLoading ? <p className="text-sm text-muted-foreground">Loading the leads…</p>
        : items.isError ? <p className="text-sm text-rose-700 dark:text-rose-300">The leads did not load: {(items.error as Error).message}</p>
        : (items.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No live leads in this bundle.</p>
        : (
          <ul className="divide-y divide-border/40 text-sm">
            {(items.data ?? []).map((l) => {
              const href = canDial(l.status) ? phoneHref(l.phone10) : null;
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                  <span className="font-medium">{[l.first_name, l.last_name].filter(Boolean).join(" ") || "Name not on file"}</span>
                  {href ? (
                    <a href={href} className="inline-flex items-center gap-1 text-primary hover:underline"><Phone className="h-3.5 w-3.5" />{formatPhoneDisplay(l.phone10)}</a>
                  ) : (
                    <span className="text-muted-foreground">{formatPhoneDisplay(l.phone10)} · do not call</span>
                  )}
                  <span className="text-muted-foreground">{tierLabel(l.quality_tier)} · {leadStatusLabel(l.status)}{l.status_note ? `: ${l.status_note}` : ""}{l.last_dialed_at ? ` · last dialed ${shortDate(l.last_dialed_at)}` : ""}</span>
                  <Button type="button" size="sm" variant="ghost" className="ml-auto" disabled={remove.isPending} onClick={() => remove.mutate(l.id)}>Remove</Button>
                </li>
              );
            })}
          </ul>
        )
      )}
    </GlassCard>
  );
}
