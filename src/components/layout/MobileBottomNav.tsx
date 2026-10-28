import type { ElementType } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Briefcase, CalendarClock, Home, LayoutDashboard, Library, Settings, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import { useRolePreview } from "@/hooks/useRolePreview";
import { ToneBubble } from "@/components/ui/delight/ToneBubble";
import {
  AGENT_CLOUD_ACCOUNT_NAV, AGENT_CLOUD_PRIMARY_NAV, APPLICANT_NAV, agentCloudItemIsActive, agentCloudSearchMatches,
  filterAgentCloudNav, flattenAgentCloudNav, isApplicantViewer, navHrefLocation, navSectionToneForLocation,
  type AgentCloudLocation,
} from "./agentCloudNavigation";

interface BottomNavItem {
  path: string;
  icon: ElementType;
  label: string;
  /** Query params that decide the active state; same contract as AgentCloudNavItem.matchParams. */
  matchParams?: readonly string[];
  /**
   * The tab stays lit on every route nested under its path. Declared only where
   * the phone departs from the shared manifest, which matches /dashboard/recruiting
   * and /dashboard/settings exactly: the desktop rail lists the settings pages as
   * items of their own and hands nested recruiting routes to the Grow group. Five
   * tabs have no other home for those pages, so the Recruiting and Settings tabs
   * own them.
   */
  ownsNested?: true;
}

// Mobile bottom nav — 5 slots, role-aware. Per Sam (2026-05-15 10am
// readiness): removed Awards (vanity) and Team Chat (deprecated surface)
// from both role variants. Replaced with the operating verbs Sam wants
// agents and managers to reach in one tap.
// 2026-10-06: every ladder points at the canonical path the desktop sidebar
// uses (agentCloudNavigation.ts), so the active tab, breadcrumb and favorites
// agree, and each ladder offers only pages its mode's route guard admits.
const agentNavItems: BottomNavItem[] = [
  { path: "/dashboard",                 icon: Home,       label: "Home" },
  { path: "/numbers",                   icon: BarChart3,  label: "Numbers" },
  { path: "/dashboard/production",      icon: Briefcase,  label: "Book" },
  { path: "/dashboard/agent-pipeline",  icon: Users,      label: "Pipeline" },
  { path: "/dashboard/profile",         icon: User,       label: "Profile" },
];

const adminNavItems: BottomNavItem[] = [
  { path: "/dashboard",               icon: LayoutDashboard, label: "Home" },
  { path: "/dashboard/recruiting",    icon: Briefcase,  label: "Recruiting", ownsNested: true },
  { path: "/dashboard/team",          icon: Users,      label: "Team" },
  { path: "/dashboard/production",    icon: BarChart3,  label: "Production" },
  { path: "/dashboard/admin",         icon: Settings,   label: "Admin" },
];

const managerNavItems: BottomNavItem[] = [
  { path: "/dashboard",                   icon: LayoutDashboard, label: "Home" },
  { path: "/dashboard/recruiting",        icon: Briefcase,  label: "Recruiting", ownsNested: true },
  { path: "/dashboard/team",              icon: Users,      label: "Team" },
  { path: "/dashboard/production",        icon: BarChart3,  label: "Production" },
  { path: "/dashboard/training/library",  icon: Library,    label: "Training" },
];

// Agency owner mode does not imply the manager role, and the recruiting
// workspace is gated on that role, so this ladder stays on producer pages.
const agencyOwnerNavItems: BottomNavItem[] = [
  { path: "/dashboard",                   icon: LayoutDashboard, label: "Home" },
  { path: "/dashboard/agent-pipeline",    icon: Briefcase,  label: "Pipeline" },
  { path: "/dashboard/team",              icon: Users,      label: "Team" },
  { path: "/dashboard/production",        icon: BarChart3,  label: "Production" },
  { path: "/dashboard/training/library",  icon: Library,    label: "Training" },
];

// MP-332: Pure Recruiter, recruiting verbs only, no production.
const recruiterNavItems: BottomNavItem[] = [
  { path: "/dashboard",                        icon: LayoutDashboard, label: "Home" },
  { path: "/dashboard/recruiting",             icon: Briefcase,       label: "Recruiting", ownsNested: true },
  { path: "/dashboard/calendar",               icon: CalendarClock,   label: "Calendar" },
  { path: "/dashboard/team",                   icon: Users,           label: "Team" },
  { path: "/dashboard/settings",               icon: Settings,        label: "Settings", ownsNested: true },
];

// VA and VA manager: the same destinations their desktop sidebar offers.
// Contracting is one view of My Team, so it declares the param that names
// that view; without it the tab lit on every team view, or (before the
// query-aware rule) on none.
const staffNavItems: BottomNavItem[] = [
  { path: "/dashboard",                        icon: LayoutDashboard, label: "Home" },
  { path: "/dashboard/recruiting",             icon: Briefcase,       label: "Recruiting", ownsNested: true },
  { path: "/dashboard/calendar",               icon: CalendarClock,   label: "Calendar" },
  { path: "/dashboard/recruits",               icon: Users,           label: "New hires" },
  { path: "/dashboard/team?view=contracting",  icon: Library,         label: "Contracting", matchParams: ["view"] },
];

// Applicant ladder: derived from the applicant rail the desktop sidebar shows,
// so a role-agent login with no agents row gets the same four next steps on
// the phone and never the producer tabs (Numbers, Book, Pipeline, Profile).
const applicantNavItems: BottomNavItem[] = flattenAgentCloudNav(APPLICANT_NAV).map((link) => ({
  path: link.href,
  icon: link.icon ?? LayoutDashboard,
  label: link.label,
}));

// Active rule: the shared manifest's (agentCloudItemIsActive: path and query
// resolved separately, Home exact), except that a tab declaring ownsNested also
// lights on every route under its path. Before F25 the whole path string, query
// included, was compared against location.pathname, which never carries a query,
// so a tab with a query could not be active.
function bottomNavItemIsActive(location: AgentCloudLocation, item: BottomNavItem): boolean {
  if (item.ownsNested) {
    const target = item.path.split("?")[0];
    const underPath = location.pathname === target || location.pathname.startsWith(`${target}/`);
    return underPath && agentCloudSearchMatches(location.search, item.path, item.matchParams);
  }
  return agentCloudItemIsActive(location, { href: item.path, matchParams: item.matchParams });
}

export function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { effectiveMode: realMode, isAdmin, isManager, isAgent, hasAgentRecord, isLoading: authLoading } = useAuth();
  const { isPreviewing, effectiveRole } = useRolePreview();
  // Follows Sam's role preview so the phone nav matches the previewed home.
  const effectiveMode = isPreviewing ? effectiveRole : realMode;
  // The same applicant rule the sidebar uses, gated the same way (auth loaded,
  // no role preview), so phone and desktop agree on who is an applicant.
  const isApplicant = isApplicantViewer({ authLoading, isAdmin, isManager, isAgent, hasAgentRecord, isPreviewing });

  // One ladder keyed on the resolved account mode (admin > account_mode > roles),
  // after the applicant check.
  const navItems =
    isApplicant ? applicantNavItems
    : effectiveMode === "admin" ? adminNavItems
    : effectiveMode === "manager" ? managerNavItems
    : effectiveMode === "agency_owner" ? agencyOwnerNavItems
    : effectiveMode === "recruiter" ? recruiterNavItems
    : effectiveMode === "va" || effectiveMode === "va_manager" ? staffNavItems
    : agentNavItems;

  // Colour layer (2026-10-28): a tab's tone is its section's, from the one map in
  // agentCloudNavigation.ts, resolved against the entries this viewer's rail shows. That is why
  // a VA's Calendar tab is Grow's purple on the phone as on desktop, not Sell's green, and why
  // the Admin tab (no section) is quiet slate.
  const seesAll = isAdmin && !isPreviewing;
  const toneEntries = isApplicant
    ? APPLICANT_NAV
    : filterAgentCloudNav([...AGENT_CLOUD_PRIMARY_NAV, ...AGENT_CLOUD_ACCOUNT_NAV], { seesAll, viewMode: effectiveMode });

  if (!isMobile) return null;

  return (
    <nav aria-label="Primary mobile navigation" className="safe-area-bottom fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background lg:hidden">
      <div className="flex h-16 items-center justify-around px-1">
        {navItems.map((item) => {
          const isActive = bottomNavItemIsActive(location, item);
          const tone = navSectionToneForLocation(navHrefLocation(item.path), toneEntries);
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => navigate(item.path)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex h-14 min-h-[48px] min-w-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-md transition-colors",
                isActive
                  ? "font-semibold text-foreground"
                  : "font-medium text-muted-foreground hover:text-foreground"
              )}
            >
              {/* The active tab's icon sits in a bubble of its section's tone; the word below it carries the
                  state. The bubble pops once when a tab becomes active, then holds still. */}
              {isActive ? (
                <ToneBubble tone={tone} size="sm" className="apex-pop [&>svg]:h-5 [&>svg]:w-5">
                  <Icon />
                </ToneBubble>
              ) : (
                <span aria-hidden="true" className="inline-flex h-8 w-8 items-center justify-center">
                  <Icon className="h-5 w-5" />
                </span>
              )}
              <span className="text-[13px] leading-4">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
