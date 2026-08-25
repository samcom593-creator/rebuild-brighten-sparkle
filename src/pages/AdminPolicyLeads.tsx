import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Phone, Mail, ExternalLink, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Policy Help Center — consumer leads, surfaced inside the APEX admin so Sam
 * works them in one place. These are B2C policy-review inbounds (people who
 * already OWN life insurance), deliberately kept separate from the recruiting
 * applicants pipeline — different audience, different follow-up.
 *
 * Data comes from the SECURITY DEFINER RPCs phc_admin_leads() /
 * phc_admin_lead_stats(), which gate on has_role(admin) — the phc_leads table
 * itself is service-role-only. The live site: policy-help-center-gamma.vercel.app
 */

type PhcLead = {
  lead_code: string;
  created_at: string;
  first_name: string;
  phone_e164: string;
  email: string;
  state: string | null;
  help_category: string;
  callback_time: string | null;
  current_carrier: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  gclid: string | null;
  status: string;
};

type PhcStats = { total: number; today: number; uncalled: number };

const STATUS_STYLES: Record<string, string> = {
  new: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
  contacted: "bg-info/15 border-info/30 text-info",
  appointment: "bg-violet-500/15 border-violet-500/40 text-violet-300",
  application: "bg-amber-500/15 border-amber-500/40 text-amber-300",
  issued: "bg-green-600/20 border-green-600/50 text-green-300",
  dead: "bg-slate-500/15 border-slate-500/40 text-muted-foreground",
};

export default function AdminPolicyLeads() {
  const [search, setSearch] = useState("");

  const { data: stats } = useQuery<PhcStats>({
    queryKey: ["phc-lead-stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("phc_admin_lead_stats");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as PhcStats) ?? { total: 0, today: 0, uncalled: 0 };
    },
    staleTime: 60_000,
    refetchInterval: 300_000,
  });

  const { data: leads = [], isLoading } = useQuery<PhcLead[]>({
    queryKey: ["phc-leads"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("phc_admin_leads");
      if (error) throw error;
      return (data as PhcLead[]) ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 300_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) =>
      [l.first_name, l.phone_e164, l.email, l.state, l.help_category, l.utm_campaign]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [leads, search]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShieldCheck className="h-6 w-6 text-emerald-400" />
            Policy Help Center — Leads
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Consumer policy-review inbounds. Separate from recruiting.{" "}
            <a
              href="https://policy-help-center-gamma.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
            >
              View site <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total leads", value: stats?.total ?? 0 },
          { label: "Today", value: stats?.today ?? 0 },
          { label: "Not yet worked", value: stats?.uncalled ?? 0 },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="text-2xl font-bold tabular-nums">{s.value}</div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Input
        placeholder="Search name, phone, email, state, campaign…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md"
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading leads…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No policy-review leads yet. They appear here the moment someone submits the form or
            requests a call on the Policy Help Center site.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((l) => (
            <Card key={l.lead_code}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">
                    {l.first_name}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      · {l.state ?? "—"}
                    </span>
                  </CardTitle>
                  <Badge
                    variant="outline"
                    className={STATUS_STYLES[l.status] ?? STATUS_STYLES.new}
                  >
                    {l.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 pt-0 text-sm">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <a
                    href={`tel:${l.phone_e164}`}
                    className="inline-flex items-center gap-1.5 font-medium text-emerald-400 hover:underline"
                  >
                    <Phone className="h-4 w-4" />
                    {l.phone_e164}
                  </a>
                  <a
                    href={`mailto:${l.email}`}
                    className="inline-flex items-center gap-1.5 text-muted-foreground hover:underline"
                  >
                    <Mail className="h-4 w-4" />
                    {l.email}
                  </a>
                </div>
                <div className="text-muted-foreground">
                  <span className="font-medium text-foreground">{l.help_category}</span>
                  {l.callback_time ? ` · wants a call: ${l.callback_time}` : ""}
                  {l.current_carrier ? ` · carrier: ${l.current_carrier}` : ""}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{new Date(l.created_at).toLocaleString()}</span>
                  {l.utm_campaign && <span>campaign: {l.utm_campaign}</span>}
                  {l.gclid && <span className="text-emerald-500/70">Google Ads click</span>}
                  <span className="font-mono">{l.lead_code}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
