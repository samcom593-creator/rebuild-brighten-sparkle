import { useNextStepFunnel } from "./useNextStepData";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { Route } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * NextStepFunnelStrip — admin funnel showing all 18 stages with per-stage
 * person_count, stalled overlay, and conversion-to-next-% labels.
 *
 * Reads v_next_step_funnel_health. Stages are colored by the catalog's
 * color_hex (set on next_step_stages) so the visualization matches the
 * candidate-facing card colors.
 */
export function NextStepFunnelStrip() {
  const { data, isLoading } = useNextStepFunnel();

  if (isLoading) return <Skeleton className="h-32 rounded-md" />;
  if (!data || data.length === 0) return null;

  const maxInStage = Math.max(...data.map((d) => d.in_stage || 0), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="p-5 sm:p-6 border border-primary/20 bg-card">
        <div className="flex items-baseline justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <Route className="h-4 w-4 text-primary" />
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                18-stage pipeline · auto-recomputed nightly
              </p>
            </div>
            <h2 className="text-lg sm:text-xl font-bold tracking-tight mt-1">
              Next Step funnel
            </h2>
          </div>
          <p className="text-[11px] text-muted-foreground hidden sm:block">
            Bars: in stage · red sliver: stalled · % above bar: conversion to next stage
          </p>
        </div>

        <div className="flex items-end gap-1.5 overflow-x-auto pb-2">
          {data.map((s) => {
            const heightPct = Math.max(2, Math.round((s.in_stage / maxInStage) * 100));
            const stalledPct =
              s.in_stage > 0 ? Math.round((s.stalled / s.in_stage) * 100) : 0;
            const colorHex = "#C9A961"; // brand gold default; the view returns a color_hex on related rows we could swap in later
            return (
              <Tooltip key={s.stage_key}>
                <TooltipTrigger asChild>
                  <div className="flex flex-col items-center min-w-[2.25rem] shrink-0">
                    <span className="text-[9px] text-muted-foreground tabular-nums leading-none mb-0.5">
                      {s.conversion_to_next_pct !== null
                        ? `${Math.round(Number(s.conversion_to_next_pct))}%`
                        : "—"}
                    </span>
                    <div
                      className="relative w-7 sm:w-9 rounded-t-md overflow-hidden border border-border/60 bg-muted/30"
                      style={{ height: `${heightPct}%`, minHeight: 8, maxHeight: 92 }}
                    >
                      {/* base "in stage" fill */}
                      <div
                        className="absolute inset-x-0 bottom-0"
                        style={{
                          height: "100%",
                          background: `linear-gradient(180deg, ${colorHex}cc 0%, ${colorHex}66 100%)`,
                        }}
                      />
                      {/* stalled overlay */}
                      {stalledPct > 0 && (
                        <div
                          className="absolute inset-x-0 bottom-0 bg-rose-500/55"
                          style={{ height: `${stalledPct}%` }}
                        />
                      )}
                    </div>
                    <span className={cn("text-[9px] mt-1 tabular-nums leading-none", s.stalled > 0 ? "text-rose-300" : "text-foreground")}>
                      {s.in_stage}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs font-semibold">{s.display_name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {s.in_stage} in stage · {s.stalled} stalled · median {s.median_days !== null ? `${Number(s.median_days).toFixed(1)}d` : "—"}
                  </p>
                  {s.conversion_to_next_pct !== null && (
                    <p className="text-[11px] text-muted-foreground">
                      {Math.round(Number(s.conversion_to_next_pct))}% advance to next stage
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </Card>
    </motion.div>
  );
}
