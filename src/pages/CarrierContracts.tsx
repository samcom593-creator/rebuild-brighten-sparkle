import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, ExternalLink, Copy, Check, Link2, Users, Briefcase, ClipboardList, FileSignature, Sparkles, Building2, Files, Settings2, Search } from "lucide-react";

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

/**
 * CarrierContracts · Section 3 fix · 2026-06-15
 *
 * Sam: "Section 3 · Contracts/Links hub · Simplify so the main view is a
 * CLEAN LINK GRID. Sections: Recruiting Links · Agent Links · Onboarding
 * Links · Application Links · Contracting Links. Each link card has:
 * label · URL · Copy button · Open button."
 *
 * Source order:
 *  - system_settings keys (recruiting/onboarding/application links)
 *  - agentlink_carriers.contract_invite_url (contracting per carrier)
 *  - v_my_carrier_contracts (per-agent contract rows, when signed in)
 *
 * NO new admin flows. NO write paths. Pure read-and-share grid.
 */

type LinkItem = {
  id: string;
  label: string;
  url: string;
  meta?: string | null;
};

type LinkSection = {
  key: string;
  title: string;
  icon: React.ElementType;
  description: string;
  items: LinkItem[];
};

const SECTION_TITLES = {
  recruiting: "Recruiting Links",
  agent: "Agent Links",
  onboarding: "Onboarding Links",
  application: "Application Links",
  contracting: "Contracting Links",
} as const;

const SECTION_ICONS: Record<string, React.ElementType> = {
  recruiting: Users,
  agent: Briefcase,
  onboarding: Sparkles,
  application: ClipboardList,
  contracting: FileSignature,
};

const SECTION_DESC: Record<string, string> = {
  recruiting: "Share with prospects · interview booking · public group",
  agent: "Your agent dashboard + per-carrier contract links",
  onboarding: "Send to a new hire after they sign · onboarding chat + bot DM",
  application: "Public apply form · paste into ads, DMs, and bios",
  contracting: "Per-carrier contract invite URLs (where set on AgentLink)",
};

type AgentlinkCarrier = {
  id: number;
  name: string | null;
  contract_invite_url: string | null;
  website: string | null;
};

type MyContractRow = {
  id: string;
  carrier_name: string | null;
  writing_number: string | null;
  contract_number: string | null;
  commission_level_id: string | null;
  contract_invite_url: string | null;
  carrier_portal_url: string | null;
  carrier_website: string | null;
  status: string | null;
};

// Tolerant unwrap: values in system_settings are stored as JSON; many are
// double-quoted strings, some are objects ({url,label}). Normalize to a
// string URL or an object so callers can branch cleanly.
function unwrapSetting(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}"))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return raw;
      }
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
  if (typeof value === "object" && value !== null && "url" in (value as any)) {
    const url = (value as any).url;
    const label = (value as any).label ?? fallbackLabel;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
    return { id: fallbackLabel, label, url };
  }
  return null;
}

export default function CarrierContracts() {
  const pathname = useLocation().pathname;
  const mode = pathname.endsWith("/carriers") ? "carriers" : pathname.endsWith("/ops") ? "ops" : pathname.endsWith("/requests") ? "requests" : pathname.endsWith("/documents") ? "documents" : "contracts";
  usePageTitle(`${mode === "contracts" ? "Contracts" : mode.charAt(0).toUpperCase() + mode.slice(1)} · APEX`);
  const { user, isAdmin, isManager } = useAuth();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [documentSearch, setDocumentSearch] = useState("");
  const [documentStatus, setDocumentStatus] = useState("all");

  const copyLink = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      toast.success("Link copied");
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1500);
    } catch (err) {
      toast.error("Couldn't copy. Long-press to share instead.");
    }
  };

  // system_settings: every key that maps to a recruiting / onboarding /
  // application link. Do NOT swallow errors — throw so the UI surfaces
  // a real failure instead of pretending the grid is empty.
  const settingsQ = useQuery({
    queryKey: ["link-hub-settings"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, unknown>> => {
      const keys = [
        "agentlink_master_invite",
        "telegram_bot_dm_url",
        "telegram_invite_url",
        "whatsapp_group_link",
        "seminar_calendly_url",
        "seminar_meeting_url",
        "seminar_meeting_url_label",
        "seminar_zoom_url",
      ];
      const { data, error } = await supabase
        .from("system_settings" as any)
        .select("key, value")
        .in("key", keys);
      if (error) throw error;
      const out: Record<string, unknown> = {};
      for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
        out[row.key] = unwrapSetting(row.value);
      }
      return out;
    },
  });

  // agentlink_carriers — the contracting list. contract_invite_url is the
  // shareable per-carrier link; many rows have NULL today (Sam knows) so
  // we just hide those rows instead of showing fake empty fields.
  const carriersQ = useQuery({
    queryKey: ["link-hub-carriers"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AgentlinkCarrier[]> => {
      const { data, error } = await supabase
        .from("agentlink_carriers" as any)
        .select("id, name, contract_invite_url, website")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown) as AgentlinkCarrier[];
    },
  });

  // Per-agent contract rows — same source as the prior implementation.
  const myContractsQ = useQuery({
    queryKey: ["link-hub-my-contracts", (user as any)?.id],
    enabled: !!(user as any)?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<MyContractRow[]> => {
      const { data, error } = await supabase
        .from("v_my_carrier_contracts" as any)
        .select(
          "id, carrier_name, writing_number, contract_number, commission_level_id, contract_invite_url, carrier_portal_url, carrier_website, status"
        )
        .eq("user_id", (user as any).id);
      if (error) throw error;
      return ((data ?? []) as unknown) as MyContractRow[];
    },
  });

  const isLoading = settingsQ.isLoading || carriersQ.isLoading || (!!(user as any)?.id && myContractsQ.isLoading);
  const errorMsg =
    (settingsQ.error as any)?.message ||
    (carriersQ.error as any)?.message ||
    (myContractsQ.error as any)?.message ||
    null;

  const sections: LinkSection[] = useMemo(() => {
    const s = settingsQ.data ?? {};
    const carriers = carriersQ.data ?? [];
    const mine = myContractsQ.data ?? [];
    const appOrigin = typeof window !== "undefined" ? window.location.origin : "https://apex-financial.org";

    // Recruiting — what Sam hands to a prospect to move them toward apply or
    // book an interview. Order: AgentLink master invite (the agency-wide
    // invite Sam shares most), Calendly interview booking, seminar live link,
    // public Telegram + WhatsApp groups.
    const recruiting: LinkItem[] = [];
    const masterInvite = asLinkObject(s.agentlink_master_invite, "Join APEX on AgentLink");
    if (masterInvite) recruiting.push({ ...masterInvite, id: "rec-master-invite" });

    const calendly = asLinkObject(s.seminar_calendly_url, "Book an interview · Calendly");
    if (calendly) recruiting.push({ ...calendly, id: "rec-calendly" });

    const seminarLabel = (s.seminar_meeting_url_label as string) || "Live seminar · Zoom";
    const seminarUrl = asLinkObject(s.seminar_meeting_url, seminarLabel);
    if (seminarUrl) recruiting.push({ ...seminarUrl, id: "rec-seminar", label: seminarLabel });

    const tgGroup = asLinkObject(s.telegram_invite_url, "APEX Telegram group");
    if (tgGroup) recruiting.push({ ...tgGroup, id: "rec-telegram-group" });

    const wa = asLinkObject(s.whatsapp_group_link, "APEX WhatsApp group");
    if (wa) recruiting.push({ ...wa, id: "rec-whatsapp" });

    // Agent — what a current agent uses day to day. AgentLink master invite
    // doubles as the agent destination (it's where they sign in), plus
    // their own carrier writing-number rows when they're signed in.
    const agent: LinkItem[] = [];
    if (masterInvite) agent.push({ ...masterInvite, id: "agent-master-invite", label: "AgentLink dashboard" });
    const botDm = asLinkObject(s.telegram_bot_dm_url, "Talk to the APEX bot");
    if (botDm) agent.push({ ...botDm, id: "agent-bot-dm" });
    for (const row of mine) {
      const url = row.contract_invite_url || row.carrier_portal_url || row.carrier_website;
      if (!url) continue;
      const parts: string[] = [];
      if (row.writing_number) parts.push(`Writing #: ${row.writing_number}`);
      if (row.commission_level_id) parts.push(`Level: ${row.commission_level_id}`);
      if (row.status) parts.push(row.status);
      agent.push({
        id: `agent-contract-${row.id}`,
        label: row.carrier_name ?? "Carrier contract",
        url,
        meta: parts.join(" · ") || null,
      });
    }

    // Onboarding — what Sam DMs a new hire after they sign. Bot DM first
    // (private nudges), then the Telegram group.
    const onboarding: LinkItem[] = [];
    if (botDm) onboarding.push({ ...botDm, id: "onb-bot-dm", label: "APEX bot · onboarding DM" });
    if (tgGroup) onboarding.push({ ...tgGroup, id: "onb-telegram-group", label: "APEX Telegram (onboarding)" });

    // Application — the public apply form. Both production and the active
    // origin (preview / staging) so Sam can paste whichever fits.
    const application: LinkItem[] = [
      {
        id: "app-prod",
        label: "Apply form (production)",
        url: "https://apex-financial.org/apply",
      },
    ];
    if (appOrigin && !/apex-financial\.org$/i.test(new URL(appOrigin).hostname)) {
      application.push({
        id: "app-current",
        label: "Apply form (this environment)",
        url: `${appOrigin}/apply`,
      });
    }

    // Contracting — per-carrier invite links. Hide carriers with no URL set
    // (column exists, value is NULL today) so we never show a dead row.
    const contracting: LinkItem[] = [];
    for (const c of carriers) {
      const url = c.contract_invite_url || null;
      if (!url) continue;
      contracting.push({
        id: `ctr-${c.id}`,
        label: c.name ?? `Carrier #${c.id}`,
        url,
      });
    }

    const list: LinkSection[] = [
      { key: "recruiting", title: SECTION_TITLES.recruiting, icon: SECTION_ICONS.recruiting, description: SECTION_DESC.recruiting, items: recruiting },
      { key: "agent", title: SECTION_TITLES.agent, icon: SECTION_ICONS.agent, description: SECTION_DESC.agent, items: agent },
      { key: "onboarding", title: SECTION_TITLES.onboarding, icon: SECTION_ICONS.onboarding, description: SECTION_DESC.onboarding, items: onboarding },
      { key: "application", title: SECTION_TITLES.application, icon: SECTION_ICONS.application, description: SECTION_DESC.application, items: application },
      { key: "contracting", title: SECTION_TITLES.contracting, icon: SECTION_ICONS.contracting, description: SECTION_DESC.contracting, items: contracting },
    ];
    return list;
  }, [settingsQ.data, carriersQ.data, myContractsQ.data]);

  const totalLinks = sections.reduce((sum, s) => sum + s.items.length, 0);
  const filteredDocumentContracts = (myContractsQ.data ?? []).filter((contract) => {
    const matchesSearch = !documentSearch || `${contract.carrier_name} ${contract.writing_number} ${contract.contract_number}`.toLowerCase().includes(documentSearch.toLowerCase());
    const matchesStatus = documentStatus === "all" || (contract.status ?? "pending").toLowerCase() === documentStatus;
    return matchesSearch && matchesStatus;
  });

  const workspaceNav = <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Contracting sections">
    {[
      ["contracts", "/dashboard/contracting", "Contracts"],
      ["carriers", "/dashboard/contracting/carriers", "Carriers"],
      ["ops", "/dashboard/contracting/ops", "Operations"],
      ["requests", "/dashboard/contracting/requests", "Requests"],
      ["documents", "/dashboard/contracting/documents", "Documents"],
    ].map(([key, to, label]) => <Button key={key} asChild variant="ghost" className={cn("rounded-none border-b-2 px-3", mode === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}><Link to={to}>{label}</Link></Button>)}
  </nav>;

  if (mode !== "contracts") {
    const title = mode === "carriers" ? "Carrier Directory" : mode === "ops" ? "Contracting Operations" : mode === "requests" ? "Contracting Requests" : "Contract Documents";
    const subtitle = mode === "carriers" ? "Active carrier access, portals, and contracting availability." : mode === "ops" ? "Licensing, carrier contracting, writing numbers, compensation and hierarchy—prepared here, submitted through whichever system each carrier requires." : mode === "requests" ? "Start and monitor producer contracting requests." : "Review requirements, approvals, and expiry-sensitive producer documents.";
    return <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader eyebrow="Contracting" eyebrowIcon={mode === "carriers" ? <Building2 className="h-4 w-4" /> : mode === "ops" ? <Settings2 className="h-4 w-4" /> : mode === "documents" ? <Files className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />} title={title} subtitle={subtitle} />
      {workspaceNav}
      {errorMsg && <div className="rounded-md border border-rose-500/35 bg-rose-500/5 p-3 text-sm">Could not load contracting data: {errorMsg.slice(0, 120)}</div>}
      {mode === "carriers" && <GlassCard className="overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_120px_120px] border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><span>Carrier</span><span>Contracting</span><span>Access</span></div>
        {isLoading ? <div className="space-y-2 p-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : (carriersQ.data ?? []).length === 0 ? <EmptyState icon={<Building2 className="h-7 w-7" />} title="No active carriers" description="No carrier records are currently visible for this workspace." /> : <ul>{(carriersQ.data ?? []).map((carrier) => <li key={carrier.id} className="grid grid-cols-[minmax(0,1fr)_120px_120px] items-center border-b border-border/70 px-4 py-3 text-sm last:border-0"><span className="truncate font-medium">{carrier.name ?? `Carrier ${carrier.id}`}</span><span className={carrier.contract_invite_url ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>{carrier.contract_invite_url ? "Available" : "Not configured"}</span><span>{(carrier.contract_invite_url || carrier.website) ? <Button asChild size="sm" variant="outline"><a href={carrier.contract_invite_url || carrier.website || "#"} target="_blank" rel="noopener noreferrer">Open <ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button> : "—"}</span></li>)}</ul>}
      </GlassCard>}
      {mode === "ops" && <ContractingIntakeAdmin />}
      {mode === "requests" && <><StartContractingCard masterInvite={asLinkObject((settingsQ.data ?? {}).agentlink_master_invite, "AgentLink master invite")} copyLink={copyLink} copiedId={copiedId} /><ContractingIntakeAdmin /></>}
      {mode === "documents" && <GlassCard className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-4"><div className="relative min-w-56 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={documentSearch} onChange={(event) => setDocumentSearch(event.target.value)} placeholder="Search agent or document type" className="pl-9" /></div>{["all", "pending", "active"].map((status) => <Button key={status} variant={documentStatus === status ? "default" : "outline"} size="sm" onClick={() => setDocumentStatus(status)} className="capitalize">{status === "all" ? "All statuses" : status}</Button>)}</div>
        <div className="grid grid-cols-[minmax(0,1fr)_130px_minmax(0,1fr)] border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><span>Carrier</span><span>Status</span><span>Contract details</span></div>
        {myContractsQ.isLoading ? <div className="p-4"><Skeleton className="h-12 w-full" /></div> : filteredDocumentContracts.length === 0 ? <EmptyState icon={<Files className="h-7 w-7" />} title="No documents waiting on review" description="A document waiting on review does not satisfy a requirement—approve it first. Expiry alerts, including E&O certificates, appear here when a verified document source is connected." /> : <ul>{filteredDocumentContracts.map((contract) => <li key={contract.id} className="grid grid-cols-[minmax(0,1fr)_130px_minmax(0,1fr)] border-b border-border/70 px-4 py-3 text-sm last:border-0"><span className="font-medium">{contract.carrier_name ?? "Carrier"}</span><span className="capitalize text-muted-foreground">{contract.status ?? "Pending"}</span><span className="truncate font-mono text-xs text-muted-foreground">{contract.writing_number ? `Writing # ${contract.writing_number}` : contract.contract_number ? `Contract # ${contract.contract_number}` : "Awaiting carrier record"}</span></li>)}</ul>}
      </GlassCard>}
    </div>;
  }

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Contracting"
        eyebrowIcon={<Link2 className="h-3 w-3" />}
        title="Contracts"
        subtitle="Contracting access, carrier links, and producer contract records."
        actions={
          (isAdmin || isManager) ? (
            <Button asChild size="sm">
              <Link to="/admin/invite-links"><Users className="h-4 w-4" /> Invite an agent</Link>
            </Button>
          ) : undefined
        }
      />
      {workspaceNav}

      {/* Start Contracting is the ONE action on this page, so it renders first
          and it renders whether or not the link grid below has loaded. Burying
          it under five link sections is what made the old Contracting section
          look empty: it only ever listed agentlink_carriers rows whose
          contract_invite_url is NULL, so it could show nothing at all. */}
      <StartContractingCard
        masterInvite={asLinkObject(
          (settingsQ.data ?? {}).agentlink_master_invite,
          "AgentLink master invite",
        )}
        copyLink={copyLink}
        copiedId={copiedId}
      />

      {/* Staff-only. v_contracting_intake_status is security_invoker, so a
          non-staff viewer gets zero rows from the database and this renders
          nothing at all — the gate is RLS, not a client-side role check. */}
      <ContractingIntakeAdmin />

      {isLoading ? (
        /* Loading — shaped like the real sections: header, description, rows. */
        <div className="space-y-5">
          {[...Array(3)].map((_, i) => (
            // stable-key-allow:skeleton — static Array(N) decorative loader, no reorder
            <GlassCard key={i} className="p-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-full max-w-xs" />
              <div className="mt-3 space-y-2">
                <Skeleton className="h-[72px] w-full rounded-lg" />
                <Skeleton className="h-[72px] w-full rounded-lg" />
              </div>
            </GlassCard>
          ))}
        </div>
      ) : errorMsg ? (
        <div className="rounded-lg border border-rose-500/35 bg-rose-500/5 p-3 sm:p-4">
          <div className="flex min-w-0 items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">The link hub could not load</p>
              <p className="mt-0.5 break-words text-xs text-muted-foreground">
                Query failed: {errorMsg.slice(0, 120)}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Check Supabase RLS on system_settings, agentlink_carriers, and v_my_carrier_contracts.
              </p>
            </div>
          </div>
        </div>
      ) : totalLinks === 0 ? (
        <div className="space-y-3">
          <EmptyState
            icon={<Link2 className="h-7 w-7" />}
            variant="warning"
            title="No links available yet"
            description={
              <>
                Fetched <span className="font-bold tabular-nums text-foreground">0</span> link rows across recruiting, agent, onboarding, application, and contracting sources.
              </>
            }
          />
          <div className="mx-auto max-w-md rounded-lg border border-amber-500/35 bg-amber-500/5 p-3 sm:p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Likely causes
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-xs leading-relaxed text-muted-foreground">
              <li>system_settings rows hidden by RLS for your role</li>
              <li>agentlink_carriers rows all have NULL contract_invite_url</li>
              <li>You aren't signed in — agent contract rows require a session</li>
            </ul>
            <p className="mt-2 text-[11px] italic text-muted-foreground">Hold the Standard.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {sections.map((section) => (
            <LinkSectionView
              key={section.key}
              section={section}
              copyLink={copyLink}
              copiedId={copiedId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The single prominent contracting action.
 *
 * The APEX intake is the primary path: five fields, shareable with a producer
 * who has no APEX login. The AgentLink master invite is offered alongside it
 * because that is where contracting actually continues, and it is sourced only
 * from system_settings.agentlink_master_invite — never from a per-carrier row.
 */
function StartContractingCard({
  masterInvite,
  copyLink,
  copiedId,
}: {
  masterInvite: LinkItem | null;
  copyLink: (id: string, url: string) => Promise<void>;
  copiedId: string | null;
}) {
  const intakeUrl =
    (typeof window !== "undefined" ? window.location.origin : "https://apex-financial.org") +
    "/start-contracting";

  return (
    <GlassCard className="border-primary/30 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <FileSignature className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Start Contracting</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Send a producer one link. Five fields — name, email, phone, NPN — and APEX
            takes it from there.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <a href="/start-contracting">Open the intake</a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => copyLink("start-contracting-link", intakeUrl)}
            >
              {copiedId === "start-contracting-link" ? (
                <>
                  <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Copy shareable link
                </>
              )}
            </Button>
            {masterInvite && (
              <Button asChild size="sm" variant="ghost">
                <a href={masterInvite.url} target="_blank" rel="noopener noreferrer">
                  AgentLink invite
                  <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden />
                </a>
              </Button>
            )}
          </div>

          {!masterInvite && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              No AgentLink master invite is configured, so only the APEX intake is
              available. Set system_settings.agentlink_master_invite.
            </p>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

function LinkSectionView({
  section,
  copyLink,
  copiedId,
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
        <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
          {section.items.length}
        </span>
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
            <LinkCardView
              key={item.id}
              item={item}
              copyLink={copyLink}
              isCopied={copiedId === item.id}
            />
          ))}
        </ul>
      )}
    </GlassCard>
  );
}

function LinkCardView({
  item,
  copyLink,
  isCopied,
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
          <div className="truncate font-mono text-[11px] text-muted-foreground" title={item.url}>
            {item.url}
          </div>
          {item.meta && (
            <div className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground" title={item.meta}>
              {item.meta}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className={cn(
              "h-10 flex-1 sm:h-9 sm:flex-none",
              isCopied && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
            )}
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
