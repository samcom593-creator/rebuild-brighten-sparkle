// CarrierResources · mirrors agentlink.insuracloud.ai/carriers
//
// Sam's note 2026-06-13: "missing so much data · car plans stuff too · every
// side navigation, every portion, every display." AgentLink's /carriers page
// shows each of 22 carrier partners as a resource card with:
//   - Logo
//   - Contact phone
//   - Website
//   - Avg contracting time
//   - "Best For:" tag(s)
//   - View Resources + Request to Contract actions
//
// We mirror via agentlink_carriers (16 rows live) joined to per-carrier
// production from agentlink_deals_snapshot (premium · deals · share).

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Phone, Globe, Briefcase, RefreshCw, FileText, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface Carrier {
  id: number;
  name: string | null;
  logo_url: string | null;
  phone: string | null;
  website: string | null;
  is_active: boolean | null;
}

interface CarrierProd {
  carrier_id: number;
  carrier_name: string;
  deal_count: number;
  total_premium: string;
}

function fmtUsd(n: number): string {
  const v = Number(n ?? 0);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

// Best-For mapping derived from real production patterns
const BEST_FOR: Record<string, string[]> = {
  "American Home Life": ["Final Expense", "Whole Life"],
  "Royal Neighbors":   ["Final Expense"],
  "Transamerica":      ["Final Expense", "Immediate Solution"],
  "Mutual of Omaha":   ["IUL", "Whole Life"],
  "Foresters":         ["PlanRight", "Children"],
  "Combined":          ["Final Expense"],
  "Aflac":             ["Supplemental"],
  "Athene Annuity":    ["Annuity"],
  "Baltimore Life":    ["Iprovide", "Final Expense"],
  "Fidelity & Guaranty": ["Annuity", "IUL"],
  "Guarantee Trust Life": ["Heritage"],
  "National Life Group": ["IUL", "Term"],
  "Newbridge":         ["Final Expense"],
  "Prudential":        ["Term", "Permanent Life"],
  "American Amicable": ["Final Expense"],
  "Instabrain":        ["Tech Tools"],
};

export default function CarrierResources() {
  usePageTitle("Carrier Resources · APEX");

  const carriers = useQuery({
    queryKey: ["carrier-resources"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agentlink_carriers" as any)
        .select("id, name, logo_url, phone, website, is_active")
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Carrier[];
    },
    refetchInterval: 10 * 60_000,
  });

  const production = useQuery({
    queryKey: ["carrier-production"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_business_analytics_carriers" as any)
        .select("carrier_id, carrier_name, deal_count, total_premium");
      if (error) throw error;
      return (data ?? []) as unknown as CarrierProd[];
    },
    refetchInterval: 10 * 60_000,
  });

  const prodByCarrier = new Map<number, CarrierProd>();
  for (const p of production.data ?? []) prodByCarrier.set(p.carrier_id, p);

  const rows = (carriers.data ?? []).filter((c) => c.is_active !== false);

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Resources"
        eyebrowIcon={<Briefcase className="h-3 w-3" />}
        title="Carrier Resources"
        subtitle="Access comprehensive resources, documentation, and contracting information for all our carrier partners. Mirrors AgentLink's /carriers page."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-11">{rows.length} carriers</Badge>
            <Button variant="outline" size="sm" onClick={() => { carriers.refetch(); production.refetch(); }}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${carriers.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {carriers.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => {
            const prod = prodByCarrier.get(c.id);
            const bestFor = c.name ? BEST_FOR[c.name] ?? [] : [];
            return (
              <Card key={c.id} className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
                <CardContent className="p-4 flex flex-col h-full">
                  <div className="flex items-start gap-3 mb-3">
                    {c.logo_url ? (
                      <img src={c.logo_url} alt="" className="h-10 w-10 rounded-md object-contain bg-white border border-border" />
                    ) : (
                      <div className="h-10 w-10 rounded-md bg-primary/15 text-primary text-12 font-bold flex items-center justify-center">
                        {(c.name ?? "?").slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-15 font-bold truncate">{c.name ?? `Carrier #${c.id}`}</p>
                      {prod && (
                        <p className="text-11 text-emerald-600 dark:text-emerald-400 tabular-nums">
                          {prod.deal_count} deals · {fmtUsd(Number(prod.total_premium))} · 30d
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Contact + website */}
                  <div className="space-y-1 mb-3 text-12">
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className="flex items-center gap-2 text-foreground/80 hover:text-primary transition-base">
                        <Phone className="h-3 w-3 shrink-0" />
                        <span className="truncate">{c.phone}</span>
                      </a>
                    )}
                    {c.website && (
                      <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer"
                         className="flex items-center gap-2 text-foreground/80 hover:text-primary transition-base">
                        <Globe className="h-3 w-3 shrink-0" />
                        <span className="truncate">{c.website.replace(/^https?:\/\//,"").replace(/\/$/,"")}</span>
                        <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                      </a>
                    )}
                  </div>

                  {/* Best For tags */}
                  {bestFor.length > 0 && (
                    <div className="mb-3">
                      <p className="text-11 uppercase tracking-wider font-semibold text-slate-500 mb-1.5">Best for</p>
                      <div className="flex flex-wrap gap-1.5">
                        {bestFor.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-11 bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions · mirrors AgentLink "View Resources / Request to Contract" */}
                  <div className="flex gap-2 mt-auto">
                    {c.website && (
                      <Button asChild variant="outline" size="sm" className="flex-1 gap-1.5">
                        <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer">
                          <FileText className="h-3.5 w-3.5" />
                          View Resources
                        </a>
                      </Button>
                    )}
                    <Button asChild variant="default" size="sm" className="flex-1 gap-1.5">
                      <a href={`/dashboard/contracts`}>
                        <Send className="h-3.5 w-3.5" />
                        Contract
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
