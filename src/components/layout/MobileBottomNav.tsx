import { useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Briefcase, Home, LayoutDashboard, Library, Settings, User, Users } from "lucide-react";
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

export function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { isAdmin, isManager } = useAuth();

  const navItems = isAdmin ? adminNavItems : isManager ? managerNavItems : agentNavItems;

  if (!isMobile) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/95  safe-area-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const isActive = item.path === "/dashboard"
            ? location.pathname === item.path
            : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
          return (
            <button
              key={item.label}
              onClick={() => navigate(item.path)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 min-w-[48px] min-h-[48px] w-16 h-14 rounded-md transition-all",
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
