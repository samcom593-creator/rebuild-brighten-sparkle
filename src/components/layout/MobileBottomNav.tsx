import { useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Briefcase, CalendarClock, Home, LayoutDashboard, Library, Settings, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import { useRolePreview } from "@/hooks/useRolePreview";

// Mobile bottom nav — 5 slots, role-aware. Per Sam (2026-05-15 10am
// readiness): removed Awards (vanity) and Team Chat (deprecated surface)
// from both role variants. Replaced with the operating verbs Sam wants
// agents and managers to reach in one tap.
// 2026-10-06: every ladder points at the canonical path the desktop sidebar
// uses (agentCloudNavigation.ts), so the active tab, breadcrumb and favorites
// agree, and each ladder offers only pages its mode's route guard admits.
const agentNavItems = [
  { path: "/dashboard",                 icon: Home,       label: "Home" },
  { path: "/numbers",                   icon: BarChart3,  label: "Numbers" },
  { path: "/dashboard/production",      icon: Briefcase,  label: "Book" },
  { path: "/dashboard/agent-pipeline",  icon: Users,      label: "Pipeline" },
  { path: "/dashboard/profile",         icon: User,       label: "Profile" },
];

const adminNavItems = [
  { path: "/dashboard",               icon: LayoutDashboard, label: "Home" },
  { path: "/dashboard/recruiting",    icon: Briefcase,  label: "Recruiting" },
  { path: "/dashboard/team",          icon: Users,      label: "Team" },
  { path: "/dashboard/production",    icon: BarChart3,  label: "Production" },
  { path: "/dashboard/admin",         icon: Settings,   label: "Admin" },
];

const managerNavItems = [
  { path: "/dashboard",                   icon: LayoutDashboard, label: "Home" },
  { path: "/dashboard/recruiting",        icon: Briefcase,  label: "Recruiting" },
  { path: "/dashboard/team",              icon: Users,      label: "Team" },
  { path: "/dashboard/production",        icon: BarChart3,  label: "Production" },
  { path: "/dashboard/training/library",  icon: Library,    label: "Training" },
];

// Agency owner mode does not imply the manager role, and the recruiting
// workspace is gated on that role, so this ladder stays on producer pages.
const agencyOwnerNavItems = [
  { path: "/dashboard",                   icon: LayoutDashboard, label: "Home" },
  { path: "/dashboard/agent-pipeline",    icon: Briefcase,  label: "Pipeline" },
  { path: "/dashboard/team",              icon: Users,      label: "Team" },
  { path: "/dashboard/production",        icon: BarChart3,  label: "Production" },
  { path: "/dashboard/training/library",  icon: Library,    label: "Training" },
];

// MP-332: Pure Recruiter, recruiting verbs only, no production.
const recruiterNavItems = [
  { path: "/dashboard",                        icon: LayoutDashboard, label: "Home" },
  { path: "/dashboard/recruiting",             icon: Briefcase,       label: "Recruiting" },
  { path: "/dashboard/calendar",               icon: CalendarClock,   label: "Calendar" },
  { path: "/dashboard/team",                   icon: Users,           label: "Team" },
  { path: "/dashboard/settings",               icon: Settings,        label: "Settings" },
];

// VA and VA manager: the same destinations their desktop sidebar offers.
const staffNavItems = [
  { path: "/dashboard",                        icon: LayoutDashboard, label: "Home" },
  { path: "/dashboard/recruiting",             icon: Briefcase,       label: "Recruiting" },
  { path: "/dashboard/calendar",               icon: CalendarClock,   label: "Calendar" },
  { path: "/dashboard/recruits",               icon: Users,           label: "Stages" },
  { path: "/dashboard/team?view=contracting",  icon: Library,         label: "Contracting" },
];

export function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { effectiveMode: realMode } = useAuth();
  const { isPreviewing, effectiveRole } = useRolePreview();
  // Follows Sam's role preview so the phone nav matches the previewed home.
  const effectiveMode = isPreviewing ? effectiveRole : realMode;

  // One ladder keyed on the resolved account mode (admin > account_mode > roles).
  const navItems =
    effectiveMode === "admin" ? adminNavItems
    : effectiveMode === "manager" ? managerNavItems
    : effectiveMode === "agency_owner" ? agencyOwnerNavItems
    : effectiveMode === "recruiter" ? recruiterNavItems
    : effectiveMode === "va" || effectiveMode === "va_manager" ? staffNavItems
    : agentNavItems;

  if (!isMobile) return null;

  return (
    <nav aria-label="Primary mobile navigation" className="safe-area-bottom fixed inset-x-0 bottom-0 z-50 border-t border-border/80 bg-background/95 shadow-[0_-10px_28px_hsl(var(--background)/0.72)] backdrop-blur-xl lg:hidden">
      <div className="flex h-16 items-center justify-around px-1">
        {navItems.map((item) => {
          const isActive = item.path === "/dashboard"
            ? location.pathname === item.path
            : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
          return (
            <button
              key={item.label}
              onClick={() => navigate(item.path)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex h-14 min-h-[48px] min-w-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-md transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <div className={cn(
                "relative p-1 rounded-lg transition-all",
                isActive && "bg-primary/10"
              )}>
                <item.icon className="h-5 w-5" />
                {isActive && (
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
                )}
              </div>
              <span className="text-[11px] font-medium leading-none">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
