import { Link, useLocation } from "react-router-dom";
import { BookOpenCheck, CalendarClock, LayoutList, UserCheck, Users } from "lucide-react";

import { resolveBrand } from "@/config/brand";
import { TONE_CLASS } from "@/lib/tones";
import { cn } from "@/lib/utils";

const trainingLabel = `${resolveBrand().platformName} Training`;

// Each page's tone (src/lib/tones.ts, 2026-10-28) is the colour its own header bubble wears, so
// the open tab's icon matches the page it opened: the Call list is the brand moment, the
// Pipeline new and scheduled, New hires going well, the Calendar a nudge, training paperwork.
const WORKSPACE_VIEWS = [
  { label: "Call list", detail: "Contact, outcome, next step", href: "/dashboard/recruiting", icon: Users, tone: "gold", exact: true },
  { label: "Pipeline", detail: "Everyone, one view", href: "/dashboard/recruiting/pipeline", icon: LayoutList, tone: "cool" },
  { label: "New hires", detail: "Hire to first deal", href: "/dashboard/recruits", icon: UserCheck, tone: "good" },
  { label: "Calendar", detail: "Interviews and calls", href: "/dashboard/calendar", icon: CalendarClock, tone: "warm" },
  { label: trainingLabel, detail: "Ramp to field", href: "/dashboard/recruiting/training", icon: BookOpenCheck, tone: "royal" },
] as const;

/**
 * One URL-addressable recruiting journey; no second product or sidebar island. On a
 * phone the five tabs wrap onto two rows: a sideways-scrolling strip cut "Calendar" to
 * "C" with no sign that anything was there. From sm up they sit on one row.
 *
 * Colour layer (2026-10-28): 15px labels, and the open tab's icon takes its page's tone
 * while the gold underline still says which tab is open. The other tabs stay quiet.
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
                "inline-flex min-h-11 items-center gap-2 border-b-2 px-3 py-2 text-[15px] font-medium leading-5 transition-colors",
                "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <Icon className={cn("h-[18px] w-[18px] shrink-0", active && TONE_CLASS[view.tone].text)} aria-hidden="true" />
              <span>{view.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default RecruitingWorkspaceNav;
