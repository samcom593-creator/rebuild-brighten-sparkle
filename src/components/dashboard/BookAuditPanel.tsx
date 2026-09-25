/**
 * BookAuditPanel — the "bot" view of the book of business (2026-09-24, Sam directive).
 *
 * Reads four live views (v_book_audit_totals / _tally / _by_agent / _items) that unite the AgentLink book
 * and the Ethos book and flag every LIVE policy that either (a) has no policy number or (b) sits with a
 * carrier Apex does not use (carrier_registry.relationship inactive/dormant — Foresters, Royal Neighbors,
 * American Amicable, SBLI). Tallies at the top, categorised; every flagged policy below with the carrier
 * to transfer it to. fn_book_audit_run() snapshots this daily (pg_cron 07:00 Phoenix) and pages Sam only
 * when something NEW lands.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, ShieldAlert, FileWarning, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Totals = {
  live_policies: number; live_alp: number;
  no_policy_number_n: number; no_policy_number_alp: number;
  unused_carrier_n: number; unused_carrier_alp: number;
  both_n: number; flagged_n: number;
  unused_by_carrier: Record<string, number> | null; unused_carriers: string | null;
  agentlink_book_as_of: string | null; ethos_book_as_of: string | null;
};
type Tally = { category: string; carrier: string; policies: number; alp: number; agents: number; last_30d: number };
type Item = {
  source: string; item_key: string; agent_name: string | null; client_name: string | null; carrier: string | null;
  product: string | null; policy_number: string | null; status: string | null; annual_premium: number | null;
  dated: string | null; age_days: number | null; category: string; reroute_to: string | null;
};
type ByAgent = {
  agent_name: string | null; no_policy_number_n: number; no_policy_number_alp: number;
  unused_carrier_n: number; unused_carrier_alp: number; unused_carriers: string | null; reroute_to: string | null; live_policies: number;
};

const CATEGORY_LABEL: Record<string, string> = {
  no_policy_number: "No policy number",
  unused_carrier: "Carrier we don't use",
  both: "Both",
};

const money = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n");
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BookAuditPanel() {
  const [category, setCategory] = useState<string>("all");
  const [carrier, setCarrier] = useState<string>("all");
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState(true);

  const totalsQ = useQuery({
    queryKey: ["book-audit-totals"],
    staleTime: 60_000,
    queryFn: async (): Promise<Totals | null> => {
      const { data, error } = await supabase.from("v_book_audit_totals" as never).select("*").maybeSingle();
      if (error) throw error;
      return (data as unknown as Totals) ?? null;
    },
  });
  const tallyQ = useQuery({
    queryKey: ["book-audit-tally"],
    staleTime: 60_000,
    queryFn: async (): Promise<Tally[]> => {
      const { data, error } = await supabase.from("v_book_audit_tally" as never).select("*");
      if (error) throw error;
      return (data ?? []) as unknown as Tally[];
    },
  });
  const itemsQ = useQuery({
    queryKey: ["book-audit-items"],
    staleTime: 60_000,
    queryFn: async (): Promise<Item[]> => {
      const { data, error } = await supabase
        .from("v_book_audit_items" as never)
        .select("source,item_key,agent_name,client_name,carrier,product,policy_number,status,annual_premium,dated,age_days,category,reroute_to")
        .neq("category", "ok")
        .order("annual_premium", { ascending: false, nullsFirst: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as unknown as Item[];
    },
  });
  const byAgentQ = useQuery({
    queryKey: ["book-audit-by-agent"],
    staleTime: 60_000,
    queryFn: async (): Promise<ByAgent[]> => {
      const { data, error } = await supabase.from("v_book_audit_by_agent" as never).select("*").limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as ByAgent[];
    },
  });

  const t = totalsQ.data;
  const carriers = useMemo(() => {
    const s = new Set<string>();
    (itemsQ.data ?? []).forEach((i) => { if (i.carrier) s.add(i.carrier); });
    return Array.from(s).sort();
  }, [itemsQ.data]);

  const filtered = useMemo(() => {
    return (itemsQ.data ?? []).filter((i) =>
      (category === "all" || i.category === category || (category === "no_policy_number" && i.category === "both") || (category === "unused_carrier" && i.category === "both")) &&
      (carrier === "all" || i.carrier === carrier),
    );
  }, [itemsQ.data, category, carrier]);
  const visible = showAll ? filtered : filtered.slice(0, 50);

  const exportCsv = () => {
    download(
      `book-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(filtered as unknown as Record<string, unknown>[], ["category", "agent_name", "client_name", "carrier", "product", "policy_number", "status", "annual_premium", "dated", "age_days", "reroute_to", "source", "item_key"]),
    );
  };

  const failed = totalsQ.isError || itemsQ.isError || tallyQ.isError;

  return (
    <GlassCard className="space-y-4 border-amber-500/30 p-4 sm:p-5" aria-label="Book audit">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
            <ShieldAlert className="h-4 w-4" /> Book audit · flagged policies
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Every live policy with no policy number, or with a carrier we don&apos;t use ({t?.unused_carriers ?? "…"}). Transfer these to a carrier we do use.
            {t?.agentlink_book_as_of && (
              <span className="ml-1 text-xs">AgentLink book as of {new Date(t.agentlink_book_as_of).toLocaleString()}.</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="mr-1.5 h-4 w-4" /> Export {filtered.length ? `(${filtered.length})` : ""}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {failed && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mr-1 inline h-4 w-4" /> The audit views did not load. This is a read failure, not a clean book — refresh, or check v_book_audit_* in Supabase.
        </div>
      )}

      {/* Tally — at the top, categorised */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {totalsQ.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={`sk-${i}`} className="h-20" />)
        ) : (
          <>
            <button
              type="button"
              onClick={() => { setCategory("all"); setCarrier("all"); }}
              className={cn("rounded-lg border p-3 text-left transition", category === "all" ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40")}
            >
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Flagged (of {t?.live_policies ?? 0} live)</div>
              <div className="text-2xl font-bold tabular-nums">{t?.flagged_n ?? 0}</div>
            </button>
            <button
              type="button"
              onClick={() => { setCategory("no_policy_number"); setCarrier("all"); }}
              className={cn("rounded-lg border p-3 text-left transition", category === "no_policy_number" ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40")}
            >
              <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground"><FileWarning className="h-3 w-3" /> No policy number</div>
              <div className="text-2xl font-bold tabular-nums">{t?.no_policy_number_n ?? 0}</div>
              <div className="text-xs text-muted-foreground">{money(t?.no_policy_number_alp)} ALP</div>
            </button>
            <button
              type="button"
              onClick={() => { setCategory("unused_carrier"); setCarrier("all"); }}
              className={cn("rounded-lg border p-3 text-left transition", category === "unused_carrier" ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40")}
            >
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Carriers we don&apos;t use</div>
              <div className="text-2xl font-bold tabular-nums">{t?.unused_carrier_n ?? 0}</div>
              <div className="text-xs text-muted-foreground">{money(t?.unused_carrier_alp)} ALP</div>
            </button>
            <div className="rounded-lg border border-border p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">By carrier</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {Object.entries(t?.unused_by_carrier ?? {}).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
                  <Badge
                    key={c}
                    variant={carrier === c ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => { setCategory("unused_carrier"); setCarrier(carrier === c ? "all" : c); }}
                  >
                    {c} · {n}
                  </Badge>
                ))}
                {(t?.both_n ?? 0) > 0 && <Badge variant="destructive">both · {t?.both_n}</Badge>}
              </div>
            </div>
          </>
        )}
      </div>

      {open && (
        <>
          {/* Per-category × carrier tally */}
          {!!tallyQ.data?.length && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr><th className="py-1 pr-3">Category</th><th className="py-1 pr-3">Carrier</th><th className="py-1 pr-3 text-right">Policies</th><th className="py-1 pr-3 text-right">ALP</th><th className="py-1 pr-3 text-right">Agents</th><th className="py-1 pr-3 text-right">Last 30d</th></tr>
                </thead>
                <tbody>
                  {tallyQ.data.map((r) => (
                    <tr key={`${r.category}-${r.carrier}`} className="cursor-pointer border-t border-border/50 hover:bg-muted/30" onClick={() => { setCategory(r.category); setCarrier(r.carrier); }}>
                      <td className="py-1 pr-3">{CATEGORY_LABEL[r.category] ?? r.category}</td>
                      <td className="py-1 pr-3">{r.carrier}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{r.policies}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{money(r.alp)}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{r.agents}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{r.last_30d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Per-agent rollup */}
          {!!byAgentQ.data?.length && (
            <details className="rounded-md border border-border/60 p-2">
              <summary className="cursor-pointer text-sm font-medium">By agent ({byAgentQ.data.length})</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr><th className="py-1 pr-3">Agent</th><th className="py-1 pr-3 text-right">No policy #</th><th className="py-1 pr-3 text-right">Unused carrier</th><th className="py-1 pr-3">Carriers</th><th className="py-1 pr-3">Move to</th></tr>
                  </thead>
                  <tbody>
                    {byAgentQ.data.map((r) => (
                      <tr key={r.agent_name ?? "unknown"} className="border-t border-border/50">
                        <td className="py-1 pr-3">{r.agent_name ?? "—"}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{r.no_policy_number_n} <span className="text-xs text-muted-foreground">{money(r.no_policy_number_alp)}</span></td>
                        <td className="py-1 pr-3 text-right tabular-nums">{r.unused_carrier_n} <span className="text-xs text-muted-foreground">{money(r.unused_carrier_alp)}</span></td>
                        <td className="py-1 pr-3 text-xs">{r.unused_carriers ?? "—"}</td>
                        <td className="py-1 pr-3 text-xs">{r.reroute_to ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {/* Every flagged policy */}
          <div className="overflow-x-auto">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>{filtered.length} flagged {category !== "all" ? `· ${CATEGORY_LABEL[category] ?? category}` : ""} {carrier !== "all" ? `· ${carrier}` : ""}</span>
              {(category !== "all" || carrier !== "all") && (
                <button type="button" className="underline" onClick={() => { setCategory("all"); setCarrier("all"); }}>clear filters</button>
              )}
            </div>
            {itemsQ.isLoading ? (
              <Skeleton className="h-40" />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr><th className="py-1 pr-3">Flag</th><th className="py-1 pr-3">Agent</th><th className="py-1 pr-3">Client</th><th className="py-1 pr-3">Carrier</th><th className="py-1 pr-3">Product</th><th className="py-1 pr-3">Policy #</th><th className="py-1 pr-3">Status</th><th className="py-1 pr-3 text-right">ALP</th><th className="py-1 pr-3 text-right">Age</th><th className="py-1 pr-3">Move to</th></tr>
                </thead>
                <tbody>
                  {visible.map((i) => (
                    <tr key={i.item_key} className="border-t border-border/50">
                      <td className="py-1 pr-3">
                        <Badge variant={i.category === "both" ? "destructive" : "outline"} className="text-[10px]">
                          {CATEGORY_LABEL[i.category] ?? i.category}
                        </Badge>
                      </td>
                      <td className="py-1 pr-3 whitespace-nowrap">{i.agent_name ?? "—"}</td>
                      <td className="py-1 pr-3 whitespace-nowrap">{i.client_name ?? "—"}</td>
                      <td className="py-1 pr-3 whitespace-nowrap">{i.carrier ?? "—"}</td>
                      <td className="py-1 pr-3 max-w-[180px] truncate">{i.product ?? "—"}</td>
                      <td className={cn("py-1 pr-3 font-mono text-xs", !i.policy_number && "text-destructive")}>{i.policy_number || "MISSING"}</td>
                      <td className="py-1 pr-3 text-xs">{i.status ?? "—"}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{money(i.annual_premium)}</td>
                      <td className="py-1 pr-3 text-right tabular-nums text-xs">{i.age_days ?? "—"}d</td>
                      <td className="py-1 pr-3 text-xs">{i.reroute_to ?? "—"}</td>
                    </tr>
                  ))}
                  {!visible.length && (
                    <tr><td colSpan={10} className="py-4 text-center text-muted-foreground">Nothing flagged under this filter.</td></tr>
                  )}
                </tbody>
              </table>
            )}
            {filtered.length > 50 && (
              <div className="mt-2 text-center">
                <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show top 50" : `Show all ${filtered.length}`}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </GlassCard>
  );
}

export default BookAuditPanel;
