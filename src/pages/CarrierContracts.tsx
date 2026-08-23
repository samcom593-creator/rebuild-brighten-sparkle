import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import {
  AlertTriangle, ExternalLink, Copy, Check, Link2, Users, Briefcase, ClipboardList,
  FileSignature, Sparkles, Building2, Files, Settings2, Search, UserPlus,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ContractingIntakeAdmin } from "@/components/contracting/ContractingIntakeAdmin";
import {
  ContractsBoard, useContractSummary, useContractRows,
} from "@/components/contracting/ContractsBoard";

/**
 * Contracting — carrier appointments, commission levels, writing numbers.
 *
 * 2026-08-23: the Contracts view showed a grid of share links and not one
 * contract. Its only contract source was v_my_carrier_contracts filtered
 * `.eq("user_id", user.id)`, and that view carries 0 of 21 rows with a
 * non-null user_id — so it returned nothing for every viewer since the day it
 * shipped. agentlink_contracts held 467 real rows that no screen displayed.
 * Contracts and Documents now read the real book through
 * apex_contracts_list / apex_contracts_summary (server-aggregated counts,
 * scope-resolved in one place so rows and headline cannot disagree).
 *
 * The share-link grid was not deleted — it moved to Requests, where sending a
 * link is the action, instead of standing in for the contracts themselves.
 */

type LinkItem = { id: string; label: string; url: string; meta?: string | null };
type LinkSection = { key: string; title: string; icon: React.ElementType; description: string; items: LinkItem[] };

const SECTION_TITLES = {
  recruiting: "Recruiting Links",
  agent: "Agent Links",
  onboarding: "Onboarding Links",
  application: "Application Links",
  contracting: "Contracting Links",
} as const;

const SECTION_ICONS: Record<string, React.ElementType> = {
  recruiting: Users, agent: Briefcase, onboarding: Sparkles, application: ClipboardList, contracting: FileSignature,
};

const SECTION_DESC: Record<string, string> = {
  recruiting: "Share with prospects · interview booking · public group",
  agent: "Your agent dashboard and bot DM",
  onboarding: "Send to a new hire after they sign · onboarding chat + bot DM",
  application: "Public apply form · paste into ads, DMs, and bios",
  contracting: "Per-carrier contract invite URLs (where set on AgentLink)",
};

type AgentlinkCarrier = { id: number; name: string | null; contract_invite_url: string | null; website: string | null };

// Values in system_settings are stored as JSON; many are double-quoted strings,
// some are objects ({url,label}). Normalize before use.
function unwrapSetting(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      try { return JSON.parse(trimmed); } catch { return raw; }
    }
    return raw;
  }
  return raw;
}

function asLinkObject(value: unknown, fallbackLabel: string): LinkItem | null {
  if (!value) return null;
  if (typeof value === "string") {
    if (!/^https?:\/\//i.test(value)) return null;
    return { id: fallbackLabel, label: fallbackLabel, url: value };
  }
  if (typeof value === "object" && value !== null && "url" in (value as Record<string, unknown>)) {
    const url = (value as Record<string, unknown>).url;
    const label = ((value as Record<string, unknown>).label as string) ?? fallbackLabel;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
    return { id: fallbackLabel, label, url };
  }
  return null;
}

export default function CarrierContracts() {
  const pathname = useLocation().pathname;
  const mode = pathname.endsWith("/carriers") ? "carriers"
    : pathname.endsWith("/ops") ? "ops"
    : pathname.endsWith("/requests") ? "requests"
    : pathname.endsWith("/documents") ? "documents"
    : "contracts";
  usePageTitle(`${mode === "contracts" ? "Contracts" : mode.charAt(0).toUpperCase() + mode.slice(1)} · APEX`);
  const { isAdmin, isManager } = useAuth();
  const canInvite = !!(isAdmin || isManager);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyLink = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      toast.success("Link copied");
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1500);
    } catch {
      toast.error("Couldn't copy. Long-press to share instead.");
    }
  };

  const settingsQ = useQuery({
    queryKey: ["link-hub-settings"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, unknown>> => {
      const keys = [
        "agentlink_master_invite", "telegram_bot_dm_url", "telegram_invite_url",
        "whatsapp_group_link", "seminar_calendly_url", "seminar_meeting_url",
        "seminar_meeting_url_label", "seminar_zoom_url",
      ];
      const { data, error } = await supabase.from("system_settings" as never).select("key, value").in("key", keys);
      if (error) throw error;
      const out: Record<string, unknown> = {};
      for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) out[row.key] = unwrapSetting(row.value);
      return out;
    },
  });

  const carriersQ = useQuery({
    queryKey: ["link-hub-carriers"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AgentlinkCarrier[]> => {
      const { data, error } = await supabase
        .from("agentlink_carriers" as never)
        .select("id, name, contract_invite_url, website")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as AgentlinkCarrier[];
    },
  });

  const masterInvite = asLinkObject((settingsQ.data ?? {}).agentlink_master_invite, "AgentLink master invite");

  const sections: LinkSection[] = useMemo(() => {
    const s = settingsQ.data ?? {};
    const carriers = carriersQ.data ?? [];
    const appOrigin = typeof window !== "undefined" ? window.location.origin : "https://apex-financial.org";

    const recruiting: LinkItem[] = [];
    const master = asLinkObject(s.agentlink_master_invite, "Join APEX on AgentLink");
    if (master) recruiting.push({ ...master, id: "rec-master-invite" });
    const calendly = asLinkObject(s.seminar_calendly_url, "Book an interview · Calendly");
    if (calendly) recruiting.push({ ...calendly, id: "rec-calendly" });
    const seminarLabel = (s.seminar_meeting_url_label as string) || "Live seminar";
    const seminarUrl = asLinkObject(s.seminar_meeting_url, seminarLabel);
    if (seminarUrl) recruiting.push({ ...seminarUrl, id: "rec-seminar", label: seminarLabel });
    const tgGroup = asLinkObject(s.telegram_invite_url, "APEX Telegram group");
    if (tgGroup) recruiting.push({ ...tgGroup, id: "rec-telegram-group" });
    const wa = asLinkObject(s.whatsapp_group_link, "APEX WhatsApp group");
    if (wa) recruiting.push({ ...wa, id: "rec-whatsapp" });

    const agent: LinkItem[] = [];
    if (master) agent.push({ ...master, id: "agent-master-invite", label: "AgentLink dashboard" });
    const botDm = asLinkObject(s.telegram_bot_dm_url, "Talk to the APEX bot");
    if (botDm) agent.push({ ...botDm, id: "agent-bot-dm" });

    const onboarding: LinkItem[] = [];
    if (botDm) onboarding.push({ ...botDm, id: "onb-bot-dm", label: "APEX bot · onboarding DM" });
    if (tgGroup) onboarding.push({ ...tgGroup, id: "onb-telegram-group", label: "APEX Telegram (onboarding)" });

    const application: LinkItem[] = [
      { id: "app-prod", label: "Apply form (production)", url: "https://apex-financial.org/apply" },
    ];
    if (appOrigin && !/apex-financial\.org$/i.test(new URL(appOrigin).hostname)) {
      application.push({ id: "app-current", label: "Apply form (this environment)", url: `${appOrigin}/apply` });
    }

    const contracting: LinkItem[] = [];
    for (const c of carriers) {
      if (!c.contract_invite_url) continue;
      contracting.push({ id: `ctr-${c.id}`, label: c.name ?? `Carrier #${c.id}`, url: c.contract_invite_url });
    }

    return [
      { key: "recruiting", title: SECTION_TITLES.recruiting, icon: SECTION_ICONS.recruiting, description: SECTION_DESC.recruiting, items: recruiting },
      { key: "agent", title: SECTION_TITLES.agent, icon: SECTION_ICONS.agent, description: SECTION_DESC.agent, items: agent },
      { key: "onboarding", title: SECTION_TITLES.onboarding, icon: SECTION_ICONS.onboarding, description: SECTION_DESC.onboarding, items: onboarding },
      { key: "application", title: SECTION_TITLES.application, icon: SECTION_ICONS.application, description: SECTION_DESC.application, items: application },
      { key: "contracting", title: SECTION_TITLES.contracting, icon: SECTION_ICONS.contracting, description: SECTION_DESC.contracting, items: contracting },
    ];
  }, [settingsQ.data, carriersQ.data]);

  const workspaceNav = (
    <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Contracting sections">
      {([
        ["contracts", "/dashboard/contracting", "Contracts"],
        ["carriers", "/dashboard/contracting/carriers", "Carriers"],
        ["ops", "/dashboard/contracting/ops", "Operations"],
        ["requests", "/dashboard/contracting/requests", "Requests"],
        ["documents", "/dashboard/contracting/documents", "Documents"],
      ] as const).map(([key, to, label]) => (
        <Button
          key={key}
          asChild
          variant="ghost"
          className={cn("rounded-none border-b-2 px-3", mode === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}
        >
          <Link to={to}>{label}</Link>
        </Button>
      ))}
    </nav>
  );

  if (mode === "contracts") {
    return (
      <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
        <PageHeader
          eyebrow="Contracting"
          eyebrowIcon={<Link2 className="h-3 w-3" />}
          title="Contracts"
          subtitle="Carrier appointments, commission levels, writing numbers, and transfers — all in one place."
        />
        {workspaceNav}
        <ContractsBoard canInvite={canInvite} canSeeImo={!!isAdmin} initialScope="agency" />
      </div>
    );
  }

  const title = mode === "carriers" ? "Carrier Directory"
    : mode === "ops" ? "Contracting Operations"
    : mode === "requests" ? "Contracting Requests"
    : "Contract Documents";
  const subtitle = mode === "carriers"
    ? "Active carrier access, portals, and contracting availability."
    : mode === "ops"
    ? "Licensing, carrier contracting, writing numbers, compensation and hierarchy — prepared here, submitted through whichever system each carrier requires."
    : mode === "requests"
    ? "Start and monitor producer contracting requests."
    : "Writing numbers, contract numbers, and appointment records for the producers you cover.";

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Contracting"
        eyebrowIcon={
          mode === "carriers" ? <Building2 className="h-4 w-4" />
          : mode === "ops" ? <Settings2 className="h-4 w-4" />
          : mode === "documents" ? <Files className="h-4 w-4" />
          : <ClipboardList className="h-4 w-4" />
        }
        title={title}
        subtitle={subtitle}
      />
      {workspaceNav}

      {mode === "carriers" && <CarrierDirectory carriersQ={carriersQ} masterInvite={masterInvite} />}
      {mode === "ops" && <ContractingOps canInvite={canInvite} />}
      {mode === "requests" && (
        <>
          <StartContractingCard masterInvite={masterInvite} copyLink={copyLink} copiedId={copiedId} canInvite={canInvite} />
          <ContractingIntakeAdmin showEmptyState />
          <RequestsInFlight />
          <div className="space-y-5">
            {sections.map((section) => (
              <LinkSectionView key={section.key} section={section} copyLink={copyLink} copiedId={copiedId} />
            ))}
          </div>
        </>
      )}
      {mode === "documents" && <ContractDocuments />}
    </div>
  );
}

/* ───────────────────────── Carrier Directory ───────────────────────── */

function CarrierDirectory({
  carriersQ,
  masterInvite,
}: {
  carriersQ: { data?: AgentlinkCarrier[]; isLoading: boolean; error: unknown };
  masterInvite: LinkItem | null;
}) {
  const [search, setSearch] = useState("");
  const all = carriersQ.data ?? [];
  const rows = all.filter((c) => !search || (c.name ?? "").toLowerCase().includes(search.toLowerCase()));
  const configured = all.filter((c) => c.contract_invite_url).length;

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search carriers" className="pl-9" data-testid="carrier-search" />
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{rows.length}</span> of{" "}
          <span className="font-semibold tabular-nums text-foreground">{all.length}</span> active carriers
        </p>
      </div>

      {/* Honest about the real state: no carrier row currently carries a direct
          contracting URL, so contracting runs through the AgentLink invite.
          Saying that once beats repeating "Not configured" as if it were news. */}
      {!carriersQ.isLoading && configured === 0 && (
        <div className="flex items-start gap-3 border-b border-border bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            No carrier has a direct contracting URL on file yet, so contracting starts from the
            AgentLink invite below and each carrier's own portal.
            {masterInvite && (
              <>
                {" "}
                <a href={masterInvite.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-2">
                  Open the AgentLink invite
                </a>
              </>
            )}
          </p>
        </div>
      )}

      <div className="hidden grid-cols-[minmax(0,1fr)_140px_120px] border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
        <span>Carrier</span><span>Contracting</span><span>Access</span>
      </div>

      {carriersQ.isLoading ? (
        <div className="space-y-2 p-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-7 w-7" />}
          title={all.length === 0 ? "No active carriers" : "No carrier matches that search"}
          description={all.length === 0 ? "No carrier records are currently visible for this workspace." : "Clear the search to see every active carrier."}
        />
      ) : (
        <ul>
          {rows.map((carrier) => {
            const href = carrier.contract_invite_url || carrier.website;
            return (
              <li key={carrier.id} className="grid grid-cols-2 items-center gap-2 border-b border-border/70 px-4 py-3 text-sm last:border-0 sm:grid-cols-[minmax(0,1fr)_140px_120px]">
                <span className="truncate font-medium">{carrier.name ?? `Carrier ${carrier.id}`}</span>
                <span className={carrier.contract_invite_url ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
                  {carrier.contract_invite_url ? "Direct link" : "Via AgentLink"}
                </span>
                <span className="justify-self-end sm:justify-self-auto">
                  {href ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {carrier.contract_invite_url ? "Contract" : "Website"} <ExternalLink className="ml-1 h-3.5 w-3.5" />
                      </a>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">No URL on file</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </GlassCard>
  );
}

/* ───────────────────────── Operations ───────────────────────── */

function ContractingOps({ canInvite }: { canInvite: boolean }) {
  const summaryQ = useContractSummary("agency", "");
  const s = summaryQ.data ?? { total: 0, active: 0, requested: 0, issues: 0, by_status: {} };

  const stats: Array<[string, number, string]> = [
    ["Contracts on file", s.total, "Across the agency book"],
    ["Active appointments", s.active, "Writing today"],
    ["Requests in progress", (s.by_status.requested ?? 0) + (s.by_status.submitted ?? 0) + (s.by_status.pending_upline_assignment ?? 0), "Requested, submitted or awaiting upline"],
    ["Needs attention", s.issues, s.issues > 0 ? "Issue, jail or rejected" : "Nothing outstanding"],
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([label, value, note]) => (
          <GlassCard key={label} className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
            {summaryQ.isLoading ? <Skeleton className="mt-1 h-8 w-14" /> : <p className="mt-0.5 text-3xl font-bold tabular-nums">{value}</p>}
            <p className="mt-1 text-xs text-muted-foreground">{note}</p>
          </GlassCard>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <GlassCard className="p-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Requests by status</h3>
          {summaryQ.isLoading ? (
            <div className="mt-3 space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
          ) : Object.keys(s.by_status).length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="h-7 w-7" />}
              title="No contracting requests yet"
              description="A request appears here when a producer needs a new carrier contract, transfer, state appointment or hierarchy change."
            />
          ) : (
            <ul className="mt-3 space-y-1.5">
              {Object.entries(s.by_status)
                .sort((a, b) => b[1] - a[1])
                .map(([key, n]) => (
                  <li key={key} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm">
                    <span className="capitalize">{key.replace(/_/g, " ")}</span>
                    <span className="font-bold tabular-nums">{n}</span>
                  </li>
                ))}
            </ul>
          )}
        </GlassCard>

        <GlassCard className="p-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Quick actions</h3>
          {/* Every entry navigates somewhere real AND somewhere this viewer is
              allowed to land. /dashboard/contracting/requests and /documents are
              requireAdmin routes (App.tsx), but they used to render for every
              authenticated agent — a plain agent who clicked either one was
              bounced by the route guard. An action that is visible but refused
              is the same failure as an action wired to nothing, so each entry is
              now gated on the guard its own destination enforces. */}
          <div className="mt-3 grid grid-cols-1 gap-2">
            {canInvite && (
              <Button asChild variant="outline" className="justify-start">
                <Link to="/admin/invite-links"><UserPlus className="h-4 w-4" /> Invite an agent</Link>
              </Button>
            )}
            {isAdmin && (
              <Button asChild variant="outline" className="justify-start">
                <Link to="/dashboard/contracting/requests"><ClipboardList className="h-4 w-4" /> Start a contracting request</Link>
              </Button>
            )}
            <Button asChild variant="outline" className="justify-start">
              <Link to="/dashboard/contracting/carriers"><Building2 className="h-4 w-4" /> Carrier directory</Link>
            </Button>
            {isAdmin && (
              <Button asChild variant="outline" className="justify-start">
                <Link to="/dashboard/contracting/documents"><Files className="h-4 w-4" /> Writing numbers</Link>
              </Button>
            )}
          </div>
        </GlassCard>
      </div>

      <ContractingIntakeAdmin showEmptyState />
    </div>
  );
}

/* ───────────────────────── Requests in flight ───────────────────────── */

function RequestsInFlight() {
  const rowsQ = useContractRows("agency", "requested", "", 0);
  const rows = rowsQ.data ?? [];
  return (
    <GlassCard className="overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Carrier requests in flight</h3>
      </div>
      {rowsQ.isLoading ? (
        <div className="p-4"><Skeleton className="h-12 w-full" /></div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-7 w-7" />} title="No requested contracts" description="Carrier contracts sitting in a requested state appear here." />
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.id} className="grid grid-cols-2 gap-2 border-b border-border/70 px-4 py-3 text-sm last:border-0 sm:grid-cols-3">
              <span className="truncate font-medium">{r.carrier_name ?? "Carrier not on file"}</span>
              <span className="truncate text-muted-foreground">{r.agent_name ?? "Producer not on file"}</span>
              <span className="truncate text-xs text-muted-foreground">
                {r.requested_at ? `Requested ${new Date(r.requested_at).toLocaleDateString()}` : "Request date not on file"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}

/* ───────────────────────── Documents ───────────────────────── */

function ContractDocuments() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const summaryQ = useContractSummary("agency", search);
  const rowsQ = useContractRows("agency", status, search, 0);
  const rows = rowsQ.data ?? [];
  const s = summaryQ.data ?? { total: 0, active: 0, requested: 0, issues: 0, by_status: {} };
  const shown = status === "all" ? s.total : (s.by_status[status] ?? 0);

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search carrier, producer, or writing number" className="pl-9" data-testid="documents-search" />
        </div>
        {(["all", "active", "submitted", "requested"] as const).map((k) => (
          <Button key={k} size="sm" variant={status === k ? "default" : "outline"} onClick={() => setStatus(k)} className="capitalize" data-testid={`doc-status-${k}`}>
            {k === "all" ? "All statuses" : k}
          </Button>
        ))}
        <p className="w-full text-xs text-muted-foreground sm:w-auto">
          <span className="font-semibold tabular-nums text-foreground">{shown}</span> records
        </p>
      </div>

      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_minmax(0,1fr)] border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
        <span>Carrier</span><span>Producer</span><span>Status</span><span>Contract record</span>
      </div>

      {rowsQ.isLoading ? (
        <div className="p-4"><Skeleton className="h-12 w-full" /></div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Files className="h-7 w-7" />}
          title="No contract records match"
          description="Writing numbers and contract numbers appear here once a carrier issues them. Expiry alerts, including E&O certificates, appear when a verified document source is connected. Clear the search or widen the status filter."
        />
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.id} className="grid grid-cols-2 gap-2 border-b border-border/70 px-4 py-3 text-sm last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_minmax(0,1fr)]">
              <span className="truncate font-medium">{r.carrier_name ?? "Carrier not on file"}</span>
              <span className="truncate text-muted-foreground">{r.agent_name ?? "Producer not on file"}</span>
              <span className="truncate capitalize text-muted-foreground">{(r.status ?? "unknown").replace(/_/g, " ")}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {r.writing_number ? `Writing # ${r.writing_number}` : r.contract_number ? `Contract # ${r.contract_number}` : "No number issued yet"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}

/* ───────────────────────── Shared pieces ───────────────────────── */

function StartContractingCard({
  masterInvite, copyLink, copiedId, canInvite,
}: {
  masterInvite: LinkItem | null;
  copyLink: (id: string, url: string) => Promise<void>;
  copiedId: string | null;
  canInvite: boolean;
}) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://apex-financial.org";
  const intakeUrl = `${origin}/start-contracting`;

  return (
    <GlassCard className="border-primary/30 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <FileSignature className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Start contracting</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Send a producer one link. Five fields — name, email, phone, NPN — and APEX takes it from there.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <a href="/start-contracting">Open the intake</a>
            </Button>
            <Button size="sm" variant="outline" onClick={() => copyLink("start-contracting-link", intakeUrl)}>
              {copiedId === "start-contracting-link"
                ? <><Check className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copied</>
                : <><Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copy shareable link</>}
            </Button>
            {canInvite && (
              <Button asChild size="sm" variant="outline">
                <Link to="/admin/invite-links"><UserPlus className="h-3.5 w-3.5" /> Invite an agent</Link>
              </Button>
            )}
            {masterInvite && (
              <Button asChild size="sm" variant="ghost">
                <a href={masterInvite.url} target="_blank" rel="noopener noreferrer">
                  AgentLink invite <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden />
                </a>
              </Button>
            )}
          </div>

          {!masterInvite && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              No AgentLink master invite is configured, so only the APEX intake is available.
              Set system_settings.agentlink_master_invite.
            </p>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

function LinkSectionView({
  section, copyLink, copiedId,
}: {
  section: LinkSection;
  copyLink: (id: string, url: string) => Promise<void>;
  copiedId: string | null;
}) {
  const Icon = section.icon;
  return (
    <GlassCard className="p-4">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{section.title}</span>
        </h3>
        <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">{section.items.length}</span>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{section.description}</p>
      {section.items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 px-3 py-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            No links configured here yet. Set the matching system_settings key, or fill
            agentlink_carriers.contract_invite_url, and the rows appear.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {section.items.map((item) => (
            <LinkCardView key={item.id} item={item} copyLink={copyLink} isCopied={copiedId === item.id} />
          ))}
        </ul>
      )}
    </GlassCard>
  );
}

function LinkCardView({
  item, copyLink, isCopied,
}: {
  item: LinkItem;
  copyLink: (id: string, url: string) => Promise<void>;
  isCopied: boolean;
}) {
  return (
    <li className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 transition-colors hover:border-border hover:bg-card">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{item.label}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground" title={item.url}>{item.url}</div>
          {item.meta && <div className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground" title={item.meta}>{item.meta}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className={cn("h-10 flex-1 sm:h-9 sm:flex-none", isCopied && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400")}
            onClick={() => copyLink(item.id, item.url)}
          >
            {isCopied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy</>}
          </Button>
          <Button asChild size="sm" className="h-10 flex-1 sm:h-9 sm:flex-none">
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" /> Open
            </a>
          </Button>
        </div>
      </div>
    </li>
  );
}
