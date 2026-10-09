import { cn } from "@/lib/utils";
import type { RosterRow } from "@/lib/teamRoster";

// Where a hire is in the onboarding journey, as a 5-step ladder Sam can read at
// a glance from My Team → New hires: Applied → Pre-licensed → Onboarding →
// Training → Live. Licensed producers are simply "Live". Reads the columns the
// row already carries (onboarding_stage / license_status / training_stage) — no
// new query.
export const ONBOARDING_LADDER = ["Applied", "Pre-licensed", "Onboarding", "Training", "Live"] as const;
export function onboardingStep(row: RosterRow): number {
  if (row.license_status === "licensed") {
    const s = (row.onboarding_stage ?? "").toLowerCase();
    if (s.includes("training") || s.includes("in_field")) return 3;
    return 4; // live / evaluated / producing
  }
  const s = (row.onboarding_stage ?? row.license_progress ?? "").toLowerCase();
  if (s.includes("training")) return 3;
  if (s.includes("onboard")) return 2;
  if (s.includes("pre_licens") || s.includes("licens")) return 1;
  return 0; // applied / brand-new
}
export function OnboardingProgress({ row }: { row: RosterRow }) {
  const step = onboardingStep(row);
  const label = ONBOARDING_LADDER[step];
  const done = row.license_status === "licensed" && step === 4;
  return (
    <div className="min-w-[120px]">
      <div className="flex items-center gap-1.5">
        <span className={cn("text-[12px] font-semibold", done ? "text-success" : "text-foreground")}>{label}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{step + 1}/5</span>
      </div>
      <div className="mt-1 flex gap-0.5" aria-label={`Onboarding step ${step + 1} of 5: ${label}`}>
        {ONBOARDING_LADDER.map((name, i) => (
          <span
            key={name}
            title={name}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              i < step ? "bg-primary/50" : i === step ? (done ? "bg-success" : "bg-primary") : "bg-muted",
            )}
          />
        ))}
      </div>
    </div>
  );
}
