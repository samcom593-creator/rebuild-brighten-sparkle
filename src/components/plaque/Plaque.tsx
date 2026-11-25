import { Award } from "lucide-react";
import { resolveBrand } from "@/config/brand";

type PlaqueProps = {
  agentName: string;
  achievement: string;
  date: string;
  period?: string;
  rank?: number;
  subtitle?: string;
  avatarUrl?: string | null;
  width?: number;
  height?: number;
  watermark?: string;
  /** Retained for older callers; the workspace uses its shared brand palette. */
  accentColor?: string;
};

/** Responsive award facts; no fixed-size portrait or cropped text inside a small card. */
export function Plaque({ agentName, achievement, date, period, rank, subtitle, avatarUrl,
  width = 640, height = 800, watermark = "PRODUCTION AWARD" }: PlaqueProps) {
  const initials = agentName.split(/\s+/).map(name => name[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  const brand = resolveBrand();
  return (
    <article aria-label={`${agentName} ${achievement} award`}
      className="galaxy-card relative flex w-full flex-col justify-between gap-6 overflow-hidden rounded-lg border-2 border-primary/50 bg-card p-6 text-foreground sm:p-7"
      style={{ maxWidth: width, aspectRatio: `${width} / ${height}` }}>
      <div className="flex items-start justify-between gap-3">
        <p className="galaxy-heading text-base font-extrabold italic uppercase tracking-tight">{brand.legalName}</p>
        {rank != null && rank > 0 && <span className="galaxy-stat text-3xl font-extrabold italic text-primary">#{rank}</span>}
      </div>
      <div className="min-w-0 space-y-4">
        <div className="flex items-center gap-3">
          {avatarUrl ? <img src={avatarUrl} alt="" className="h-14 w-14 shrink-0 rounded-full border border-border object-cover" />
            : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/10 text-xl font-extrabold">{initials}</span>}
          <p className="min-w-0 break-words text-xl font-extrabold">{agentName}</p>
        </div>
        <h3 className="galaxy-heading break-words text-3xl font-extrabold italic uppercase leading-tight tracking-tight">{achievement}</h3>
        {subtitle && <p className="break-words text-xl font-bold tabular-nums text-success">{subtitle}</p>}
      </div>
      <div className="space-y-3 border-t border-border pt-4">
        {period && <p className="break-words text-sm font-semibold">{period}</p>}
        <p className="text-sm text-muted-foreground">{date}</p>
        <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary"><Award className="h-4 w-4 shrink-0" aria-hidden />{watermark}</p>
      </div>
    </article>
  );
}

export default Plaque;
