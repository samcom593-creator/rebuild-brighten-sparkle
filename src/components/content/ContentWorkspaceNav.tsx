import { Link, useLocation } from "react-router-dom";
import { BarChart3, BookOpen, ClipboardCheck, Clapperboard, Send } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { isSamEmail } from "@/lib/samOnly";
import { cn } from "@/lib/utils";

const VIEWS = [
  { label: "Plan & library", href: "/dashboard/launch-board", icon: Clapperboard, ownerOnly: true },
  { label: "Draft review", href: "/dashboard/admin/content-command", icon: ClipboardCheck },
  { label: "Publishing", href: "/dashboard/admin/social-media-bot", icon: Send, ownerOnly: true },
  { label: "Account analytics", href: "/dashboard/social", icon: BarChart3 },
  { label: "Research", href: "/admin/contentwheel", icon: BookOpen },
] as const;

/** Navigation follows existing route gates; SamOnlyRoute and database gates remain authoritative. */
export function ContentWorkspaceNav() {
  const { pathname } = useLocation();
  const { isAdmin, user } = useAuth();
  if (!isAdmin) return null;
  const owner = isSamEmail(user?.email);
  return (
    <nav aria-label="Content workspace" className="mb-4 overflow-x-auto border-b border-border">
      <div className="flex min-w-max gap-1">
        {VIEWS.filter(view => !("ownerOnly" in view) || owner).map(view => {
          const active = pathname === view.href || pathname.startsWith(`${view.href}/`);
          const Icon = view.icon;
          return <Link key={view.href} to={view.href} aria-current={active ? "page" : undefined}
            className={cn("inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]", active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground")}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden />{view.label}
          </Link>;
        })}
      </div>
    </nav>
  );
}
