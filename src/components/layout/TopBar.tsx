import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Search, Command, Home, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/hooks/useAuth";
import { useUIStore } from "@/shared/store/uiStore";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * TopBar — slim horizontal strip above page content. Shows a breadcrumb
 * trail derived from the current path, a search hint (opens command
 * palette), notification bell, theme toggle, and the user avatar.
 * Glass surface so the aurora reads through.
 */
const LABEL_MAP: Record<string, string> = {
  dashboard: "Dashboard",
  conduct: "Conduct",
  strikes: "Agent Strikes",
  "my-strikes": "My Strikes",
  applicants: "Applicants",
  command: "Command Center",
  recruiter: "Recruiter",
  "recruit-pipeline": "Recruit Pipeline",
  "agent-pipeline": "Agent Pipeline",
  "agentlink-sync": "AgentLink Sync",
  "agentlink-vault": "AgentLink Vault",
  "call-center": "Call Center",
  "aged-leads": "Aged Leads",
  leads: "Leads",
  crm: "CRM",
  calendar: "Calendar",
  notifications: "Notifications",
  planner: "Planner",
  inbox: "Inbox",
  automation: "Automation Hub",
  "automation-health": "Automation Health",
  "system-health": "System Health",
  "book-of-business": "Book of Business",
  "hall-of-fame": "Hall of Fame",
  awards: "Awards",
  setup: "Setup",
  settings: "Settings",
  "my-deals": "My Deals",
  "my-commissions": "My Commissions",
  "my-team": "My Team",
  "my-plaques": "My Plaques",
  leaderboard: "Leaderboard",
  rewards: "Rewards",
  today: "Today",
  recruit: "Recruit Command",
  "team-chat": "Team Chat",
  "bulk-deals": "Bulk Deals",
  "hiring-pipeline": "Hiring Pipeline",
  "hiring-routing": "Hiring Routing",
  "inactive-agents": "Inactive Agents",
  "comp-tiers": "Comp Tiers",
  integrations: "Integrations",
  content: "Content Library",
  "email-log": "Email Delivery Log",
  prelicensing: "Prelicensing",
  "agent-management": "Agent Management",
  "instagram-automation": "IG Automation",
  "instagram-inbox": "IG Inbox",
  "seminar-control": "Seminar Control",
  "getting-started": "Getting Started",
  accounts: "Accounts",
  offers: "Offers",
  "xcel-pipeline": "Xcel Pipeline",
  "pipeline-simple": "Pipeline (simple)",
  hierarchy: "Team Hierarchy",
  "agent-portal": "Agent Portal",
  numbers: "Log Numbers",
  "purchase-leads": "Purchase Leads",
  "course-catalog": "Course Catalog",
  "course-progress": "Course Progress",
  referrals: "Referrals",
  mine: "Mine",
  new: "New",
  "bot-token": "Bot Token",
  "deleted-leads": "Deleted Leads",
  "admin": "Admin",
  "board-access": "Board Access",
};

// Structural URL prefixes that are NOT registered as routes in App.tsx —
// they exist only as parents of concrete child routes. Rendering them as
// clickable breadcrumb links dumps users into NotFound. Keep in lockstep
// with App.tsx: if you register any of these as a real route, remove it here.
const NON_ROUTE_PARENTS = new Set<string>([
  "/admin",
  "/agent",
  "/dashboard/admin",
  "/dashboard/agent",
  "/dashboard/next-step",
  "/dashboard/old-applicants",
  "/admin/next-step",
]);

function labelize(segment: string) {
  if (LABEL_MAP[segment]) return LABEL_MAP[segment];
  // UUIDs / IDs — show short form
  if (/^[0-9a-f]{8}-/i.test(segment)) return segment.slice(0, 8) + "…";
  if (/^\d+$/.test(segment)) return `#${segment}`;
  return segment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TopBar() {
  const location = useLocation();
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);

  const crumbs = useMemo(() => {
    const segments = location.pathname.split("/").filter(Boolean);
    let path = "";
    return segments.map((seg) => {
      path += "/" + seg;
      return { path, label: labelize(seg) };
    });
  }, [location.pathname]);

  const initials = (() => {
    const name = (user?.user_metadata?.full_name || user?.email || "U") as string;
    return name
      .split(/[\s@]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("");
  })();

  return (
    // MP-254 (2026-07-08): AppShell TopBar — sticky top-0 z-40, h-14,
    // backdrop-blur, bg #070A0F/80, border-b white/[0.06]. Slim, distinct
    // from page content, no drop-shadow noise.
    <div
      className={cn(
        "sticky top-0 z-40 hidden lg:flex items-center justify-between gap-4",
        "h-14 px-4 sm:px-6 lg:px-8",
        "backdrop-blur-md border-b",
      )}
      style={{
        background: "rgba(7,10,15,0.8)",
        borderColor: "rgba(255,255,255,0.06)",
      }}
    >
      {/* AC-P3: the benchmark's topbar greets on Home and breadcrumbs on inner
          pages. /dashboard gets "Good evening, Sam · Tuesday, August 19". */}
      {location.pathname === "/dashboard" ? (
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-sm font-semibold truncate">
            {(() => {
              const h = new Date().getHours();
              const part = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
              const raw = (user?.user_metadata?.full_name || user?.user_metadata?.name || "") as string;
              const first = raw.trim().split(/\s+/)[0] || "there";
              return `Good ${part}, ${first}`;
            })()}
          </span>
          <span className="text-sm text-muted-foreground truncate">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </span>
        </div>
      ) : (
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0">
        <Link
          to="/dashboard"
          className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
        >
          <Home className="h-3.5 w-3.5" />
        </Link>
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          const isDeadParent = NON_ROUTE_PARENTS.has(c.path);
          return (
            <span key={c.path} className="flex items-center gap-1 min-w-0">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
              {isLast ? (
                <span className="text-sm font-semibold truncate">{c.label}</span>
              ) : isDeadParent ? (
                <span className="text-sm text-muted-foreground/70 truncate">{c.label}</span>
              ) : (
                <Link
                  to={c.path}
                  className="text-sm text-muted-foreground hover:text-primary transition-colors truncate"
                >
                  {c.label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>
      )}

      {/* Right cluster */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="
            hidden md:inline-flex items-center gap-2 px-3 h-8 rounded-md
            text-xs text-muted-foreground
            bg-card/60 border border-border/40
            hover:border-primary/40 hover:text-foreground transition-colors
            
          "
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search anything…</span>
          <span className="ml-3 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70 border border-border/40 rounded px-1.5 py-0.5">
            <Command className="h-2.5 w-2.5" /> K
          </span>
        </button>

        <NotificationBell className="h-8 w-8" />

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <Avatar className="h-8 w-8 ring-1 ring-primary/40">
          <AvatarFallback className="text-[11px] font-bold bg-white dark:bg-slate-900">
            {initials}
          </AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}
