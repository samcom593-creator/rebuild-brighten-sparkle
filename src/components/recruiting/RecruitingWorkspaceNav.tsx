import { Link, useLocation } from "react-router-dom";
import { BookOpenCheck, CalendarClock, RotateCcw, UserCheck, Users } from "lucide-react";

import { resolveBrand } from "@/config/brand";
import { cn } from "@/lib/utils";

const trainingLabel = `${resolveBrand().platformName} Training`;

const WORKSPACE_VIEWS = [
  { label: "Applicants", href: "/dashboard/recruiting", icon: Users, exact: true },
  { label: "Interviews", href: "/dashboard/recruiting/interviews", icon: CalendarClock },
  { label: "Follow-ups", href: "/dashboard/recruiting/follow-ups", icon: RotateCcw },
  { label: "Hires", href: "/dashboard/recruiting/hires?status=hired", icon: UserCheck },
  { label: trainingLabel, href: "/dashboard/recruiting/training", icon: BookOpenCheck },
] as const;

/** One URL-addressable recruiting journey; no second product or sidebar island. */
export function RecruitingWorkspaceNav() {
  const { pathname } = useLocation();

  return (
    <nav aria-label="Recruiting workspace" className="-mx-4 overflow-x-auto border-b border-border px-4 sm:-mx-6 sm:px-6">
      <div className="flex min-w-max gap-1">
        {WORKSPACE_VIEWS.map((view) => {
          const active = "exact" in view && view.exact
            ? pathname === view.href
            : pathname.startsWith(view.href.split("?")[0]);
          const Icon = view.icon;
          return (
            <Link
              key={view.label}
              to={view.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {view.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default RecruitingWorkspaceNav;
