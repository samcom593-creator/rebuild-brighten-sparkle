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
  ListChecks,
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
  Mic, Milestone, Send, PhoneCall } from "lucide-react";

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
  { label: "My Day", href: "/dashboard/my-day", icon: ListChecks, adminOnly: true }, // Sam's own schedule; agents must not get his routine

  {
    label: "Sell",
    icon: Target,
    kicker: "MONEY TODAY",
    // Admits VAs for the Call Center: they work the recruit queue all day and
    // would otherwise have no path to it. Every other item stays producer-only.
    modes: [...PRODUCERS, "va", "va_manager"],
    items: [
      { label: "My Pipeline", href: "/dashboard/agent-pipeline", icon: FolderKanban, modes: PRODUCERS },
      { label: "Call Center", href: "/dashboard/call-center", icon: ContactRound },
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
      // Each item names the modes whose route guard admits it (App.tsx). The
      // guards are role based: /dashboard/recruits admits managers, VAs and VA
      // managers; /dashboard/recruiting adds recruiters; /admin/invite-links
      // admits managers only. A plain agent or agency owner gets the referral
      // form, which is open to every signed-in user.
      { label: "Recruit Stages", href: "/dashboard/recruits", icon: Milestone, modes: ["manager", "va", "va_manager"] },
      { label: "Recruit Pipeline", href: "/dashboard/recruiting", icon: FolderKanban, modes: ["manager", "recruiter", "va", "va_manager"] },
      { label: "Invite an agent", href: "/admin/invite-links", icon: UserPlus, modes: ["manager"] },
      { label: "Refer a recruit", href: "/dashboard/referrals/new", icon: Send, modes: ["agent", "agency_owner"] },
      // Interviews are booked from Calendar (open to every signed-in user).
      // Producers and managers reach it under Sell; the staff who book
      // interviews but have no Sell calendar get it here.
      { label: "Calendar", href: "/dashboard/calendar", icon: CalendarDays, modes: ["recruiter", "va", "va_manager"] },
      // Interviews and Follow-ups are not standalone destinations: interviews are
      // booked from Calendar and follow-ups are the worklist's due queues.
      // Staff accounts (the former top-level "VA Team") live here too.
      { label: "Staff accounts", href: "/va-team", icon: Users, modes: ["va_manager"] },
      { label: "Ethos Contracting", href: "/dashboard/contracting/ethos", icon: FileSearch, modes: ["va", "va_manager"] },
      { label: "Contracting cases", href: "/dashboard/contracting/cases", icon: ScrollText, modes: ["va", "va_manager"] },
    ],
  },

  {
    label: "My Business",
    icon: BookOpen,
    modes: PRODUCERS,
    items: [
      { label: "Book of Business", href: "/dashboard/production", icon: BookOpen },
      // Working carrier books for rewrites (2026-10-07). Admin and managers only, like the view behind it.
      { label: "Book Flips", href: "/dashboard/books", icon: PhoneCall, modes: ["manager"] },
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
      { label: "Call Lab", href: "/dashboard/call-lab", icon: Mic },
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

  {
    // Owner-only, in one place. A manager's sidebar differs from Sam's by this
    // section being absent, not by items sprinkled through five groups.
    label: "Owner",
    icon: Building2,
    kicker: "ADMIN",
    items: [
      { label: "Launch Board", href: "/dashboard/launch-board", icon: Megaphone, adminOnly: true },
      { label: "Reports", href: "/dashboard/analytics", icon: BarChart3, adminOnly: true },
      { label: "Finances", href: "/dashboard/finances", icon: WalletCards, adminOnly: true },
      { label: "Contracting Ops", href: "/dashboard/contracting/ops", icon: Target, adminOnly: true },
      { label: "Contract Requests", href: "/dashboard/contracting/requests", icon: FileSearch, adminOnly: true },
      { label: "Ethos Contracting", href: "/dashboard/contracting/ethos", icon: FileSearch, adminOnly: true },
      { label: "Aflac onboarding", href: "/dashboard/contracting/aflac", icon: FileSearch, adminOnly: true },
      { label: "Import", href: "/dashboard/import", icon: Import, adminOnly: true },
    ],
  },
];

/**
 * Applicant nav (2026-09-07). A login with role agent and NO agents row is an
 * applicant, not a producer: applying mints the login and the confirmation
 * page signs them in. They were getting Sell / Grow / My Business and a
 * dead-end "finishing your profile" page — 399 such logins, 2 that day.
 * Four links, each a real next step; the home page carries the rest.
 */
export const APPLICANT_NAV: AgentCloudNavEntry[] = [
  { label: "Home", href: "/dashboard", icon: LayoutGrid },
  { label: "Get licensed", href: "/get-licensed", icon: GraduationCap },
  { label: "Training", href: "/dashboard/training/library", icon: BookOpenCheck },
  { label: "Support desk", href: "/dashboard/help?tab=desk", icon: HelpCircle },
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

/**
 * Breadcrumbs for routes the nav does not list, or lists under a different
 * path. Checked before the nav walk so a page reads the same name the sidebar
 * gives it (the favorites star saves this label too).
 */
const ROUTE_CRUMBS: Record<string, string[]> = {
  "/dashboard/contracting/cases": ["Contracting", "Contracting cases"],
  "/dashboard/contracting/ethos": ["Contracting", "Ethos Contracting"],
  "/dashboard/contracting/aflac": ["Contracting", "Aflac onboarding"],
  "/dashboard/recruiting/pipeline": ["Grow", "Recruit Pipeline"],
  "/dashboard/recruiting/hires": ["Grow", "Recruit Pipeline"],
  "/dashboard/book-of-business": ["My Business", "Retention"],
  "/dashboard/books": ["My Business", "Book Flips"],
  "/dashboard/my-deals": ["My Business", "Book of Business"],
  "/dashboard/nova": ["Support desk"],
  "/dashboard/help": ["Support desk"],
};

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f-]{8,}|[0-9a-f]{16,}|\d+)$/i;

export function agentCloudBreadcrumb(pathname: string): string[] {
  const override = ROUTE_CRUMBS[pathname];
  if (override) return override;
  for (const entry of [...AGENT_CLOUD_PRIMARY_NAV, ...AGENT_CLOUD_ACCOUNT_NAV]) {
    if (isAgentCloudGroup(entry)) {
      const child = entry.items.find((item) => agentCloudPathIsActive(pathname, item.href));
      if (child) return [entry.label, child.label];
    } else if (agentCloudPathIsActive(pathname, entry.href)) {
      return [entry.label];
    }
  }
  // Detail routes (/dashboard/agents/:id and friends) end in a record id.
  // Name the section instead of title-casing a UUID.
  const segments = pathname.split("/").filter(Boolean);
  let final = segments.at(-1) ?? "Home";
  if (ID_SEGMENT.test(final)) final = segments.at(-2) ?? "Home";
  return [final.replace(/-/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())];
}

export interface AgentCloudNavViewer {
  /** Admin outside role preview: sees every entry. */
  seesAll: boolean;
  /** Account mode the entries are filtered for (the previewed mode while previewing). */
  viewMode: AccountMode;
}

/**
 * The sidebar's visibility rule: an entry shows when it is not adminOnly (or
 * the viewer sees all) and it has no `modes` list or the viewer's mode is in
 * it. Groups left with no items are dropped. Mirrors GlobalSidebar.tsx.
 */
export function filterAgentCloudNav(entries: AgentCloudNavEntry[], viewer: AgentCloudNavViewer): AgentCloudNavEntry[] {
  const modeAllows = (modes?: AccountMode[]) => viewer.seesAll || !modes || modes.includes(viewer.viewMode);
  return entries
    .filter((entry) => !(!isAgentCloudGroup(entry) && entry.adminOnly && !viewer.seesAll))
    .filter((entry) => modeAllows(entry.modes))
    .map((entry) => (isAgentCloudGroup(entry)
      ? { ...entry, items: entry.items.filter((item) => (!item.adminOnly || viewer.seesAll) && modeAllows(item.modes)) }
      : entry))
    .filter((entry) => !isAgentCloudGroup(entry) || entry.items.length > 0);
}

export interface AgentCloudNavLink {
  label: string;
  href: string;
  icon?: ElementType;
  group?: string;
}

/** Flatten nav entries into links, first occurrence of each href wins. */
export function flattenAgentCloudNav(entries: AgentCloudNavEntry[]): AgentCloudNavLink[] {
  const seen = new Set<string>();
  const links: AgentCloudNavLink[] = [];
  const add = (link: AgentCloudNavLink) => {
    if (seen.has(link.href)) return;
    seen.add(link.href);
    links.push(link);
  };
  for (const entry of entries) {
    if (isAgentCloudGroup(entry)) {
      for (const item of entry.items) add({ label: item.label, href: item.href, icon: item.icon, group: entry.label });
    } else {
      add({ label: entry.label, href: entry.href, icon: entry.icon });
    }
  }
  return links;
}
