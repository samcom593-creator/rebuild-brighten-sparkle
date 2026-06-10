import { Card } from "@/components/ui/card";
import type { CwModule } from "./modules";

interface Props {
  module: CwModule;
}

/**
 * Placeholder for ContentWheel modules not yet built.
 * Shows the spec doctrine + which phase ships it. Replaced module-by-module
 * across P2..P8 per the build sequence in the spec PDF.
 */
export function PlaceholderModule({ module }: Props) {
  const Icon = module.icon;
  return (
    <Card className="p-8 border-dashed border-2 border-border/60 bg-card/30">
      <div className="flex items-start gap-4">
        <div className="rounded-md bg-primary/10 p-4 border border-primary/20">
          <Icon className="h-8 w-8 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Module {module.number} · ships in {module.phase}
          </p>
          <h2 className="text-2xl font-bold tracking-tight mt-1">{module.label}</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{module.short}</p>
          <div className="mt-5 text-[12px] text-muted-foreground/80 leading-relaxed max-w-2xl">
            P0 (schema + RLS + seeds) and P1 (nav + dashboard shell) are live.
            This module ships next in the phased build sequence — the
            <span className="text-foreground font-medium"> backing tables, triggers, and views are already deployed</span>, so when the UI lands it queries real data immediately.
          </div>
        </div>
      </div>
    </Card>
  );
}
