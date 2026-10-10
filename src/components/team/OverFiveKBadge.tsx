import { OVER_5K, overFiveKTooltip, showOverFiveK, type OverFiveKConfig } from "@/lib/overFiveK";
import type { RosterRow } from "@/lib/teamRoster";

/** The production number the configured period reads from the roster. ALP only; annual premium is not on the roster row. */
export function amountFor(row: Pick<RosterRow, "today_alp" | "mtd_alp" | "l30_alp" | "lifetime_alp">, cfg: OverFiveKConfig): number | null {
  if (cfg.metric !== "alp" || !cfg.period) return null;
  const v = cfg.period === "today" ? row.today_alp : cfg.period === "month_to_date" ? row.mtd_alp : cfg.period === "last_30_days" ? row.l30_alp : row.lifetime_alp;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * "Over $5K". Renders NOTHING while the rule is inactive (its metric, period and scope are not yet confirmed), and never
 * shows a missing number as $0. The tooltip states exactly what the badge measures.
 */
export function OverFiveKBadge({ row, cfg = OVER_5K }: { row: Pick<RosterRow, "today_alp" | "mtd_alp" | "l30_alp" | "lifetime_alp">; cfg?: OverFiveKConfig }) {
  const tip = overFiveKTooltip(cfg);
  if (!tip || !showOverFiveK(amountFor(row, cfg), cfg)) return null;
  return (
    <span title={tip} aria-label={`Over $5K. ${tip}`} className="inline-flex h-5 shrink-0 items-center rounded-full border border-emerald-500/50 bg-emerald-500/10 px-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
      Over $5K
    </span>
  );
}
