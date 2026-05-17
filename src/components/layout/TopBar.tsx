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
  "charges-audit": "Charges Audit",
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
    <div
      className={cn(
        "sticky top-0 z-20 hidden lg:flex items-center justify-between gap-4",
        "px-4 sm:px-6 lg:px-8 py-2.5",
        "bg-background/85 backdrop-blur-xl border-b border-border/60 shadow-sm",
      )}
    >
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0">
        <Link
          to="/dashboard"
          className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
        >
          <Home className="h-3.5 w-3.5" />
        </Link>
        {crumbs.map((c, i) => (
          <span key={c.path} className="flex items-center gap-1 min-w-0">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            {i === crumbs.length - 1 ? (
              <span className="text-sm font-semibold truncate">{c.label}</span>
            ) : (
              <Link
                to={c.path}
                className="text-sm text-muted-foreground hover:text-primary transition-colors truncate"
              >
                {c.label}
              </Link>
            )}
          </span>
        ))}
      </nav>

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
            backdrop-blur-sm
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
          <AvatarFallback className="text-[11px] font-bold bg-gradient-to-br from-primary/30 to-primary/10">
            {initials}
          </AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}
