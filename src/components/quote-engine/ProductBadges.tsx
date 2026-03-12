import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { QEProductBadge } from "@/lib/quoteEngineTypes";

const BADGE_CONFIG: Record<string, { label: string; color: string; }> = {
  SS: { label: "Social Security Billing", color: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30" },
  DE: { label: "Direct Express / Debit", color: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30" },
  CC: { label: "Credit Card Accepted", color: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30" },
  PI: { label: "Pays on Issue", color: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
  RA: { label: "Real-time / Accelerated", color: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30" },
  GI: { label: "Guaranteed Issue", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" },
  GR: { label: "Graded Benefit", color: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30" },
  IM: { label: "Immediate Benefit", color: "bg-teal-500/15 text-teal-700 dark:text-teal-400 border-teal-500/30" },
};

interface ProductBadgesProps {
  badges: QEProductBadge[];
}

export function ProductBadges({ badges }: ProductBadgesProps) {
  if (badges.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((badge) => {
        const config = BADGE_CONFIG[badge.badge_code] || { label: badge.badge_code, color: "bg-muted text-muted-foreground border-border" };
        return (
          <Tooltip key={badge.badge_code}>
            <TooltipTrigger asChild>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${config.color} cursor-help`}>
                {badge.badge_code}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="font-medium text-sm">{config.label}</p>
              {badge.tooltip_text && <p className="text-xs text-muted-foreground mt-1">{badge.tooltip_text}</p>}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
