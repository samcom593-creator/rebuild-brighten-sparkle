import type { ElementType } from "react";
import { resolveBrand } from "@/config/brand";
import {
  BarChart3,
  BookOpen,
  BookOpenCheck,
  Building2,
  CalendarDays,
  Cloud,
  ContactRound,
  Download,
  FileSearch,
  FileText,
  FolderKanban,
  HelpCircle,
  IdCard,
  Import,
  Landmark,
  LayoutGrid,
  Megaphone,
  Settings,
  Shield,
  Sparkles,
  Target,
  Trophy,
  UserPlus,
  Users,
  WalletCards,
  Wrench,
} from "lucide-react";

import type { AccountMode } from "@/hooks/useAuth";

/**
 * MP-332 mode allowlists. `modes` names the account modes that see an entry;
 * omit it for "everyone". Admin always sees everything. Producer modes
 * (agent / manager / agency_owner) get the full selling surface; a Pure
 * Recruiter sees recruiting only; VA staff see the queues they work.
 */
const PRODUCERS: AccountMode[] = ["agent", "manager", "agency_owner"];
const LEADERS: AccountMode[] = ["manager", "agency_owner"];
const RECRUITING: AccountMode[] = ["agent", "manager", "agency_owner", "recruiter", "va", "va_manager"];

export interface AgentCloudNavItem {
  label: string;
  href: string;
  icon?: ElementType;
  adminOnly?: boolean;
  /** Account modes that see this item. Omit = everyone. Admin always sees it. */
  modes?: AccountMode[];
}

export interface AgentCloudNavGroup {
  label: string;
  icon: ElementType;
  items: AgentCloudNavItem[];
  kicker?: string;
  /** Account modes that see this group. Omit = everyone. Admin always sees it. */
  modes?: AccountMode[];
}

export type AgentCloudNavEntry = AgentCloudNavItem | AgentCloudNavGroup;

const BRAND = resolveBrand();
const trainingLabel = `${BRAND.platformName} Training`;

export const AGENT_CLOUD_PRIMARY_NAV: AgentCloudNavEntry[] = [
  { label: "Home", href: "/dashboard", icon: LayoutGrid },
  {
    label: "Clients",
    icon: ContactRound,
    modes: PRODUCERS,
    items: [
      // Agent Cloud's Clients→Pipeline is the CLIENT pipeline. This pointed at
      // /dashboard/recruiting (agent applicants), so the client pipeline was
      // unreachable from the sidebar — "there's still no client pipeline".
      { label: "Pipeline", href: "/dashboard/agent-pipeline", icon: FolderKanban },
      { label: "Calendar", href: "/dashboard/calendar", icon: CalendarDays },
      // Book of Business = the AgentLink production book (true numbers), per
      // the replication map — not the legacy book page.
      { label: "Book of Business", href: "/dashboard/production", icon: BookOpen },
      { label: "Retention", href: "/dashboard/retention", icon: Shield },
    ],
  },
  {
    label: "Recruiting",
    icon: UserPlus,
    modes: RECRUITING,
    items: [
      { label: "Pipeline", href: "/dashboard/recruiting", icon: FolderKanban },
      { label: "Interviews", href: "/dashboard/recruiting/interviews", icon: CalendarDays },
      { label: "Follow-ups", href: "/dashboard/recruiting/follow-ups", icon: Target, modes: ["recruiter", "va", "va_manager", "manager", "agency_owner"] },
      { label: trainingLabel, href: "/dashboard/recruiting/training", icon: BookOpenCheck },
      { label: "Call Center", href: "/dashboard/call-center", icon: Target, modes: PRODUCERS },
      { label: "Awards", href: "/dashboard/awards", icon: Trophy, modes: PRODUCERS },
    ],
  },
  {
    label: "Agency",
    icon: Building2,
    modes: [...PRODUCERS, "recruiter"],
    items: [
      { label: "Team", href: "/dashboard/team", icon: Users },
      { label: "Announcements", href: "/dashboard/community", icon: Megaphone },
      { label: "Leaderboard", href: "/dashboard/leaderboard", icon: Trophy, modes: PRODUCERS },
    ],
  },
  {
    label: "Contracting",
    icon: FileText,
    kicker: "RUN CONTRACTING",
    modes: [...PRODUCERS, "recruiter"],
    items: [
      { label: "My Contracts", href: "/dashboard/contracting", icon: FileText, modes: PRODUCERS },
      { label: "Invite an agent", href: "/admin/invite-links", icon: UserPlus },
      { label: "Carrier Directory", href: "/dashboard/contracting/carriers", icon: Landmark, modes: PRODUCERS },
      { label: "Contracting Ops", href: "/dashboard/contracting/ops", icon: Target, adminOnly: true },
      { label: "Contract Requests", href: "/dashboard/contracting/requests", icon: FileSearch, adminOnly: true },
    ],
  },
  { label: "Reports", href: "/dashboard/analytics", icon: BarChart3, modes: LEADERS },
  { label: "Finances", href: "/dashboard/finances", icon: WalletCards, adminOnly: true },
  {
    label: "Tools",
    icon: Wrench,
    items: [
      { label: "Import", href: "/dashboard/import", icon: Import, adminOnly: true },
      { label: "Document review", href: "/dashboard/contracting/documents", icon: FileSearch, adminOnly: true },
      { label: "Resources", href: "/dashboard/resources", icon: BookOpen },
      { label: "Quoter", href: "/dashboard/quoter", icon: Cloud, modes: PRODUCERS },
      { label: "Marketing", href: "/dashboard/client-marketing", icon: Megaphone, modes: PRODUCERS },
    ],
  },
  { label: "VA Team", href: "/va-team", icon: Users, modes: ["va_manager"] },
  { label: "Nova", href: "/dashboard/nova", icon: Sparkles, modes: PRODUCERS },
];

export const AGENT_CLOUD_ACCOUNT_NAV: AgentCloudNavEntry[] = [
  {
    label: "Settings",
    icon: Settings,
    items: [
      { label: "Agency settings", href: "/dashboard/settings/agency", icon: Building2, adminOnly: true },
      { label: "Notifications", href: "/dashboard/settings/notifications", icon: Megaphone },
      { label: "Security", href: "/dashboard/settings/security", icon: Shield },
      { label: "Billing", href: "/dashboard/settings/billing", icon: WalletCards, adminOnly: true },
      { label: "Nova Pro", href: "/dashboard/settings/nova-pro", icon: Sparkles },
      { label: "Support desk", href: "/dashboard/help?tab=desk", icon: HelpCircle },
      { label: `Install ${BRAND.shortName} app`, href: "/install", icon: Download },
    ],
  },
  { label: "Producer Profile", href: "/dashboard/profile", icon: IdCard, modes: PRODUCERS },
];

export function isAgentCloudGroup(entry: AgentCloudNavEntry): entry is AgentCloudNavGroup {
  return "items" in entry;
}

export function agentCloudPathIsActive(pathname: string, href: string): boolean {
  const target = href.split("?")[0];
  if (target === "/dashboard") return pathname === target;
  if (target === "/dashboard/recruiting") return pathname === target;
  if (target === "/dashboard/contracting") return pathname === target;
  if (target === "/dashboard/settings") return pathname === target;
  return pathname === target || pathname.startsWith(`${target}/`);
}

export function agentCloudBreadcrumb(pathname: string): string[] {
  for (const entry of [...AGENT_CLOUD_PRIMARY_NAV, ...AGENT_CLOUD_ACCOUNT_NAV]) {
    if (isAgentCloudGroup(entry)) {
      const child = entry.items.find((item) => agentCloudPathIsActive(pathname, item.href));
      if (child) return [entry.label, child.label];
    } else if (agentCloudPathIsActive(pathname, entry.href)) {
      return [entry.label];
    }
  }
  const final = pathname.split("/").filter(Boolean).at(-1) ?? "Home";
  return [final.replace(/-/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())];
}
