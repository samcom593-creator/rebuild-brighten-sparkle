// CommissionGrids · mirrors AgentLink's "Commission Grids" sidebar item
//
// Shows every active product + carrier + first-year % + renewal % + advance months.
// Filterable by carrier and category. Sortable by first-year %.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Percent, Filter, ArrowUpDown, RefreshCw, Briefcase, Search, Calendar,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

interface GridRow {
  product_id: string;
  product_name: string;
  category: string;
  min_age: number | null;
  max_age: number | null;
  has_graded: boolean | null;
  has_gi: boolean | null;
  carrier_id: string | null;
  carrier_name: string | null;
  carrier_logo: string | null;
  first_year_pct: number | null;
  renewal_pct: number | null;
  advance_months: number | null;
  effective_date: string | null;
}

const CAT_LABEL: Record<string, string> = {
  final_expense: "Final Expense",
  si_whole_life: "Whole Life",
  si_ul:         "IUL",
  mortgage_protection: "Mortgage Protection",
  other:         "Other",
};

export default function CommissionGrids() {
  usePageTitle("Commission Grids · APEX");
  const [search, setSearch] = useState("");
  const [carrierFilter, setCarrierFilter] = useState<string>("All");
  const [catFilter, setCatFilter] = useState<string>("All");
  const [sortDesc, setSortDesc] = useState(true);

  const grid = useQuery({
    queryKey: ["commission-grid"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_commission_grid" as any).select("*").limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as GridRow[];
    },
    staleTime: 10 * 60_000,
  });

  const carriers = useMemo(() => {
    const set = new Set<string>();
    (grid.data ?? []).forEach((r) => { if (r.carrier_name) set.add(r.carrier_name); });
    return Array.from(set).sort();
  }, [grid.data]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    (grid.data ?? []).forEach((r) => { if (r.category) set.add(r.category); });
    return Array.from(set).sort();
  }, [grid.data]);

  const rows = useMemo(() => {
    let r = grid.data ?? [];
    if (carrierFilter !== "All") r = r.filter((x) => x.carrier_name === carrierFilter);
    if (catFilter !== "All")     r = r.filter((x) => x.category === catFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter((x) =>
        x.product_name.toLowerCase().includes(q) ||
        (x.carrier_name ?? "").toLowerCase().includes(q)
      );
    }
    return [...r].sort((a, b) => {
      const av = Number(a.first_year_pct ?? -1);
      const bv = Number(b.first_year_pct ?? -1);
      return sortDesc ? bv - av : av - bv;
    });
  }, [grid.data, carrierFilter, catFilter, search, sortDesc]);

  const fmtPct = (n: number | null) => n == null ? "—" : `${Number(n).toFixed(2)}%`;

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Contracting"
        eyebrowIcon={<Percent className="h-3 w-3" />}
        title="Commission Grids"
        subtitle="First-year %, renewal %, and advance schedule per carrier × product. Mirrors AgentLink's Commission Grids."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-11">{rows.length} products</Badge>
            <Button variant="outline" size="sm" onClick={() => grid.refetch()}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${grid.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search product or carrier…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          className="border border-border bg-background rounded-md px-3 py-2 text-13"
          value={carrierFilter}
          onChange={(e) => setCarrierFilter(e.target.value)}
        >
          <option value="All">All Carriers</option>
          {carriers.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          className="border border-border bg-background rounded-md px-3 py-2 text-13"
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
        >
          <option value="All">All Categories</option>
          {categories.map((c) => <option key={c} value={c}>{CAT_LABEL[c] ?? c}</option>)}
        </select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {grid.isLoading ? (
            <div className="p-4 space-y-2">{Array.from({length:5}).map((_,i)=><Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-13">
                <thead className="border-b border-border bg-muted/30 text-12 uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-semibold">Product</th>
                    <th className="text-left px-3 py-2.5 font-semibold">Carrier</th>
                    <th className="text-left px-3 py-2.5 font-semibold">Category</th>
                    <th className="text-right px-3 py-2.5 font-semibold">
                      <button onClick={() => setSortDesc(!sortDesc)} className="inline-flex items-center gap-1 hover:text-foreground">
                        FY %
                        {sortDesc ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                      </button>
                    </th>
                    <th className="text-right px-3 py-2.5 font-semibold">Renewal %</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Advance (mo)</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Ages</th>
                    <th className="text-left px-3 py-2.5 font-semibold">Features</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {rows.map((r) => (
                    <tr key={r.product_id} className="hover:bg-muted/20 transition-base">
                      <td className="px-3 py-2.5 font-medium">{r.product_name}</td>
                      <td className="px-3 py-2.5 text-foreground/80">{r.carrier_name ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <Badge variant="outline" className="text-11">{CAT_LABEL[r.category] ?? r.category}</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-bold text-emerald-600 dark:text-emerald-400">{fmtPct(r.first_year_pct)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-foreground/80">{fmtPct(r.renewal_pct)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.advance_months ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-foreground/70">
                        {(r.min_age != null && r.max_age != null) ? `${r.min_age}–${r.max_age}` : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1">
                          {r.has_graded && <Badge variant="outline" className="text-11 bg-amber-500/10 border-amber-500/30 text-amber-700">Graded</Badge>}
                          {r.has_gi     && <Badge variant="outline" className="text-11 bg-rose-500/10 border-rose-500/30 text-rose-700">GI</Badge>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">
                      <Filter className="h-5 w-5 mx-auto mb-2 opacity-50" />
                      No products match your filter.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-11 text-muted-foreground">
        Rates shown are typical/illustrative for the contracted level. Your personal commission tier may differ — confirm with your manager or on your carrier contract.
      </p>
    </div>
  );
}
