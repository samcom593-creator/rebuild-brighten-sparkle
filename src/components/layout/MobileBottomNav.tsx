import { useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Briefcase, CalendarClock, Home, LayoutDashboard, Library, Settings, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";

// Mobile bottom nav — 5 slots, role-aware. Per Sam (2026-05-15 10am
// readiness): removed Awards (vanity) and Team Chat (deprecated surface)
// from both role variants. Replaced with the operating verbs Sam wants
// agents and managers to reach in one tap.
const agentNavItems = [
  { path: "/agent-portal",            icon: Home,       label: "Home" },
  { path: "/numbers",                 icon: BarChart3,  label: "Numbers" },
  { path: "/dashboard/my-deals",      icon: Briefcase,  label: "Deals" },
  { path: "/agent-pipeline",          icon: Users,      label: "Pipeline" },
  { path: "/dashboard/settings",      icon: User,       label: "Profile" },
];

const adminNavItems = [
  { path: "/dashboard",               icon: LayoutDashboard, label: "Home" },
  { path: "/dashboard/recruiting",    icon: Briefcase,  label: "Recruiting" },
  { path: "/dashboard/team",          icon: Users,      label: "Team" },
  { path: "/dashboard/production",    icon: BarChart3,  label: "Production" },
  { path: "/dashboard/admin",         icon: Settings,   label: "Admin" },
];

const managerNavItems = [
  { path: "/dashboard",               icon: LayoutDashboard, label: "Home" },
  { path: "/dashboard/recruiting",    icon: Briefcase,  label: "Recruiting" },
  { path: "/dashboard/team",          icon: Users,      label: "Team" },
  { path: "/dashboard/production",    icon: BarChart3,  label: "Production" },
  { path: "/dashboard/resources",     icon: Library,    label: "Resources" },
];

const staffNavItems = [
  { path: "/dashboard",                        icon: LayoutDashboard, label: "Home" },
  { path: "/dashboard/recruiting",             icon: Briefcase,       label: "Recruiting" },
  { path: "/dashboard/recruiting/interviews",  icon: CalendarClock,   label: "Interviews" },
  { path: "/dashboard/team",                   icon: Users,           label: "Team" },
  { path: "/dashboard/resources",              icon: Library,         label: "Resources" },
];

export function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { isAdmin, isManager, isVaManager, isVa } = useAuth();

  const navItems = isAdmin
    ? adminNavItems
    : isManager
      ? managerNavItems
      : (isVaManager || isVa)
        ? staffNavItems
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
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
