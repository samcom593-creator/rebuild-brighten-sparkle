import { Link, useLocation } from "react-router-dom";
import { BookOpenCheck, CalendarClock, LayoutList, UserCheck, Users } from "lucide-react";

import { resolveBrand } from "@/config/brand";
import { cn } from "@/lib/utils";

const trainingLabel = `${resolveBrand().platformName} Training`;

const WORKSPACE_VIEWS = [
  { label: "Call list", detail: "Contact, outcome, next step", href: "/dashboard/recruiting", icon: Users, exact: true },
  { label: "Pipeline", detail: "Everyone, one view", href: "/dashboard/recruiting/pipeline", icon: LayoutList },
  { label: "New hires", detail: "Hire to first deal", href: "/dashboard/recruits", icon: UserCheck },
  { label: "Calendar", detail: "Interviews and calls", href: "/dashboard/calendar", icon: CalendarClock },
  { label: trainingLabel, detail: "Ramp to field", href: "/dashboard/recruiting/training", icon: BookOpenCheck },
] as const;

/**
 * One URL-addressable recruiting journey; no second product or sidebar island. On a
 * phone the five tabs wrap onto two rows: a sideways-scrolling strip cut "Calendar" to
 * "C" with no sign that anything was there. From sm up they sit on one row.
 */
export function RecruitingWorkspaceNav() {
  const { pathname } = useLocation();

  return (
    <nav aria-label="Recruiting workspace" className="border-b border-border sm:overflow-x-auto">
      <div className="flex flex-wrap gap-1 sm:min-w-max sm:flex-nowrap">
        {WORKSPACE_VIEWS.map((view) => {
          // Interviews and follow-ups are no longer separate destinations: interviews are booked
          // from Calendar and the worklist, follow-ups are the worklist's due and overdue queues.
          const active = "exact" in view && view.exact
            ? pathname === view.href
            : pathname.startsWith(view.href);
          const Icon = view.icon;
          return (
            <Link
              key={view.label}
              to={view.href}
              aria-label={view.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{view.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default RecruitingWorkspaceNav;
