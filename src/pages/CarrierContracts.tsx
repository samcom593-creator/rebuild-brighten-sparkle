import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Copy, Check, Link2, Users, Briefcase, ClipboardList, FileSignature, Sparkles } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "sonner";

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
  usePageTitle("Contracts & Links · APEX");
  const { user } = useAuth();
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Contracts & Links"
        eyebrowIcon={<Link2 className="h-3 w-3" />}
        title="Contracts & Links Hub"
        subtitle="One grid for every link Sam shares · copy + open in two taps"
      />

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : errorMsg ? (
        <EmptyState
          icon={<Link2 className="h-6 w-6" />}
          title="Couldn't load links"
          description={`Query failed: ${errorMsg.slice(0, 120)}. Check Supabase RLS or system_settings / agentlink_carriers / v_my_carrier_contracts visibility.`}
        />
      ) : totalLinks === 0 ? (
        <div className="rounded-lg border border-border/60 bg-card/80 p-6 text-center space-y-3 max-w-md mx-auto">
          <Link2 className="h-10 w-10 mx-auto text-muted-foreground/40" />
          <h3 className="text-sm font-semibold">No links available yet</h3>
          <p className="text-13 text-muted-foreground">
            Fetched <span className="font-bold text-foreground tabular-nums">0</span> link rows across recruiting, agent, onboarding, application, and contracting sources.
          </p>
          <div className="text-12 text-rose-600 dark:text-rose-400 text-left">
            Likely causes:
            <ul className="list-disc list-inside mt-2">
              <li>system_settings rows hidden by RLS for your role</li>
              <li>agentlink_carriers rows all have NULL contract_invite_url</li>
              <li>You aren't signed in — agent contract rows require a session</li>
            </ul>
            <p className="mt-2 italic">Hold the Standard.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
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
    <section className="space-y-2">
      <header className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-slate-500" />
        <h2 className="text-13 font-semibold uppercase tracking-wider text-slate-500">
          {section.title} · {section.items.length}
        </h2>
      </header>
      <p className="text-12 text-muted-foreground -mt-1">{section.description}</p>
      {section.items.length === 0 ? (
        <div className="text-12 text-muted-foreground/70 italic border border-dashed border-border/50 rounded-lg p-3">
          No links configured for this section yet — set the relevant system_settings keys or populate agentlink_carriers.contract_invite_url to surface them here.
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
    </section>
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
    <li className="flex flex-col gap-2 p-3 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-base sm:flex-row sm:items-center">
      <div className="flex-1 min-w-0">
        <p className="text-14 font-semibold truncate">{item.label}</p>
        <p className="text-11 text-muted-foreground font-mono truncate" title={item.url}>{item.url}</p>
        {item.meta && (
          <p className="text-11 text-muted-foreground/80 mt-0.5">{item.meta}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant={isCopied ? "default" : "outline"}
          className={isCopied ? "bg-emerald-600 hover:bg-emerald-700" : ""}
          onClick={() => copyLink(item.id, item.url)}
        >
          {isCopied ? <><Check className="h-3.5 w-3.5 mr-1" /> Copied</> : <><Copy className="h-3.5 w-3.5 mr-1" /> Copy</>}
        </Button>
        <Button asChild size="sm">
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open
          </a>
        </Button>
      </div>
    </li>
  );
}
