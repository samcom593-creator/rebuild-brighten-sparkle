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
  FolderKanban,
  GraduationCap,
  HelpCircle,
  IdCard,
  Import,
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
/**
 * The sidebar, ordered by ROI. 2026-08-31, Sam: "prioritize ROI, make it
 * simple, no clutter."
 *
 * The rule: an item earns its place by how directly it produces money or a
 * hire. Everything an agent needs to make a dollar today is in the first two
 * groups; everything else is one level down.
 *
 * WHAT WAS CUT rather than reorganised, because "no clutter" means fewer items:
 *   Needs Analysis, Annuity Training, Handbook, Resources, Awards, Hall of
 *   Fame, Challenges and Announcements all moved OUT of the sidebar. Every one
 *   is still routed and reachable — Learn links the training library which
 *   indexes the material, and recognition surfaces hang off the leaderboard —
 *   but none of them is a thing an agent opens to earn. 24 primary links became
 *   16.
 *
 * Ordering is deliberate and not alphabetical:
 *   Sell        money today
 *   Grow        the highest-ROI action in a recruiting agency: hire someone
 *   My Business the book that pays renewals
 *   Learn       the thing that raises the ceiling on all three
 *   Team        recognition and standing
 *   Owner       admin only, absent entirely for everyone else
 *
 * Grow sits SECOND, above the agent's own book, because a hire compounds and a
 * deal does not — this is the sidebar telling an agent where the leverage is.
 */
export const AGENT_CLOUD_PRIMARY_NAV: AgentCloudNavEntry[] = [
  { label: "Home", href: "/dashboard", icon: LayoutGrid },

  {
    label: "Sell",
    icon: Target,
    kicker: "MONEY TODAY",
    // Admits VAs for the Call Center — they work the recruit queue all day and
    // would otherwise have no path to it. Every other item stays producer-only.
    modes: [...PRODUCERS, "va", "va_manager"],
    items: [
      { label: "My Pipeline", href: "/dashboard/agent-pipeline", icon: FolderKanban, modes: PRODUCERS },
      { label: "Call Center", href: "/dashboard/call-center", icon: ContactRound },
      { label: "Quoter", href: "/dashboard/quoter", icon: Cloud, modes: PRODUCERS },
      { label: "Calendar", href: "/dashboard/calendar", icon: CalendarDays, modes: PRODUCERS },
    ],
  },

  {
    // Second on purpose. In a recruiting agency a hire compounds; a deal does
    // not. This is the sidebar pointing at the leverage.
    label: "Grow",
    icon: UserPlus,
    kicker: "BUILD THE TEAM",
    modes: RECRUITING,
    items: [
      { label: "Recruit Pipeline", href: "/dashboard/recruiting", icon: FolderKanban },
      { label: "Interviews", href: "/dashboard/recruiting/interviews", icon: CalendarDays },
      { label: "Invite an agent", href: "/admin/invite-links", icon: UserPlus },
      { label: "Follow-ups", href: "/dashboard/recruiting/follow-ups", icon: Target, modes: ["recruiter", "va", "va_manager", "manager", "agency_owner"] },
    ],
  },

  {
    label: "My Business",
    icon: BookOpen,
    modes: PRODUCERS,
    items: [
      { label: "Book of Business", href: "/dashboard/production", icon: BookOpen },
      { label: "My Commissions", href: "/dashboard/my-commissions", icon: WalletCards },
      { label: "Retention", href: "/dashboard/retention", icon: Shield },
    ],
  },

  {
    label: "Learn",
    icon: GraduationCap,
    modes: PRODUCERS,
    items: [
      { label: "Field Course", href: "/dashboard/training/sales-course", icon: GraduationCap },
      { label: "Training Home", href: "/dashboard/training/library", icon: BookOpenCheck },
      { label: "Scripts", href: "/dashboard/scripts", icon: ScrollText },
    ],
  },

  {
    label: "Team",
    icon: Users,
    modes: [...PRODUCERS, "recruiter"],
    items: [
      { label: "Leaderboard", href: "/dashboard/leaderboard", icon: Trophy, modes: PRODUCERS },
      { label: "My Team", href: "/dashboard/team", icon: Users },
    ],
  },

  { label: "VA Team", href: "/va-team", icon: Users, modes: ["va_manager"] },

  {
    // Owner-only, in one place. A manager's sidebar differs from Sam's by this
    // section being absent, not by items sprinkled through five groups.
    label: "Owner",
    icon: Building2,
    kicker: "ADMIN",
    items: [
      { label: "Reports", href: "/dashboard/analytics", icon: BarChart3, adminOnly: true },
      { label: "Finances", href: "/dashboard/finances", icon: WalletCards, adminOnly: true },
      { label: "Contracting Ops", href: "/dashboard/contracting/ops", icon: Target, adminOnly: true },
      { label: "Contract Requests", href: "/dashboard/contracting/requests", icon: FileSearch, adminOnly: true },
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
