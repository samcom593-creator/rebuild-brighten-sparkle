/**
 * <Plaque /> — single reusable award-card component (Section 7 item 5).
 *
 * One template, parameterized — supersedes every prior ad-hoc plaque
 * renderer. Renders as HTML+SVG so it can be screenshotted server-side
 * (puppeteer) or shared as an image via html-to-image.
 */

import { Crown, Medal, Trophy, Award, Star } from "lucide-react";
import { cn } from "@/lib/utils";

type PlaqueRank = 1 | 2 | 3 | number;
type PlaqueProps = {
  agentName: string;
  achievement: string;          // e.g. "Monthly Top Producer"
  date: string;                 // ISO or pre-formatted display date
  rank?: PlaqueRank;
  subtitle?: string;            // e.g. "April 2026" · "$32,145 ALP"
  avatarUrl?: string | null;
  width?: number;               // default 640
  height?: number;              // default 360
};

const RANK_META: Record<number, { icon: any; gradient: string; textColor: string; label: string }> = {
  1: { icon: Crown,  gradient: "from-amber-400 via-yellow-500 to-orange-500",  textColor: "text-amber-100",  label: "GOLD" },
  2: { icon: Medal,  gradient: "from-slate-300 via-zinc-400 to-slate-500",     textColor: "text-slate-100",  label: "SILVER" },
  3: { icon: Medal,  gradient: "from-orange-400 via-amber-600 to-yellow-700",  textColor: "text-orange-100", label: "BRONZE" },
};

export function Plaque({
  agentName, achievement, date, rank, subtitle, avatarUrl,
  width = 640, height = 360,
}: PlaqueProps) {
  const meta = rank && RANK_META[rank] ? RANK_META[rank] : {
    icon: Trophy, gradient: "from-violet-500 via-fuchsia-500 to-pink-500",
    textColor: "text-violet-100", label: `#${rank ?? ""}`,
  };
  const Icon = meta.icon;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl bg-gradient-to-br shadow-2xl",
        meta.gradient
      )}
      style={{ width, height }}
      data-plaque="true"
    >
      {/* Background watermark */}
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <Icon className="absolute right-6 bottom-6 h-64 w-64" />
      </div>

      {/* APEX brand mark */}
      <div className={cn("absolute top-4 left-5 font-bold tracking-widest text-xs", meta.textColor)}>
        APEX FINANCIAL
      </div>

      {/* Rank badge */}
      {rank && rank <= 3 && (
        <div className={cn("absolute top-4 right-5 flex items-center gap-2 font-bold", meta.textColor)}>
          <Icon className="h-5 w-5" />
          <span className="text-sm tracking-wider">{meta.label}</span>
        </div>
      )}

      {/* Main content */}
      <div className="absolute inset-0 flex flex-col justify-center items-center text-center px-8">
        {avatarUrl && (
          <img src={avatarUrl} alt="" className="h-20 w-20 rounded-full ring-4 ring-white/30 mb-4" />
        )}
        <div className={cn("text-xs uppercase tracking-widest font-semibold mb-2", meta.textColor)}>
          {achievement}
        </div>
        <div className="text-4xl font-bold text-white drop-shadow-lg mb-2">{agentName}</div>
        {subtitle && (
          <div className={cn("text-lg font-medium", meta.textColor)}>{subtitle}</div>
        )}
        <div className={cn("absolute bottom-5 right-6 text-xs font-medium", meta.textColor)}>
          {date}
        </div>
      </div>

      {/* Foil accents */}
      <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/10 to-white/0 pointer-events-none" />
    </div>
  );
}

export default Plaque;
