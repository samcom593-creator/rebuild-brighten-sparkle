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
import { TRAINING_ROUTES, toCanonicalTrainingHref } from "@/lib/trainingRoutes";
import { cn } from "@/lib/utils";

const WORKSPACE_LABEL = `${resolveBrand().platformName} Training workspace`;

const VIEWS = [
  { label: "Recruit progress", href: TRAINING_ROUTES.root, icon: BookOpenCheck, staffOnly: true, exact: true },
  { label: "Training home", href: TRAINING_ROUTES.home, icon: BookOpen },
  { label: "Field course", href: TRAINING_ROUTES.fieldCourse, icon: GraduationCap },
  { label: "Team progress", href: TRAINING_ROUTES.teamProgress, icon: Users, staffOnly: true },
  { label: "Course content", href: TRAINING_ROUTES.courseContent, icon: ListChecks, staffOnly: true },
  { label: "Annuities", href: TRAINING_ROUTES.annuities, icon: TrendingUp },
] as const;

/** A focused section switcher shared by every training surface. */
export function TrainingWorkspaceNav() {
  const { pathname } = useLocation();
  const canonicalPathname = toCanonicalTrainingHref(pathname);
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
            ? canonicalPathname === view.href
            : canonicalPathname === view.href || canonicalPathname.startsWith(`${view.href}/`);
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
