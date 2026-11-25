import type { LucideIcon } from "lucide-react";
import { ToneBubble } from "@/components/ui/delight/ToneBubble";
import { CountUp } from "@/components/ui/delight/CountUp";
import { TONE_CLASS, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";

/**
 * Present a confirmed metric; the owning query supplies loading and stale states.
 *
 * The value leads, with its unit and source detail kept visible. `prominent`
 * gives the selected production scope more space without changing its value.
 */
export function KPIStat({
  icon: Icon,
  label,
  value,
  detail,
  accent,
  prominent = false,
  unit,
  tone = "gold",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
  prominent?: boolean;
  unit?: string;
  tone?: Tone;
}) {
  const numeric = /^-?\d[\d,]*$/.test(value.trim()) ? Number(value.replace(/,/g, "")) : null;
  const valueClass = cn("dashboard-kpi__value", value.length > 10 && "dashboard-kpi__value--long", accent ? TONE_CLASS[tone].text : "text-foreground");
  return (
    <div className={cn("dashboard-kpi", prominent && "dashboard-kpi--prominent")} data-tone={tone}>
      <p className="dashboard-kpi__label">
        <ToneBubble tone={tone} size="sm"><Icon /></ToneBubble>
        {label}
      </p>
      <div className="dashboard-kpi__numberline">
        {numeric !== null && Number.isFinite(numeric) ? (
          <CountUp value={numeric} className={valueClass} />
        ) : (
          <p className={valueClass}>{value}</p>
        )}
        {unit && <span className="dashboard-kpi__unit">{unit}</span>}
      </div>
      <p className="dashboard-kpi__detail">{detail}</p>
    </div>
  );
}

/** A saved target and its actual result; the optional pace marker belongs to that same period. */
export function GoalProgressRail({ actual, target, paceFraction, label }: {
  actual: number | null | undefined;
  target: number | null | undefined;
  paceFraction?: number | null;
  label: string;
}) {
  if (actual == null || target == null || !Number.isFinite(actual) || !Number.isFinite(target) || actual < 0 || target <= 0) {
    return <p className="money-board__note">Goal progress unavailable</p>;
  }
  const completion = actual / target * 100;
  if (!Number.isFinite(completion)) return <p className="money-board__note">Goal progress unavailable</p>;
  const width = Math.min(100, completion);
  // A near miss must not round into a completed goal.
  const completedPercent = Math.floor(completion);
  const marker = paceFraction != null && Number.isFinite(paceFraction) && paceFraction >= 0 && paceFraction <= 1 ? paceFraction : null;
  const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  return (
    <div className="goal-progress">
      <div
        className="goal-progress__rail"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.min(actual, target)}
        aria-valuetext={`${money(actual)} of ${money(target)} ALP; ${completedPercent}% of goal`}
      >
        <span className="goal-progress__fill" style={{ width: `${width}%` }} />
        {[25, 50, 75].map((percent) => <span className="goal-progress__tick" key={percent} style={{ left: `${percent}%` }} aria-hidden="true" />)}
        {marker !== null && <span className="goal-progress__today" style={{ left: `${marker * 100}%` }} title={`Today's pace: ${money(target * marker)} ALP`} aria-hidden="true" />}
      </div>
      <div className="goal-progress__labels">
        <strong>{completedPercent}% of goal</strong>
        {marker !== null ? <span>Today’s pace <b>{money(target * marker)}</b></span> : <span>Goal <b>{money(target)}</b></span>}
      </div>
    </div>
  );
}
