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
  GraduationCap,
  HelpCircle,
  IdCard,
  Import,
  Landmark,
  LayoutGrid,
  Megaphone,
  ScrollText,
  Settings,
  Shield,
  Sparkles,
  Target,
  Trophy,
  UserPlus,
  Users,
  WalletCards,
  Link2,
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

/**
 * The sidebar, rebuilt 2026-08-31 around what an agent actually does.
 *
 * WHAT WAS WRONG WITH THE OLD SHAPE
 *   * "Recruiting" was a junk drawer: recruit pipeline, interviews, follow-ups,
 *     APEX Training, Call Center, recruiting links and Awards. Call Center and
 *     Awards are not recruiting, and training being filed under "recruiting
 *     other agents" is why an agent looking for a script never opened it.
 *   * "Tools" was the second junk drawer: Import, Document review, Resources,
 *     Quoter, Marketing — two owner tools and three agent tools in one bucket.
 *   * TWO different groups both had an item called "Pipeline", one meaning
 *     clients and one meaning recruits.
 *   * Training appeared TWICE after the previous wave added a proper group.
 *   * Owner-only items were scattered across five groups (Finances, Reports,
 *     Contracting Ops, Contract Requests, Import, Document review), so a
 *     manager's sidebar and Sam's differed by items sprinkled everywhere
 *     instead of by one clearly separated section.
 *
 * THE NEW SHAPE is ordered by how often an agent touches it — sell today, run
 * my book, learn, grow the team, then the agency — with everything owner-only
 * collected into one section that simply is not there for anyone else.
 *
 * Ordering rule: if an agent does it daily it is near the top. Training sits
 * third, above recruiting and the agency, because Sam's instruction was that it
 * "should not be hidden away in resources" and it is the thing a new agent needs
 * most in their first month.
 */
export const AGENT_CLOUD_PRIMARY_NAV: AgentCloudNavEntry[] = [
  { label: "Home", href: "/dashboard", icon: LayoutGrid },

  {
    // What an agent does today, in the order they do it.
    label: "Sell",
    icon: Target,
    kicker: "TODAY",
    // The GROUP admits VAs so the Call Center reaches them — VAs work the
    // recruit call queue all day and would otherwise have no nav path to it.
    // Every other item in here is scoped to producers, so a VA sees the one
    // entry that is theirs rather than a quoter they have no use for.
    modes: [...PRODUCERS, "va", "va_manager"],
    items: [
      { label: "My Pipeline", href: "/dashboard/agent-pipeline", icon: FolderKanban, modes: PRODUCERS },
      { label: "Call Center", href: "/dashboard/call-center", icon: ContactRound },
      { label: "Calendar", href: "/dashboard/calendar", icon: CalendarDays, modes: PRODUCERS },
      { label: "Quoter", href: "/dashboard/quoter", icon: Cloud, modes: PRODUCERS },
      { label: "Needs Analysis", href: "/dashboard/needs-analysis", icon: FileSearch, modes: PRODUCERS },
    ],
  },

  {
    // Their own book and their own money.
    label: "My Business",
    icon: BookOpen,
    modes: PRODUCERS,
    items: [
      { label: "Book of Business", href: "/dashboard/production", icon: BookOpen },
      { label: "Retention", href: "/dashboard/retention", icon: Shield },
      { label: "My Commissions", href: "/dashboard/my-commissions", icon: WalletCards },
      { label: "My Contracts", href: "/dashboard/contracting", icon: FileText },
      { label: "Carrier Directory", href: "/dashboard/contracting/carriers", icon: Landmark },
      { label: "My Documents", href: "/dashboard/profile", icon: FileSearch },
    ],
  },

  {
    // Third from the top on purpose. Training used to be reachable only inside
    // the recruiting group; the module course had 92 agents in it and the
    // Training Hub 6, because nothing pointed at either.
    label: "Learn",
    icon: GraduationCap,
    kicker: "TRAINING",
    modes: PRODUCERS,
    items: [
      { label: "Getting Started", href: "/dashboard/getting-started", icon: Sparkles },
      { label: "Sales Course", href: "/dashboard/recruiting/training/sales-course", icon: GraduationCap },
      { label: "Training Library", href: "/dashboard/recruiting/training/library", icon: BookOpenCheck },
      { label: "Scripts", href: "/dashboard/scripts", icon: ScrollText },
      { label: "Annuity Training", href: "/dashboard/annuity-training", icon: Landmark },
      { label: "Handbook", href: "/dashboard/handbook", icon: BookOpen },
      { label: "Resources", href: "/dashboard/resources", icon: FileText },
    ],
  },

  {
    // Building a team. Only recruiting lives here now.
    label: "Grow",
    icon: UserPlus,
    kicker: "RECRUITING",
    modes: RECRUITING,
    items: [
      { label: "Recruit Pipeline", href: "/dashboard/recruiting", icon: FolderKanban },
      { label: "Interviews", href: "/dashboard/recruiting/interviews", icon: CalendarDays },
      { label: "Follow-ups", href: "/dashboard/recruiting/follow-ups", icon: Target, modes: ["recruiter", "va", "va_manager", "manager", "agency_owner"] },
      { label: "Invite an agent", href: "/admin/invite-links", icon: UserPlus },
      { label: "Recruiting Links", href: "/dashboard/recruiting-links", icon: Link2, adminOnly: true },
    ],
  },

  {
    // The team around them, and the recognition that comes with it.
    label: "Team",
    icon: Users,
    modes: [...PRODUCERS, "recruiter"],
    items: [
      { label: "My Team", href: "/dashboard/team", icon: Users },
      { label: "Leaderboard", href: "/dashboard/leaderboard", icon: Trophy, modes: PRODUCERS },
      { label: "Hall of Fame", href: "/dashboard/hall-of-fame", icon: Trophy, modes: PRODUCERS },
      { label: "Challenges", href: "/dashboard/challenges", icon: Target, modes: PRODUCERS },
      { label: "Awards", href: "/dashboard/awards", icon: Trophy, modes: PRODUCERS },
      { label: "Announcements", href: "/dashboard/community", icon: Megaphone },
    ],
  },

  { label: "Marketing", href: "/dashboard/client-marketing", icon: Megaphone, modes: PRODUCERS },
  { label: "Nova", href: "/dashboard/nova", icon: Sparkles, modes: PRODUCERS },
  { label: "VA Team", href: "/va-team", icon: Users, modes: ["va_manager"] },

  {
    // Everything owner-only, in ONE place rather than scattered through five
    // groups. A manager's sidebar now differs from Sam's by this section being
    // absent, not by items sprinkled everywhere — which matches the access
    // split shipped the same day (is_owner vs is_agency_staff).
    label: "Owner",
    icon: Building2,
    kicker: "ADMIN",
    items: [
      { label: "Reports", href: "/dashboard/analytics", icon: BarChart3, adminOnly: true },
      { label: "Finances", href: "/dashboard/finances", icon: WalletCards, adminOnly: true },
      { label: "Contracting Ops", href: "/dashboard/contracting/ops", icon: Target, adminOnly: true },
      { label: "Contract Requests", href: "/dashboard/contracting/requests", icon: FileSearch, adminOnly: true },
      { label: "Document review", href: "/dashboard/contracting/documents", icon: FileSearch, adminOnly: true },
      { label: "Import", href: "/dashboard/import", icon: Import, adminOnly: true },
    ],
  },
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
