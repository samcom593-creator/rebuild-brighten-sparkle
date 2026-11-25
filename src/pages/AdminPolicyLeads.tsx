import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Phone, Mail, ExternalLink, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { contactLinkProps, phoneHref } from "@/lib/phone";
import { QueryState } from "@/components/ui/query-state";
import { LeadFilterSelect, LeadPagination, LeadSearchField } from "@/components/leads/LeadWorklistControls";
import { useLeadPagination } from "@/hooks/useLeadPagination";
import { matchesLeadQuery } from "@/lib/leadWorklist";

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
  const [state, setState] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("newest");

  const statsQuery = useQuery<PhcStats>({
    queryKey: ["phc-lead-stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("phc_admin_lead_stats");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || ![row.total, row.today, row.uncalled].every((value) => typeof value === "number" && Number.isFinite(value))) {
        throw new Error("The policy lead totals were not returned. Retry to refresh them.");
      }
      return row as PhcStats;
    },
    staleTime: 60_000,
    refetchInterval: 300_000,
  });

  const { data: leads = [], isLoading, isError, error, refetch } = useQuery<PhcLead[]>({
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
    return leads.filter((lead) => (!state || lead.state === state) && (!status || lead.status === status)
      && matchesLeadQuery(search, [lead.first_name, lead.email, lead.state, lead.help_category, lead.utm_campaign, lead.current_carrier, lead.lead_code], [lead.phone_e164]))
      .sort((a, b) => sort === "oldest" ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at));
  }, [leads, search, state, status, sort]);
  const pagination = useLeadPagination(filtered, JSON.stringify([search, state, status, sort]));
  const states = [...new Set(leads.map((lead) => lead.state).filter((value): value is string => !!value))].sort();
  const statuses = [...new Set(leads.map((lead) => lead.status))].sort();
  const filtersActive = !!(search.trim() || state || status || sort !== "newest");
  const resetFilters = () => { setSearch(""); setState(""); setStatus(""); setSort("newest"); };
  const stats = statsQuery.isError ? undefined : statsQuery.data;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Policy Help Center — Leads
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Consumer policy-review inbounds. Separate from recruiting.{" "}
            <a
              href="https://policy-help-center-gamma.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              View site <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total leads", value: stats?.total },
          { label: "Today", value: stats?.today },
          { label: "Not yet worked", value: stats?.uncalled },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="text-2xl font-bold tabular-nums">{s.value?.toLocaleString() ?? (statsQuery.isLoading ? "…" : "—")}</div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      {statsQuery.isError && <QueryState status="error" label="policy lead totals" error={statsQuery.error} onRetry={() => void statsQuery.refetch()} compact />}

      <section aria-label="Filter policy leads" className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <LeadSearchField label="Search policy leads" placeholder="Search name, phone, email, carrier or campaign…" value={search} onChange={setSearch} />
        <div className="grid gap-3 sm:grid-cols-3">
          <LeadFilterSelect label="Policy lead state" value={state} onChange={setState}>
            <option value="">All states</option>{states.map((value) => <option key={value} value={value}>{value}</option>)}
          </LeadFilterSelect>
          <LeadFilterSelect label="Policy lead status" value={status} onChange={setStatus}>
            <option value="">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}
          </LeadFilterSelect>
          <LeadFilterSelect label="Sort policy leads" value={sort} onChange={setSort}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          </LeadFilterSelect>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground" role="status">{isLoading ? "Loading policy leads…" : isError ? "Results unavailable" : `${filtered.length.toLocaleString()} matching leads · ${leads.length.toLocaleString()} loaded`}</p>
          {filtersActive && <Button type="button" variant="ghost" className="h-11" onClick={resetFilters}>Reset filters</Button>}
        </div>
        {leads.length >= 500 && <p className="text-sm text-muted-foreground">This view contains the latest {leads.length.toLocaleString()} leads{stats && stats.total > leads.length ? ` of ${stats.total.toLocaleString()} total` : ""}. Search and filters apply to these loaded leads.</p>}
        <p className="text-sm text-muted-foreground">Use the phone or email link to follow up. Lead status is read-only in this view.</p>
      </section>

      {isError ? (
        <QueryState status="error" label="policy leads" error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading leads…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            {leads.length === 0 ? "No policy-review leads yet. They appear here when someone submits the form or requests a call on the Policy Help Center site." : <>
              <p className="font-medium text-foreground">No policy leads match these filters.</p>
              <p className="mt-1">Change the search, state or status to find another lead.</p>
              <Button type="button" variant="outline" className="mt-3 h-11" onClick={resetFilters}>Show all policy leads</Button>
            </>}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pagination.items.map((l) => (
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
                    href={phoneHref(l.phone_e164) ?? `tel:${l.phone_e164}`} {...contactLinkProps(phoneHref(l.phone_e164))}
                    className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary hover:underline"
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
      {!isError && !isLoading && <LeadPagination {...pagination} onPageChange={pagination.setPage} label="Policy leads" />}
    </div>
  );
}
