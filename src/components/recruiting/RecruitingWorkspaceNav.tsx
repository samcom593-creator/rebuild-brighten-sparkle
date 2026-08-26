import { Link, useLocation } from "react-router-dom";
import { BookOpenCheck, CalendarClock, ChevronRight, RotateCcw, UserCheck, Users } from "lucide-react";

import { resolveBrand } from "@/config/brand";
import { cn } from "@/lib/utils";

const trainingLabel = `${resolveBrand().platformName} Training`;

const WORKSPACE_VIEWS = [
  { label: "Applicants", detail: "Work new leads", href: "/dashboard/recruiting", icon: Users, exact: true },
  { label: "Interviews", detail: "Book and decide", href: "/dashboard/recruiting/interviews", icon: CalendarClock },
  { label: "Follow-ups", detail: "Clear overdue work", href: "/dashboard/recruiting/follow-ups", icon: RotateCcw },
  { label: "Hires", detail: "Launch onboarding", href: "/dashboard/recruiting/hires?status=hired", icon: UserCheck },
  { label: trainingLabel, detail: "Ramp to field", href: "/dashboard/recruiting/training", icon: BookOpenCheck },
] as const;

/** One URL-addressable recruiting journey; no second product or sidebar island. */
export function RecruitingWorkspaceNav() {
  const { pathname } = useLocation();

  return (
    <nav aria-label="Recruiting workspace" className="overflow-x-auto rounded-xl border border-border/80 bg-card/70 p-1.5 shadow-sm backdrop-blur">
      <div className="flex min-w-max gap-1.5">
        {WORKSPACE_VIEWS.map((view) => {
          const active = "exact" in view && view.exact
            ? pathname === view.href
            : pathname.startsWith(view.href.split("?")[0]);
          const Icon = view.icon;
          return (
            <Link
              key={view.label}
              to={view.href}
              aria-label={view.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group inline-flex min-h-12 min-w-[150px] items-center gap-2.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-all",
                "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                active
                  ? "border-primary/35 bg-primary/10 text-foreground shadow-[inset_0_1px_rgba(255,255,255,0.06)]"
                  : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", active ? "bg-primary text-primary-foreground" : "bg-muted")}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate leading-tight">{view.label}</span>
                <span className="mt-0.5 block truncate text-[10px] font-medium text-muted-foreground">{view.detail}</span>
              </span>
              <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-50", active && "opacity-50")} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default RecruitingWorkspaceNav;
