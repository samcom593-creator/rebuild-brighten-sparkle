export const TRAINING_ROUTES = {
  root: "/dashboard/training",
  home: "/dashboard/training/library",
  fieldCourse: "/dashboard/training/sales-course",
  teamProgress: "/dashboard/training/progress",
  courseContent: "/dashboard/training/content",
  annuities: "/dashboard/training/annuities",
} as const;

export function toCanonicalTrainingHref(href: string): string {
  return href.replace(
    /^\/dashboard\/recruiting\/training(?=\/|$)/,
    TRAINING_ROUTES.root,
  );
}
