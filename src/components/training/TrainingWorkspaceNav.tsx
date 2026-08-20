import { Link, useLocation } from "react-router-dom";
import {
  BookOpen,
  BookOpenCheck,
  GraduationCap,
  ListChecks,
  TrendingUp,
  Users,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { resolveBrand } from "@/config/brand";
import { cn } from "@/lib/utils";

const BASE = "/dashboard/recruiting/training";
const WORKSPACE_LABEL = `${resolveBrand().platformName} Training workspace`;

const VIEWS = [
  { label: "Recruit progress", href: BASE, icon: BookOpenCheck, staffOnly: true, exact: true },
  { label: "Learning hub", href: `${BASE}/library`, icon: BookOpen },
  { label: "Sales course", href: `${BASE}/sales-course`, icon: GraduationCap },
  { label: "Team progress", href: `${BASE}/progress`, icon: Users, staffOnly: true },
  { label: "Course content", href: `${BASE}/content`, icon: ListChecks, staffOnly: true },
  { label: "Annuities", href: `${BASE}/annuities`, icon: TrendingUp },
] as const;

/** AgentCloud-style section switcher shared by every APEX Training surface. */
export function TrainingWorkspaceNav() {
  const { pathname } = useLocation();
  const { isAdmin, isManager, isVaManager, isVa } = useAuth();
  const isStaff = isAdmin || isManager || isVaManager || isVa;

  return (
    <nav
      aria-label={WORKSPACE_LABEL}
      className="overflow-x-auto border-b border-border"
    >
      <div className="flex min-w-max gap-1">
        {VIEWS.filter((view) => !("staffOnly" in view) || !view.staffOnly || isStaff).map((view) => {
          const active = "exact" in view && view.exact
            ? pathname === view.href
            : pathname === view.href || pathname.startsWith(`${view.href}/`);
          const Icon = view.icon;
          return (
            <Link
              key={view.href}
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

export default TrainingWorkspaceNav;
